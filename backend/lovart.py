from __future__ import annotations

import hashlib
import hmac
import json
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
    constraints = [
        "请立即生成一张真实可下载的图片 artifact，不要只回复文本、脚本或分析。",
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
    ) -> None:
        self.base_url = (base_url or os.getenv("LOVART_BASE_URL", "https://lgw.lovart.ai")).rstrip("/")
        self.access_key = (access_key if access_key is not None else os.getenv("LOVART_ACCESS_KEY", "")).strip()
        self.secret_key = (secret_key if secret_key is not None else os.getenv("LOVART_SECRET_KEY", "")).strip()

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
        if code not in (0, "0", None):
            raise LovartAPIError(
                int(code) if str(code).isdigit() else 200,
                str(data.get("message") or data.get("error") or "Lovart request failed"),
            )
        result = data.get("data", data)
        if not isinstance(result, dict):
            raise LovartAPIError(200, "Lovart response data must be a JSON object")
        return result

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
    return body


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
