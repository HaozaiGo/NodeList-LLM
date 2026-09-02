import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_admin
from database import get_db
from models import BrandingConfig, User
from storage import object_key_for_asset, safe_storage_name, storage


router = APIRouter(tags=["branding"])
BRANDING_CONFIG_ID = "default"
DEFAULT_BRAND_NAME = "NodeList AI"
MAX_LOGO_BYTES = 2 * 1024 * 1024
LOGO_MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class BrandingOut(BaseModel):
    name: str
    logo_url: str
    updated_at: Optional[datetime] = None


def get_branding_config(db: Session) -> BrandingConfig:
    config = db.get(BrandingConfig, BRANDING_CONFIG_ID)
    if config:
        return config
    config = BrandingConfig(id=BRANDING_CONFIG_ID, name=DEFAULT_BRAND_NAME)
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def branding_out(config: BrandingConfig) -> BrandingOut:
    version = int(config.updated_at.timestamp()) if config.updated_at else 0
    return BrandingOut(
        name=config.name or DEFAULT_BRAND_NAME,
        logo_url=f"/api/branding/logo?v={version}" if config.logo_storage_key else "",
        updated_at=config.updated_at,
    )


def _detect_logo_mime(content: bytes) -> Optional[str]:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _read_logo(logo: UploadFile) -> tuple[bytes, str, str]:
    content = await logo.read(MAX_LOGO_BYTES + 1)
    content_type = _detect_logo_mime(content)
    extension = LOGO_MIME_EXTENSIONS.get(content_type)
    if not extension:
        raise HTTPException(status_code=400, detail="Logo 文件内容不是有效的 PNG、JPG 或 WebP")
    if not content:
        raise HTTPException(status_code=400, detail="Logo 文件为空")
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Logo 文件不能超过 2MB")
    filename = safe_storage_name(Path(logo.filename or f"logo{extension}").stem + extension)
    return content, content_type, filename


@router.get("/branding", response_model=BrandingOut)
def get_branding(db: Session = Depends(get_db)):
    return branding_out(get_branding_config(db))


@router.get("/branding/logo")
def get_branding_logo(db: Session = Depends(get_db)):
    config = get_branding_config(db)
    if not config.logo_storage_key:
        raise HTTPException(status_code=404, detail="Logo 未设置")
    if storage.is_remote:
        try:
            return RedirectResponse(
                storage.presign_download(config.logo_storage_key),
                status_code=307,
                headers={"Cache-Control": "no-store"},
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Logo 下载地址生成失败") from exc
    try:
        local_path = storage.ensure_local(config.logo_storage_key)
        with local_path.open("rb") as logo_file:
            content_type = _detect_logo_mime(logo_file.read(16)) or config.logo_mime_type or "application/octet-stream"
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Logo 文件不存在") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Logo 文件读取失败") from exc
    return FileResponse(
        local_path,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.put("/admin/branding", response_model=BrandingOut)
async def update_branding(
    name: str = Form(...),
    logo: Optional[UploadFile] = File(default=None),
    remove_logo: bool = Form(default=False),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    normalized_name = " ".join(name.split()).strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="品牌名称不能为空")
    if len(normalized_name) > 60:
        raise HTTPException(status_code=400, detail="品牌名称不能超过 60 个字符")

    config = get_branding_config(db)
    old_storage_key = config.logo_storage_key or ""
    next_storage_key = config.logo_storage_key
    next_logo_url = config.logo_url
    next_mime_type = config.logo_mime_type

    if logo is not None:
        content, content_type, filename = await _read_logo(logo)
        storage_key = object_key_for_asset(str(uuid.uuid4()), "branding_logo", filename)
        stored = storage.save_bytes(storage_key, content)
        next_storage_key = stored.storage_key
        next_logo_url = stored.public_url
        next_mime_type = content_type
    elif remove_logo:
        next_storage_key = None
        next_logo_url = None
        next_mime_type = None

    config.name = normalized_name
    config.logo_storage_key = next_storage_key
    config.logo_url = next_logo_url
    config.logo_mime_type = next_mime_type
    config.updated_by = admin.id
    db.commit()
    db.refresh(config)

    if old_storage_key and old_storage_key != (next_storage_key or ""):
        try:
            storage.delete(old_storage_key)
        except Exception:
            pass
    return branding_out(config)
