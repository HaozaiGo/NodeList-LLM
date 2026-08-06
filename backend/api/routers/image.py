from __future__ import annotations

import os
import re
import uuid
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from lovart import (
    LovartAPIError,
    LovartClient,
    build_lovart_image_payload,
    extract_image_urls,
    lovart_image_model_options,
)
from models import Asset, Flow, User
from storage import object_key_for_asset, safe_storage_name, storage

router = APIRouter(prefix="/image", tags=["image"])

DEFAULT_LOVART_IMAGE_MODEL = os.getenv("LOVART_IMAGE_MODEL", "gpt-image-2")


class ImageGenerateRequest(BaseModel):
    prompt: str
    model: str = DEFAULT_LOVART_IMAGE_MODEL
    ratio: str = "16:9"
    resolution: str = "2K"
    quality: str = "标准画质"
    count: int = 1
    reference_images: list[str] = Field(default_factory=list)
    flowId: Optional[str] = None
    nodeId: Optional[str] = None


class ImageAssetOut(BaseModel):
    id: str
    title: str
    url: str
    previewUrl: str
    storageKey: str


class ImageGenerateResponse(BaseModel):
    id: str
    model: str
    status: str
    projectId: Optional[str] = None


class ImageGenerationStatus(BaseModel):
    id: str
    model: Optional[str] = None
    status: str
    imageUrls: list[str] = Field(default_factory=list)
    assets: list[ImageAssetOut] = Field(default_factory=list)
    error: Optional[str] = None
    raw: dict[str, Any] = Field(default_factory=dict)


def _ensure_flow_owner(db: Session, flow_id: Optional[str], user: User) -> None:
    if not flow_id:
        return
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")


def _map_lovart_error(error: LovartAPIError) -> HTTPException:
    status = error.status_code if error.status_code >= 400 else 502
    if error.status_code == 0:
        status = 500
    return HTTPException(status_code=status, detail=error.detail)


def _normalize_status(status: Any, image_urls: list[str]) -> str:
    value = str(status or "").lower()
    if image_urls or value in {"done", "completed", "complete", "success", "succeeded"}:
        return "completed" if image_urls else "running"
    if value in {"failed", "fail", "error"}:
        return "failed"
    return "running"


def _lovart_text_message(task: dict[str, Any]) -> Optional[str]:
    items = task.get("items")
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("text"), str) and item["text"].strip():
            return item["text"].strip()
    return None


def _select_image_model(model: str | None) -> str:
    selected = (model or DEFAULT_LOVART_IMAGE_MODEL).strip() or DEFAULT_LOVART_IMAGE_MODEL
    allowed = {option["model"] for option in lovart_image_model_options()}
    if selected not in allowed:
        raise HTTPException(status_code=400, detail="unsupported Lovart image model")
    return selected


def _resolve_reference_images(db: Session, user: User, references: list[str]) -> list[str]:
    resolved: list[str] = []
    for reference in references:
        value = reference.strip()
        if not value:
            continue
        path = urlparse(value).path or value
        match = re.search(r"/api/assets/([^/]+)/(?:public-content|content)$", path)
        if match:
            asset = db.get(Asset, match.group(1))
            if asset and asset.user_id == user.id:
                resolved.append(storage.presign_download(asset.storage_key, asset.title))
                continue
        resolved.append(value)
    return resolved


async def _download_image(url: str) -> tuple[bytes, str]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20), follow_redirects=True) as client:
            response = await client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lovart 图片下载失败：{exc}") from exc
    mime_type = response.headers.get("content-type") or "image/png"
    return response.content, mime_type


async def _save_lovart_images(
    *,
    db: Session,
    user: User,
    task_id: str,
    flow_id: Optional[str],
    node_id: Optional[str],
    model: Optional[str],
    image_urls: list[str],
) -> list[ImageAssetOut]:
    saved: list[ImageAssetOut] = []
    for index, image_url in enumerate(image_urls, start=1):
        remote_id = f"{task_id}:{index}:{image_url}"
        existing = (
            db.query(Asset)
            .filter(Asset.user_id == user.id, Asset.kind == "generated_image", Asset.remote_id == remote_id)
            .first()
        )
        if existing:
            saved.append(_asset_out(existing))
            continue

        content, mime_type = await _download_image(image_url)
        ext = ".jpg" if "jpeg" in mime_type else ".png" if "png" in mime_type else ".webp" if "webp" in mime_type else ".img"
        asset_id = str(uuid.uuid4())
        filename = f"lovart-image-{index}{ext}"
        storage_key = object_key_for_asset(asset_id, "generated_image", safe_storage_name(filename))
        stored = storage.save_bytes(storage_key, content)
        asset = Asset(
            id=asset_id,
            user_id=user.id,
            flow_id=flow_id,
            node_id=node_id,
            kind="generated_image",
            title=f"Lovart 生成图 {index}",
            mime_type=mime_type,
            storage_key=stored.storage_key,
            public_url=stored.public_url,
            size_bytes=stored.size,
            provider="lovart",
            remote_id=remote_id,
            asset_metadata={"taskId": task_id, "sourceUrl": image_url, "model": model or ""},
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)
        saved.append(_asset_out(asset))
    return saved


def _asset_out(asset: Asset) -> ImageAssetOut:
    return ImageAssetOut(
        id=asset.id,
        title=asset.title,
        url=asset.public_url,
        previewUrl=f"/api/assets/{asset.id}/public-content",
        storageKey=asset.storage_key,
    )


@router.get("/models")
def image_models():
    return {"models": lovart_image_model_options(), "default": DEFAULT_LOVART_IMAGE_MODEL}


@router.post("/generate", response_model=ImageGenerateResponse)
async def generate_image(
    payload: ImageGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_flow_owner(db, payload.flowId, user)
    model = _select_image_model(payload.model)
    try:
        reference_images = _resolve_reference_images(db, user, payload.reference_images)
        request = build_lovart_image_payload(
            model=model,
            prompt=payload.prompt,
            ratio=payload.ratio,
            resolution=payload.resolution,
            quality=payload.quality,
            count=payload.count,
            reference_images=reference_images,
        )
        result = await LovartClient().create_task(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LovartAPIError as exc:
        raise _map_lovart_error(exc) from exc

    return ImageGenerateResponse(
        id=result.task_id,
        model=model,
        status="running",
        projectId=result.request_id,
    )


@router.get("/generate/{task_id}", response_model=ImageGenerationStatus)
async def get_image_generation_status(
    task_id: str,
    model: Optional[str] = None,
    flowId: Optional[str] = None,
    nodeId: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_flow_owner(db, flowId, user)
    try:
        task = await LovartClient().get_task(task_id)
    except LovartAPIError as exc:
        raise _map_lovart_error(exc) from exc

    image_urls = extract_image_urls(task)
    status = _normalize_status(task.get("status"), image_urls)
    error = None
    if status == "running" and str(task.get("status") or "").lower() in {"done", "completed", "complete", "success", "succeeded"}:
        error = _lovart_text_message(task) or "Lovart 已完成但未返回图片结果"
        status = "failed"
    assets = []
    if status == "completed" and image_urls:
        assets = await _save_lovart_images(
            db=db,
            user=user,
            task_id=task_id,
            flow_id=flowId,
            node_id=nodeId,
            model=model,
            image_urls=image_urls,
        )

    return ImageGenerationStatus(
        id=task_id,
        model=model,
        status=status,
        imageUrls=image_urls,
        assets=assets,
        error=error,
        raw=task,
    )
