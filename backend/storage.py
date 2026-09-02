from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import urllib.request

from dotenv import load_dotenv


load_dotenv()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./data/uploads")
PUBLIC_UPLOAD_PREFIX = os.getenv("PUBLIC_UPLOAD_PREFIX", "/uploads")
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()


@dataclass(frozen=True)
class StoredObject:
    storage_key: str
    public_url: str
    size: int


def safe_storage_name(name: str, *, max_bytes: int = 120) -> str:
    cleaned = Path(name or "asset.bin").name.replace("/", "-").replace("\\", "-") or "asset.bin"
    if len(cleaned.encode("utf-8")) <= max_bytes:
        return cleaned
    encoded = cleaned.encode("utf-8")[:max_bytes]
    while encoded:
        try:
            return encoded.decode("utf-8")
        except UnicodeDecodeError:
            encoded = encoded[:-1]
    return "asset.bin"


def object_key_for_asset(asset_id: str, kind: str, filename: str) -> str:
    now = datetime.now(timezone.utc)
    folder = "videos" if "video" in kind else "images" if "image" in kind else "files"
    ext = Path(safe_storage_name(filename)).suffix or ".bin"
    return f"nodelist/{kind}/{folder}/{now:%Y/%m/%d}/{asset_id}{ext}"


class LocalStorage:
    def __init__(self) -> None:
        self.root = Path(UPLOAD_DIR).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @property
    def is_remote(self) -> bool:
        return False

    def local_path(self, storage_key: str) -> Path:
        return self.root / storage_key.strip("/")

    def public_url(self, storage_key: str) -> str:
        return f"{PUBLIC_UPLOAD_PREFIX.rstrip('/')}/{quote(storage_key.strip('/'), safe='/')}"

    def save_bytes(self, storage_key: str, content: bytes) -> StoredObject:
        path = self.local_path(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return StoredObject(storage_key=storage_key.strip("/"), public_url=self.public_url(storage_key), size=path.stat().st_size)

    def save_file(self, storage_key: str, local_path: Path) -> StoredObject:
        target = self.local_path(storage_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != target.resolve():
            shutil.copyfile(local_path, target)
        return StoredObject(storage_key=storage_key.strip("/"), public_url=self.public_url(storage_key), size=target.stat().st_size)

    def delete(self, storage_key: str) -> None:
        path = self.local_path(storage_key)
        if path.exists():
            path.unlink()

    def ensure_local(self, storage_key: str) -> Path:
        path = self.local_path(storage_key)
        if not path.exists():
            raise FileNotFoundError(storage_key)
        return path

    def presign_download(self, storage_key: str, filename: str | None = None) -> str:
        return self.public_url(storage_key)


class TosStorage(LocalStorage):
    def __init__(
        self,
        ak: str,
        sk: str,
        endpoint: str,
        region: str,
        bucket: str,
        public_base_url: str,
    ) -> None:
        super().__init__()
        import tos

        self.client = tos.TosClientV2(ak, sk, endpoint, region)
        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")

    @property
    def is_remote(self) -> bool:
        return True

    def public_url(self, storage_key: str) -> str:
        encoded_key = quote(storage_key.strip("/"), safe="/")
        return f"{self.public_base_url}/{encoded_key}"

    def save_bytes(self, storage_key: str, content: bytes) -> StoredObject:
        stored = super().save_bytes(storage_key, content)
        return self.save_file(stored.storage_key, self.local_path(stored.storage_key))

    def save_file(self, storage_key: str, local_path: Path) -> StoredObject:
        normalized_key = storage_key.strip("/")
        self.client.put_object_from_file(self.bucket, normalized_key, str(local_path))
        return StoredObject(
            storage_key=normalized_key,
            public_url=self.public_url(normalized_key),
            size=local_path.stat().st_size,
        )

    def delete(self, storage_key: str) -> None:
        normalized_key = storage_key.strip("/")
        self.client.delete_object(self.bucket, normalized_key)
        super().delete(normalized_key)

    def ensure_local(self, storage_key: str) -> Path:
        path = self.local_path(storage_key)
        if path.exists():
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(self.presign_download(storage_key), timeout=600) as response:
            with path.open("wb") as output_file:
                shutil.copyfileobj(response, output_file)
        return path

    def presign_download(self, storage_key: str, filename: str | None = None) -> str:
        from tos.enum import HttpMethodType

        signed = self.client.pre_signed_url(
            HttpMethodType.Http_Method_Get,
            self.bucket,
            storage_key.strip("/"),
            expires=int(os.getenv("VOLCENGINE_TOS_PRESIGN_EXPIRES_SECONDS", "21600")),
        )
        return signed.signed_url


def build_storage() -> LocalStorage:
    tos_ak = os.getenv("VOLCENGINE_TOS_AK") or os.getenv("VOLCENGINE_OPENAPI_AK", "")
    tos_sk = os.getenv("VOLCENGINE_TOS_SK") or os.getenv("VOLCENGINE_OPENAPI_SK", "")
    tos_bucket = os.getenv("VOLCENGINE_TOS_BUCKET", "")
    tos_enabled = STORAGE_BACKEND == "tos" or bool(tos_bucket and tos_ak and tos_sk)
    if not tos_enabled:
        return LocalStorage()

    endpoint = os.getenv("VOLCENGINE_TOS_ENDPOINT", "tos-cn-guangzhou.volces.com")
    region = os.getenv("VOLCENGINE_TOS_REGION", "cn-guangzhou")
    public_base_url = os.getenv("VOLCENGINE_TOS_PUBLIC_BASE_URL") or f"https://{tos_bucket}.{endpoint}"
    missing = [
        name
        for name, value in {
            "VOLCENGINE_TOS_BUCKET": tos_bucket,
            "VOLCENGINE_TOS_AK or VOLCENGINE_OPENAPI_AK": tos_ak,
            "VOLCENGINE_TOS_SK or VOLCENGINE_OPENAPI_SK": tos_sk,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"TOS storage is enabled but missing: {', '.join(missing)}")
    return TosStorage(tos_ak, tos_sk, endpoint, region, tos_bucket, public_base_url)


storage = build_storage()
