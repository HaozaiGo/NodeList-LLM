from __future__ import annotations

import hashlib
import hmac
import json
import logging
import mimetypes
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

OPENAPI_PREFIX = "/v1/openapi"
SUPPORTED_RATIOS = {"1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"}
SUPPORTED_RESOLUTIONS = {"480p", "720p", "1080p", "1K", "2K", "4K"}
SUPPORTED_IMAGE_QUALITIES = {"低画质", "标准画质", "高画质"}
SUPPORTED_IMAGE_COUNTS = {1, 2, 4}
DEFAULT_IMAGE_MODELS = (
    "nano-banana-pro:Nano Banana Pro,"
    "nano-banana-2:Nano Banana 2,"
    "nano-banana-2-lite:Nano Banana 2 Lite,"
    "gpt-image-2:GPT Image 2,"
    "gpt-image-1.5:GPT Image 1.5,"
    "seedream-5-pro:Seedream 5.0 Pro,"
    "luma-uni-1:Luma Uni-1,"
    "luma-uni-1-max:Luma Uni-1 Max"
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LovartTaskResult:
    task_id: str
    request_id: str | None = None


class LovartAPIError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Lovart API error {status_code}: {detail}")


def lovart_image_model_options() -> list[dict[str, str]]:
    raw = os.getenv("LOVART_IMAGE_MODELS", DEFAULT_IMAGE_MODELS)
    default_model = os.getenv("LOVART_IMAGE_MODEL", "gpt-image-2").strip()
    options: list[dict[str, str]] = []
    for item in raw.split(","):
        model, _, label = item.strip().partition(":")
        if model:
            options.append({"model": model, "label": label.strip() or model})
    if default_model and not any(option["model"] == default_model for option in options):
        options.append({"model": default_model, "label": default_model})
    return options


def build_lovart_image_payload(
    *,
    model: str,
    prompt: str,
    ratio: str,
    resolution: str,
    quality: str = "标准画质",
    count: int = 1,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("prompt must not be empty")
    if ratio not in SUPPORTED_RATIOS:
        raise ValueError("unsupported ratio")
    if resolution not in SUPPORTED_RESOLUTIONS:
        raise ValueError("unsupported resolution")
    if quality not in SUPPORTED_IMAGE_QUALITIES:
        raise ValueError("unsupported quality")
    if count not in SUPPORTED_IMAGE_COUNTS:
        raise ValueError("unsupported image count")

    refs = [url for url in reference_images or [] if url]
    image_count_text = "一张" if count == 1 else f"{count}张"
    constraints = [
        f"请立即生成{image_count_text}真实可下载的图片 artifact，不要只回复文本、脚本或分析。",
        "请使用 Lovart 图片生成能力生成成图。",
        f"指定图片生成模型：{model}。",
        f"画质：{quality}。",
        f"图片比例：{ratio}。",
        f"清晰度：{resolution}。",
        f"生成数量：{count}张。",
        "保持画面自然、清晰、无水印、无字幕。",
    ]
    if refs:
        constraints.append("附件图片均为参考素材，请在生成中保持主体和场景一致。")

    return {
        "model": model,
        "prompt": "\n".join(constraints) + f"\n\n画面要求：\n{prompt}",
        "output_type": "image",
        "reference_images": refs,
        "ratio": ratio,
        "resolution": resolution,
        "quality": quality,
        "count": count,
        "watermark": False,
    }


class LovartClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        access_key: str | None = None,
        secret_key: str | None = None,
        task_base_url: str | None = None,
        relay_secret: str | None = None,
        user_uuid: str | None = None,
        web_token: str | None = None,
        web_signature: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("LOVART_BASE_URL", "https://lgw.lovart.ai")).rstrip("/")
        self.access_key = (access_key if access_key is not None else os.getenv("LOVART_ACCESS_KEY", "")).strip()
        self.secret_key = (secret_key if secret_key is not None else os.getenv("LOVART_SECRET_KEY", "")).strip()
        self.task_base_url = (
            task_base_url if task_base_url is not None else os.getenv("LOVART_TASK_BASE_URL", "")
        ).strip().rstrip("/") or self.base_url
        self.relay_secret = (
            relay_secret if relay_secret is not None else os.getenv("LOVART_RELAY_SECRET", "")
        ).strip()
        self.user_uuid = (user_uuid if user_uuid is not None else os.getenv("LOVART_USER_UUID", "")).strip()
        self.web_token = (web_token if web_token is not None else os.getenv("LOVART_WEB_TOKEN", "")).strip()
        self.web_signature = (
            web_signature if web_signature is not None else os.getenv("LOVART_WEB_SIGNATURE", "")
        ).strip()

    def _headers(self, method: str, path: str) -> dict[str, str]:
        if not self.access_key or not self.secret_key:
            raise LovartAPIError(0, "LOVART_ACCESS_KEY and LOVART_SECRET_KEY are required")
        timestamp = str(int(time.time()))
        signature = hmac.new(
            self.secret_key.encode(),
            f"{method}\n{path}\n{timestamp}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Content-Type": "application/json",
            "User-Agent": "NodeList/1.0 LovartOpenAPI",
            "X-Access-Key": self.access_key,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
            "X-Signed-Method": method,
            "X-Signed-Path": path,
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = self._headers(method, path)
        if method == "POST":
            headers["Idempotency-Key"] = uuid.uuid4().hex
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                json=json_payload,
                params=params,
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LovartAPIError(exc.response.status_code, _response_detail(exc.response)) from exc

        data = response.json()
        if not isinstance(data, dict):
            raise LovartAPIError(200, "Lovart response must be a JSON object")
        code = data.get("code", 0)
        if code not in (0, "0", None) and str(code).strip().upper() != "SUCCESS":
            raise LovartAPIError(
                int(code) if str(code).isdigit() else 200,
                str(data.get("message") or data.get("error") or "Lovart request failed"),
            )
        result = data.get("data", data)
        if not isinstance(result, dict):
            raise LovartAPIError(200, "Lovart response data must be a JSON object")
        return result

    def _task_headers(self) -> dict[str, str]:
        if self.relay_secret:
            return {
                "Content-Type": "application/json",
                "User-Agent": "NodeList/1.0 LovartRelay",
                "Authorization": f"Bearer {self.relay_secret}",
            }
        if not self.web_token or not self.user_uuid:
            raise LovartAPIError(
                0,
                "LOVART_RELAY_SECRET is required for Lovart task cleanup unless "
                "LOVART_WEB_TOKEN and LOVART_USER_UUID are configured",
            )
        timestamp = str(int(time.time() * 1000))
        req_uuid = uuid.uuid4().hex
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "NodeList/1.0 LovartWeb",
            "accept-language": "zh-CN",
            "token": self.web_token,
            "X-Send-Timestamp": timestamp,
            "X-Req-Uuid": req_uuid,
        }
        if self.web_signature:
            headers["X-Client-Signature"] = self.web_signature.format(
                timestamp=timestamp,
                req_uuid=req_uuid,
            )
        return headers

    async def _task_request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.request(
                    method,
                    f"{self.task_base_url}{path}",
                    headers=self._task_headers(),
                    json=json_payload,
                    params=params,
                )
        except httpx.TimeoutException as exc:
            raise LovartAPIError(0, f"Lovart task request timed out: {method} {path}") from exc
        except httpx.RequestError as exc:
            raise LovartAPIError(
                0,
                f"Lovart task request failed: {method} {path}: {exc.__class__.__name__}",
            ) from exc
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LovartAPIError(exc.response.status_code, _response_detail(exc.response)) from exc

        data = response.json()
        if not isinstance(data, dict):
            raise LovartAPIError(200, "Lovart task response must be a JSON object")
        code = data.get("code", 0)
        if code not in (0, "0", None) and str(code).strip().upper() != "SUCCESS":
            raise LovartAPIError(
                int(code) if str(code).isdigit() else 200,
                str(data.get("message") or data.get("error") or "Lovart task request failed"),
            )
        result = data.get("data", data)
        return result if isinstance(result, dict) else {"data": result}

    async def create_task(self, payload: dict[str, Any]) -> LovartTaskResult:
        project_id = _first_text(payload, "project_id", "projectId")
        if not project_id:
            project_id = await self.create_project()
        body = _build_chat_body(payload, project_id)
        data = await self._request("POST", f"{OPENAPI_PREFIX}/chat", json_payload=body)
        thread_id = _first_text(data, "thread_id", "threadId")
        if not thread_id:
            raise LovartAPIError(200, "Lovart response missing thread_id")
        return LovartTaskResult(task_id=thread_id, request_id=project_id)

    async def create_project(self) -> str:
        data = await self._request(
            "POST",
            f"{OPENAPI_PREFIX}/project/save",
            json_payload={
                "project_id": "",
                "canvas": "",
                "project_cover_list": [],
                "pic_count": 0,
                "project_type": 3,
            },
        )
        project_id = _first_text(data, "project_id", "projectId")
        if not project_id:
            raise LovartAPIError(200, "Lovart response missing project_id")
        return project_id

    async def get_task(self, task_id: str) -> dict[str, Any]:
        status = await self._request(
            "GET",
            f"{OPENAPI_PREFIX}/chat/status",
            params={"thread_id": task_id},
        )
        result: dict[str, Any] = {}
        try:
            result = await self._request(
                "GET",
                f"{OPENAPI_PREFIX}/chat/result",
                params={"thread_id": task_id},
            )
        except LovartAPIError:
            if str(status.get("status", "")).lower() == "done":
                raise
        if result.get("pending_confirmation"):
            await self.confirm_task(task_id)
            status = {**status, "status": "running", "confirmed": True}
        return {
            "thread_id": task_id,
            "status": status.get("status"),
            "status_payload": status,
            "result": result,
            "items": result.get("items", []),
        }

    async def confirm_task(self, task_id: str) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"{OPENAPI_PREFIX}/chat/confirm",
            json_payload={"thread_id": task_id},
        )

    async def terminate_tasks(self, task_ids: list[str] | tuple[str, ...] | str) -> dict[str, Any]:
        raw_task_ids = [task_ids] if isinstance(task_ids, str) else list(task_ids)
        clean_task_ids = [
            task_id
            for task_id in dict.fromkeys(str(task_id or "").strip() for task_id in raw_task_ids)
            if task_id and task_id != "等待远端任务ID" and not task_id.startswith("local-")
        ]
        if not clean_task_ids:
            return {"task_ids": [], "terminated": 0}
        body: dict[str, Any] = {"task_ids": clean_task_ids}
        if self.user_uuid:
            body["user_uuid"] = self.user_uuid
        return await self._task_request("POST", "/v1/tasks/terminate", json_payload=body)

    async def get_or_create_subject_kit(self) -> dict[str, Any]:
        params = {"kit_type": "subject"}
        if self.user_uuid:
            params["user_uuid"] = self.user_uuid
        data = await self._task_request("GET", "/v1/kit/list", params=params)
        items = data.get("items")
        if isinstance(items, list) and items:
            kit = items[0]
            return kit if isinstance(kit, dict) else {"id": str(kit)}

        body = {"kit_type": "subject", "name": "主体库"}
        if self.user_uuid:
            body["user_uuid"] = self.user_uuid
        created = await self._task_request("POST", "/v1/kit/create", json_payload=body)
        kit = created.get("kit") if isinstance(created.get("kit"), dict) else created
        if not _first_text(kit, "id"):
            raise LovartAPIError(200, "Lovart subject kit response missing id")
        return kit

    async def upload_subject_image(
        self,
        content: bytes,
        *,
        content_type: str,
        display_name: str,
        channel: str = "ark_sd2",
    ) -> dict[str, Any]:
        if not content:
            raise LovartAPIError(0, "Lovart subject image is empty")
        normalized_type = content_type.split(";", 1)[0].strip().lower()
        if not normalized_type.startswith("image/"):
            normalized_type = "image/png"

        kit = await self.get_or_create_subject_kit()
        kit_id = _first_text(kit, "id")
        if not kit_id:
            raise LovartAPIError(200, "Lovart subject kit missing id")
        file_name = _lovart_subject_file_name(display_name, normalized_type)
        presign = await self._task_request(
            "POST",
            "/v1/kit/asset/presign",
            json_payload={
                "kit_id": kit_id,
                "asset_type": "image",
                "display_name": file_name,
                "file_name": file_name,
                "content_type": normalized_type,
                "file_size": len(content),
            },
        )
        upload_url = _first_text(presign, "upload_url", "uploadUrl")
        callback_token = _first_text(presign, "callback_token", "callbackToken")
        if not upload_url or not callback_token:
            raise LovartAPIError(200, "Lovart subject presign response missing upload data")

        await self._put_subject_upload(upload_url, content, normalized_type)
        confirmed = await self._task_request(
            "POST",
            "/v1/kit/asset/confirm",
            json_payload={"callback_token": callback_token},
        )
        asset = confirmed.get("asset") if isinstance(confirmed.get("asset"), dict) else confirmed
        asset_id = _first_text(asset, "id", "asset_id", "assetId")
        if not asset_id:
            raise LovartAPIError(200, "Lovart subject confirm response missing asset id")

        await self.submit_subject_moderation([asset_id], channel=channel)
        return await self.get_subject_status(
            asset_id,
            channel=channel,
            fallback_asset=asset,
            display_name=display_name,
            kit=kit,
        )

    async def submit_subject_moderation(
        self,
        asset_ids: list[str],
        *,
        channel: str = "ark_sd2",
    ) -> dict[str, Any]:
        return await self._task_request(
            "POST",
            "/v1/kit/asset/moderation/submit",
            json_payload=_lovart_subject_moderation_body(asset_ids, channel, self.user_uuid),
        )

    async def check_subject_moderation(
        self,
        asset_ids: list[str],
        *,
        channel: str = "ark_sd2",
    ) -> dict[str, Any]:
        return await self._task_request(
            "POST",
            "/v1/kit/asset/moderation/check",
            json_payload=_lovart_subject_moderation_body(asset_ids, channel, self.user_uuid),
        )

    async def list_subject_assets(self, *, asset_type: str = "image") -> list[dict[str, Any]]:
        kit = await self.get_or_create_subject_kit()
        params = {"kit_id": _first_text(kit, "id"), "asset_type": asset_type}
        if self.user_uuid:
            params["user_uuid"] = self.user_uuid
        data = await self._task_request("GET", "/v1/kit/assets", params=params)
        items = data.get("assetDataset") or data.get("asset_dataset") or data.get("items") or []
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def get_subject_asset(self, asset_id: str) -> dict[str, Any]:
        clean_asset_id = str(asset_id or "").strip()
        if not clean_asset_id:
            return {}
        for item in await self.list_subject_assets(asset_type="image"):
            if _first_text(item, "id", "asset_id", "assetId") == clean_asset_id:
                return item
        return {}

    async def get_subject_status(
        self,
        asset_id: str,
        *,
        channel: str = "ark_sd2",
        fallback_asset: dict[str, Any] | None = None,
        display_name: str = "",
        kit: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        status_payload = await self.check_subject_moderation([asset_id], channel=channel)
        moderation_item = _lovart_subject_moderation_item(status_payload, asset_id)
        status = _first_text(moderation_item, "status") or "pending"
        asset = await self.get_subject_asset(asset_id)
        if not asset:
            asset = fallback_asset or {}
        asset_url = _lovart_subject_asset_url(asset)
        if status == "pending" and asset_url:
            status = "active"
        return {
            "kit": kit or {},
            "asset": asset,
            "asset_id": asset_id,
            "asset_url": asset_url,
            "display_name": _first_text(asset, "display_name", "displayName") or display_name,
            "channel": channel,
            "status": status,
            "moderation_status": status_payload,
        }

    async def _put_subject_upload(self, upload_url: str, content: bytes, content_type: str) -> None:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=15.0, read=300.0, write=300.0, pool=15.0),
                follow_redirects=True,
            ) as client:
                response = await client.put(
                    upload_url,
                    headers={"Content-Type": content_type},
                    content=content,
                )
        except httpx.TimeoutException as exc:
            raise LovartAPIError(0, "Lovart subject upload timed out") from exc
        except httpx.RequestError as exc:
            raise LovartAPIError(0, f"Lovart subject upload failed: {exc.__class__.__name__}") from exc
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LovartAPIError(exc.response.status_code, _response_detail(exc.response)) from exc


async def release_lovart_tasks(
    client: LovartClient,
    task_ids: list[str] | tuple[str, ...] | str,
    *,
    reason: str,
) -> bool:
    try:
        await client.terminate_tasks(task_ids)
        logger.info("released Lovart tasks reason=%s task_ids=%s", reason, task_ids)
        return True
    except Exception as exc:
        logger.warning("failed to release Lovart tasks reason=%s task_ids=%s: %s", reason, task_ids, exc)
        return False


def extract_image_urls(data: Any) -> list[str]:
    urls: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                lower_key = str(key).lower()
                if lower_key in {"url", "src", "image", "image_url", "imageurl", "download_url", "downloadurl"}:
                    if isinstance(item, str):
                        _append_image_url(urls, item)
                    else:
                        visit(item)
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str):
            for match in re.findall(r"https?://[^\s\"'<>]+", value):
                _append_image_url(urls, match)

    visit(data)
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        clean = url.rstrip(").,，。")
        if clean not in seen:
            seen.add(clean)
            deduped.append(clean)
    return deduped


def _append_image_url(urls: list[str], value: str) -> None:
    text = value.strip()
    if text.startswith("http://") or text.startswith("https://"):
        urls.append(text)


def _build_chat_body(payload: dict[str, Any], project_id: str) -> dict[str, Any]:
    body: dict[str, Any] = {"prompt": str(payload.get("prompt") or "").strip(), "project_id": project_id}
    attachments = payload.get("attachments")
    if not isinstance(attachments, list):
        attachments = payload.get("reference_images")
    if isinstance(attachments, list):
        resolved = [str(item).strip() for item in attachments if str(item).strip()]
        if resolved:
            body["attachments"] = resolved
    subject_assets = _lovart_subject_asset_list(payload.get("subject_assets") or payload.get("subjectAssetList"))
    if subject_assets:
        body["subjectAssetList"] = subject_assets
    return body


def _lovart_subject_asset_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    assets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        asset_id = _first_text(item, "assetId", "asset_id", "id")
        url = _first_text(item, "url", "subject_url", "preview_url")
        if not asset_id or not url or asset_id in seen:
            continue
        seen.add(asset_id)
        asset: dict[str, Any] = {"assetId": asset_id, "url": url, "type": "subject_image"}
        display_name = _first_text(item, "displayName", "display_name", "title", "name")
        channel = _first_text(item, "channel")
        if display_name:
            asset["displayName"] = display_name
        if channel:
            asset["channel"] = channel
        assets.append(asset)
    return assets


def _lovart_subject_file_name(display_name: str, content_type: str) -> str:
    clean_name = re.sub(r"[/\\:\x00-\x1f]+", "-", str(display_name or "").strip()).strip(". ")
    clean_name = clean_name or f"subject-{uuid.uuid4().hex[:8]}"
    if os.path.splitext(clean_name)[1].lower() in {".jpg", ".jpeg", ".png", ".webp"}:
        return clean_name
    extension = mimetypes.guess_extension(content_type) or ".png"
    return f"{clean_name}{extension}"


def _lovart_subject_moderation_body(asset_ids: list[str], channel: str, user_uuid: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "asset_ids": [asset_id for asset_id in dict.fromkeys(asset_ids) if asset_id],
        "channel": channel,
    }
    if user_uuid:
        body["user_uuid"] = user_uuid
    return body


def _lovart_subject_moderation_item(data: dict[str, Any], asset_id: str) -> dict[str, Any]:
    items = data.get("items")
    if not isinstance(items, list):
        return {}
    for item in items:
        if isinstance(item, dict) and _first_text(item, "asset_id", "assetId") == asset_id:
            return item
    return {}


def _lovart_subject_asset_url(asset: dict[str, Any]) -> str:
    files = asset.get("files")
    if not isinstance(files, list):
        return ""
    for file_item in files:
        if isinstance(file_item, dict):
            url = _first_text(file_item, "url", "oss_url", "ossUrl", "preview_url", "previewUrl")
            if url:
                return url
    return ""


def _first_text(data: dict[str, Any], *paths: str | tuple[str, ...]) -> str:
    for path in paths:
        value: Any = data
        keys = (path,) if isinstance(path, str) else path
        for key in keys:
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _response_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text.strip() or response.reason_phrase
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))
