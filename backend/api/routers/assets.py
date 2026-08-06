from __future__ import annotations

import os
import uuid
from typing import Any, Optional, Union

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Asset, Flow, User
from storage import object_key_for_asset, safe_storage_name, storage

router = APIRouter(prefix="/assets", tags=["assets"])

TOKENOPS_BASE_URL = os.getenv("TOKENOPS_BASE_URL", "https://api.tokenops.ai").rstrip("/")
BDS_PRO_MODEL = "bds-pro"
BDS_A2_BASE_URL = os.getenv("BDS_A2_BASE_URL", os.getenv("A2_VIDEO_BASE_URL", "https://cu-api.uniphore-ai.com")).rstrip("/")


class FinishedVideoAssetCreate(BaseModel):
    taskId: str
    flowId: Optional[str] = None
    nodeId: Optional[str] = None
    title: str = "生成成片"
    ratio: Optional[str] = None
    resolution: Optional[str] = None
    seconds: Optional[Union[str, int]] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssetOut(BaseModel):
    id: str
    kind: str
    title: str
    mimeType: str
    storageKey: str
    publicUrl: str
    url: str
    downloadUrl: str
    previewUrl: str
    sizeBytes: int
    provider: str
    remoteId: Optional[str]
    flowId: Optional[str]
    nodeId: Optional[str]
    metadata: dict[str, Any]


class AssetUpdate(BaseModel):
    title: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def _tokenops_key() -> str:
    key = os.getenv("TOKENOPS_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="TOKENOPS_API_KEY is not configured")
    return key


def _remote_error(response: httpx.Response, fallback: str) -> str:
    try:
        data = response.json()
    except ValueError:
        return fallback
    detail = data.get("error") or data.get("detail") or data.get("message")
    return str(detail or fallback)


def asset_to_dict(asset: Asset) -> dict[str, Any]:
    return {
        "id": asset.id,
        "kind": asset.kind,
        "title": asset.title,
        "mimeType": asset.mime_type,
        "storageKey": asset.storage_key,
        "publicUrl": asset.public_url,
        "url": asset.public_url,
        "downloadUrl": f"/api/assets/{asset.id}/content",
        "previewUrl": f"/api/assets/{asset.id}/public-content",
        "sizeBytes": asset.size_bytes,
        "provider": asset.provider,
        "remoteId": asset.remote_id,
        "flowId": asset.flow_id,
        "nodeId": asset.node_id,
        "metadata": asset.asset_metadata or {},
    }


def _ensure_flow_owner(db: Session, flow_id: Optional[str], user: User) -> None:
    if not flow_id:
        return
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")


def _require_supported_upload(file: UploadFile, kind: str) -> None:
    content_type = (file.content_type or "").lower()
    if kind == "image" and content_type and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="请上传图片文件")
    if kind == "video" and content_type and not content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="请上传视频文件")


async def _download_tokenops_video(task_id: str) -> tuple[bytes, str]:
    key = _tokenops_key()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
            response = await client.get(
                f"{TOKENOPS_BASE_URL}/v1/videos/{task_id}/content",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="生成视频下载超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps 视频下载失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps video download failed"))

    return response.content, response.headers.get("content-type") or "video/mp4"


def _bds_task_id(task_id: str) -> str:
    return task_id.split(":", 1)[1] if task_id.startswith(f"{BDS_PRO_MODEL}:") else task_id


def _absolute_bds_url(value: str) -> str:
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return f"{BDS_A2_BASE_URL}/{value.lstrip('/')}"


async def _download_bds_video(task_id: str) -> tuple[bytes, str]:
    remote_id = _bds_task_id(task_id)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20), follow_redirects=True) as client:
            result_response = await client.get(f"{BDS_A2_BASE_URL}/result/{remote_id}")
            result_response.raise_for_status()
            result = result_response.json()
            output = result.get("output") if isinstance(result.get("output"), dict) else {}
            url = str(output.get("url") or result.get("url") or "").strip()
            if not url:
                raise HTTPException(status_code=404, detail="Bds Pro 结果未返回视频 URL")
            video_response = await client.get(_absolute_bds_url(url))
            video_response.raise_for_status()
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bds Pro 视频下载失败：{exc}") from exc
    return video_response.content, video_response.headers.get("content-type") or "video/mp4"


async def _download_finished_video(task_id: str) -> tuple[bytes, str, str]:
    if task_id.startswith(f"{BDS_PRO_MODEL}:"):
        content, mime_type = await _download_bds_video(task_id)
        return content, mime_type, "bds-pro"
    content, mime_type = await _download_tokenops_video(task_id)
    return content, mime_type, "tokenops"


@router.get("/", response_model=list[AssetOut])
def list_assets(
    kind: Optional[str] = Query(default=None),
    flowId: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Asset).filter(Asset.user_id == user.id)
    if kind:
        query = query.filter(Asset.kind == kind)
    if flowId:
        query = query.filter(Asset.flow_id == flowId)
    return [asset_to_dict(asset) for asset in query.order_by(Asset.created_at.desc()).all()]


@router.post("/finished-video/from-tokenops", response_model=AssetOut, status_code=201)
async def create_finished_video_asset(
    payload: FinishedVideoAssetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_flow_owner(db, payload.flowId, user)

    existing = (
        db.query(Asset)
        .filter(
            Asset.user_id == user.id,
            Asset.kind == "finished_video",
            Asset.remote_id == payload.taskId,
            Asset.node_id == payload.nodeId,
        )
        .first()
    )
    if existing:
        return asset_to_dict(existing)

    content, mime_type, provider = await _download_finished_video(payload.taskId)
    asset_id = str(uuid.uuid4())
    filename = f"{safe_storage_name(payload.title or 'generated-video')}.mp4"
    storage_key = object_key_for_asset(asset_id, "finished_video", filename)
    stored = storage.save_bytes(storage_key, content)
    asset = Asset(
        id=asset_id,
        user_id=user.id,
        flow_id=payload.flowId,
        node_id=payload.nodeId,
        kind="finished_video",
        title=payload.title or "生成成片",
        mime_type=mime_type,
        storage_key=stored.storage_key,
        public_url=stored.public_url,
        size_bytes=stored.size,
        provider=provider,
        remote_id=payload.taskId,
        asset_metadata={
            **payload.metadata,
            "ratio": payload.ratio,
            "resolution": payload.resolution,
            "seconds": payload.seconds,
        },
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset)


@router.post("/upload", response_model=AssetOut, status_code=201)
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form("image"),
    flowId: Optional[str] = Form(default=None),
    nodeId: Optional[str] = Form(default=None),
    title: Optional[str] = Form(default=None),
    tag: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    normalized_kind = kind.strip().lower() or "file"
    _require_supported_upload(file, normalized_kind)
    _ensure_flow_owner(db, flowId, user)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件为空")

    asset_id = str(uuid.uuid4())
    original_name = safe_storage_name(file.filename or f"{normalized_kind}-{asset_id}")
    storage_key = object_key_for_asset(asset_id, normalized_kind, original_name)
    stored = storage.save_bytes(storage_key, content)
    asset = Asset(
        id=asset_id,
        user_id=user.id,
        flow_id=flowId,
        node_id=nodeId,
        kind=normalized_kind,
        title=title or original_name,
        mime_type=file.content_type or "application/octet-stream",
        storage_key=stored.storage_key,
        public_url=stored.public_url,
        size_bytes=stored.size,
        provider="upload",
        remote_id=None,
        asset_metadata={"tag": tag or ""},
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset)


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: str,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if not asset or asset.user_id != user.id:
        raise HTTPException(status_code=404, detail="Asset not found")
    if payload.title is not None and payload.title.strip():
        asset.title = payload.title.strip()
    if payload.metadata:
        asset.asset_metadata = {**(asset.asset_metadata or {}), **payload.metadata}
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset)


def _asset_file_response(asset: Asset):
    if storage.is_remote:
        return RedirectResponse(storage.presign_download(asset.storage_key, asset.title))

    try:
        path = storage.ensure_local(asset.storage_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Asset file not found") from exc
    return FileResponse(path, media_type=asset.mime_type, filename=safe_storage_name(asset.title))


@router.get("/{asset_id}/public-content")
def get_public_asset_content(
    asset_id: str,
    db: Session = Depends(get_db),
):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return _asset_file_response(asset)


@router.get("/{asset_id}/content")
def get_asset_content(
    asset_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if not asset or asset.user_id != user.id:
        raise HTTPException(status_code=404, detail="Asset not found")

    return _asset_file_response(asset)
