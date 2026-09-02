from __future__ import annotations

import os
import re
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from billing import finalize_generation_charge, refund_generation_credits, reserve_generation_credits
from database import get_db
from lovart import (
    LovartAPIError,
    LovartClient,
    build_lovart_image_payload,
    extract_image_urls,
    lovart_image_model_options,
    release_lovart_tasks,
)
from models import Asset, Flow, User
from storage import object_key_for_asset, safe_storage_name, storage

router = APIRouter(prefix="/image", tags=["image"])

DEFAULT_LOVART_IMAGE_MODEL = os.getenv("LOVART_IMAGE_MODEL", "gpt-image-2")
LOVART_IMAGE_BATCH_PREFIX = "lovart-batch:"


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
    creditsCharged: int = 0
    creditBalance: int = 0


class ImageGenerationStatus(BaseModel):
    id: str
    model: Optional[str] = None
    status: str
    imageUrls: list[str] = Field(default_factory=list)
    assets: list[ImageAssetOut] = Field(default_factory=list)
    error: Optional[str] = None
    raw: dict[str, Any] = Field(default_factory=dict)


def _image_batch_id(task_ids: list[str]) -> str:
    return f"{LOVART_IMAGE_BATCH_PREFIX}{','.join(task_ids)}"


def _image_batch_task_ids(task_id: str) -> list[str]:
    if not task_id.startswith(LOVART_IMAGE_BATCH_PREFIX):
        return [task_id]
    raw = task_id[len(LOVART_IMAGE_BATCH_PREFIX):]
    return [item.strip() for item in raw.split(",") if item.strip()]


def _ensure_flow_owner(db: Session, flow_id: Optional[str], user: User) -> None:
    if not flow_id:
        return
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")


def _image_output_summary(payload: ImageGenerateRequest) -> str:
    return " · ".join(
        [
            payload.ratio,
            payload.quality or "标准画质",
            payload.resolution,
            f"{payload.count or 1}张",
        ]
    )


def _patch_flow_image_generation_task(
    *,
    db: Session,
    user: User,
    payload: ImageGenerateRequest,
    task_id: str,
    project_id: Optional[str],
    model: str,
) -> None:
    if not payload.flowId or not payload.nodeId:
        return
    flow = db.get(Flow, payload.flowId)
    if not flow or flow.user_id != user.id:
        return

    nodes = deepcopy(flow.nodes or [])
    updated = False
    now = datetime.now(timezone.utc).isoformat()
    for node in nodes:
        if not isinstance(node, dict) or node.get("id") != payload.nodeId:
            continue
        data = dict(node.get("data") or {})
        config = dict(data.get("config") or {})
        config.update(
            {
                "taskId": task_id,
                "generationStatus": "running",
                "projectId": project_id or config.get("projectId") or "",
                "model": model,
                "ratio": payload.ratio,
                "resolution": payload.resolution,
                "quality": payload.quality,
                "count": payload.count,
                "prompt": payload.prompt,
                "imageTaskUpdatedAt": now,
                "taskCreatedAt": config.get("taskCreatedAt") or now,
            }
        )
        data.update(
            {
                "status": "running",
                "metric": "Lovart 已排队",
                "config": config,
                "items": ["Lovart 生成中", "正在获取结果", _image_output_summary(payload)],
            }
        )
        node["data"] = data
        updated = True
        break

    if updated:
        flow.nodes = nodes
        db.commit()


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


def _saved_lovart_images(
    db: Session,
    user: User,
    task_id: str,
    *,
    flow_id: Optional[str],
    node_id: Optional[str],
) -> list[ImageAssetOut]:
    query = db.query(Asset).filter(
        Asset.user_id == user.id,
        Asset.kind == "generated_image",
    )
    if flow_id:
        query = query.filter(Asset.flow_id == flow_id)
    if node_id:
        query = query.filter(Asset.node_id == node_id)
    assets = []
    for asset in query.order_by(Asset.created_at.asc()).all():
        metadata = asset.asset_metadata if isinstance(asset.asset_metadata, dict) else {}
        if str(metadata.get("taskId") or "") == task_id:
            assets.append(_asset_out(asset))
    expected_count = len(_image_batch_task_ids(task_id))
    return assets if len(assets) >= expected_count else []


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
    if payload.count not in {1, 2, 4}:
        raise HTTPException(status_code=400, detail="unsupported image count")
    charge = reserve_generation_credits(
        db,
        user,
        kind="image",
        units=payload.count,
        note=f"图片生成 {payload.count} 张 · {model}",
    )
    results = []
    try:
        reference_images = _resolve_reference_images(db, user, payload.reference_images)
        client = LovartClient()
        for index in range(max(1, payload.count)):
            prompt = payload.prompt
            if payload.count > 1:
                prompt = f"{payload.prompt}\n\n本次是批量生成第 {index + 1}/{payload.count} 张，请生成一张独立结果，保持同一要求但允许自然差异。"
            request = build_lovart_image_payload(
                model=model,
                prompt=prompt,
                ratio=payload.ratio,
                resolution=payload.resolution,
                quality=payload.quality,
                count=1,
                reference_images=reference_images,
            )
            results.append(await client.create_task(request))
    except ValueError as exc:
        if results:
            await release_lovart_tasks(LovartClient(), [result.task_id for result in results], reason="image_batch_submit_failed")
        refund_generation_credits(db, user, charge, reason=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LovartAPIError as exc:
        if results:
            await release_lovart_tasks(LovartClient(), [result.task_id for result in results], reason="image_batch_submit_failed")
        refund_generation_credits(db, user, charge, reason=exc.detail)
        raise _map_lovart_error(exc) from exc
    except Exception as exc:
        if results:
            await release_lovart_tasks(LovartClient(), [result.task_id for result in results], reason="image_batch_submit_failed")
        refund_generation_credits(db, user, charge, reason=str(exc))
        raise

    task_ids = [result.task_id for result in results]
    response_task_id = _image_batch_id(task_ids) if len(task_ids) > 1 else task_ids[0]
    finalize_generation_charge(db, charge, response_task_id)
    _patch_flow_image_generation_task(
        db=db,
        user=user,
        payload=payload,
        task_id=response_task_id,
        project_id=results[0].request_id if results else None,
        model=model,
    )
    return ImageGenerateResponse(
        id=response_task_id,
        model=model,
        status="running",
        projectId=results[0].request_id if results else None,
        creditsCharged=charge.amount if charge else 0,
        creditBalance=user.credit_balance,
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
    task_ids = _image_batch_task_ids(task_id)
    saved_assets = _saved_lovart_images(db, user, task_id, flow_id=flowId, node_id=nodeId)
    if saved_assets:
        await release_lovart_tasks(LovartClient(), task_ids, reason="image_already_archived")
        return ImageGenerationStatus(
            id=task_id,
            model=model,
            status="completed",
            imageUrls=[asset.url for asset in saved_assets],
            assets=saved_assets,
            raw={"source": "archived_assets"},
        )

    client = LovartClient()
    tasks: list[dict[str, Any]] = []
    errors: list[str] = []
    for child_task_id in task_ids:
        try:
            tasks.append(await client.get_task(child_task_id))
        except LovartAPIError as exc:
            errors.append(exc.detail)

    image_urls: list[str] = []
    child_statuses: list[str] = []
    for task in tasks:
        task_image_urls = extract_image_urls(task)
        image_urls.extend(task_image_urls[:1] if len(task_ids) > 1 else task_image_urls)
        child_status = _normalize_status(task.get("status"), task_image_urls)
        if child_status == "running" and str(task.get("status") or "").lower() in {"done", "completed", "complete", "success", "succeeded"}:
            errors.append(_lovart_text_message(task) or "Lovart 已完成但未返回图片结果")
            child_status = "failed"
        child_statuses.append(child_status)

    seen_urls: set[str] = set()
    image_urls = [url for url in image_urls if not (url in seen_urls or seen_urls.add(url))]
    if errors and not tasks:
        raise _map_lovart_error(LovartAPIError(502, errors[0]))
    all_children_observed = len(child_statuses) == len(task_ids)
    if all_children_observed and all(status == "completed" for status in child_statuses):
        status = "completed"
    elif all_children_observed and all(status == "failed" for status in child_statuses):
        status = "failed"
    elif all_children_observed and not any(status == "running" for status in child_statuses):
        status = "failed"
    elif errors and not child_statuses:
        status = "failed"
    else:
        status = "running"
    error = "；".join(errors) if status == "failed" and errors else None
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
        await release_lovart_tasks(client, task_ids, reason="image_archived")
    elif status == "failed" and len(child_statuses) == len(task_ids) and not any(
        child_status == "running" for child_status in child_statuses
    ):
        await release_lovart_tasks(client, task_ids, reason="image_failed")

    return ImageGenerationStatus(
        id=task_id,
        model=model,
        status=status,
        imageUrls=image_urls,
        assets=assets,
        error=error,
        raw={"tasks": tasks, "errors": errors},
    )
