from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import quote, urlparse

import google.auth
import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest


VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
VERTEX_IMAGE_MODEL = os.getenv("VERTEX_IMAGE_MODEL", "gemini-2.5-flash-image").strip()
VERTEX_VIDEO_MODEL = os.getenv("VERTEX_VIDEO_MODEL", "veo-3.1-fast-generate-001").strip()
VERTEX_IMAGE_LOCATION = os.getenv("VERTEX_IMAGE_LOCATION", "global").strip() or "global"
VERTEX_VIDEO_LOCATION = os.getenv("VERTEX_VIDEO_LOCATION", "us-central1").strip() or "us-central1"
VERTEX_VIDEO_GCS_URI = os.getenv("VERTEX_VIDEO_GCS_URI", "").strip()
VERTEX_IMAGE_TASK_PREFIX = "vertex-image:"
VERTEX_VIDEO_TASK_PREFIX = "vertex-veo:"
MAX_REFERENCE_IMAGE_BYTES = int(os.getenv("VERTEX_REFERENCE_IMAGE_MAX_MB", "10")) * 1024 * 1024
MAX_REFERENCE_IMAGE_COUNT = int(os.getenv("VERTEX_REFERENCE_IMAGE_COUNT", "6"))
VEO_INPUT_IMAGE_MAX_BYTES = int(os.getenv("VERTEX_VIDEO_INPUT_IMAGE_MAX_MB", "20")) * 1024 * 1024
VEO_INPUT_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


class VertexAIError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class VertexImage:
    data: bytes
    mime_type: str


def vertex_image_model_options() -> list[dict[str, str]]:
    return [{"model": VERTEX_IMAGE_MODEL, "label": "Gemini 2.5 Flash Image · Vertex AI"}]


def vertex_video_model_options() -> list[dict[str, str]]:
    return [{"model": VERTEX_VIDEO_MODEL, "label": "Veo 3.1 Fast · Vertex AI"}]


def is_vertex_image_model(model: str) -> bool:
    return bool(VERTEX_IMAGE_MODEL) and model == VERTEX_IMAGE_MODEL


def is_vertex_video_model(model: str) -> bool:
    return bool(VERTEX_VIDEO_MODEL) and model == VERTEX_VIDEO_MODEL


def encode_vertex_video_task(operation_name: str) -> str:
    encoded = base64.urlsafe_b64encode(operation_name.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{VERTEX_VIDEO_TASK_PREFIX}{encoded}"


def decode_vertex_video_task(task_id: str) -> str:
    if not task_id.startswith(VERTEX_VIDEO_TASK_PREFIX):
        raise VertexAIError(400, "Vertex Veo 任务 ID 无效")
    encoded = task_id[len(VERTEX_VIDEO_TASK_PREFIX):]
    if not encoded:
        raise VertexAIError(400, "Vertex Veo 任务 ID 无效")
    try:
        padding = "=" * (-len(encoded) % 4)
        operation_name = base64.urlsafe_b64decode(f"{encoded}{padding}").decode("utf-8")
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise VertexAIError(400, "Vertex Veo 任务 ID 无效") from exc
    if not operation_name.startswith("projects/") or "/operations/" not in operation_name:
        raise VertexAIError(400, "Vertex Veo 任务 ID 无效")
    return operation_name


@lru_cache(maxsize=1)
def _credentials_and_project():
    try:
        credentials, detected_project = google.auth.default(scopes=[VERTEX_SCOPE])
    except Exception as exc:
        raise VertexAIError(
            500,
            "Vertex AI 鉴权未配置，请设置 GOOGLE_APPLICATION_CREDENTIALS 或工作负载身份",
        ) from exc
    project = (
        os.getenv("VERTEX_AI_PROJECT", "").strip()
        or os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        or str(detected_project or "").strip()
    )
    if not project:
        raise VertexAIError(500, "Vertex AI 项目未配置，请设置 VERTEX_AI_PROJECT 或 GOOGLE_CLOUD_PROJECT")
    return credentials, project


async def _auth_context() -> tuple[str, str]:
    credentials, project = _credentials_and_project()
    try:
        await asyncio.to_thread(credentials.refresh, GoogleAuthRequest())
    except Exception as exc:
        raise VertexAIError(502, f"Vertex AI 访问令牌获取失败：{exc}") from exc
    token = str(getattr(credentials, "token", "") or "")
    if not token:
        raise VertexAIError(502, "Vertex AI 未返回访问令牌")
    return token, project


def _endpoint(project: str, location: str, model: str, method: str) -> str:
    host = "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"
    model_path = f"projects/{project}/locations/{location}/publishers/google/models/{model}"
    return f"https://{host}/v1/{model_path}:{method}"


def _remote_error(response: httpx.Response, fallback: str) -> VertexAIError:
    detail = fallback
    try:
        payload = response.json()
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            detail = str(error.get("message") or error.get("status") or fallback)
        elif isinstance(error, str) and error.strip():
            detail = error.strip()
    except (ValueError, json.JSONDecodeError):
        if response.text.strip():
            detail = response.text.strip()[:1000]
    status = response.status_code if 400 <= response.status_code < 600 else 502
    return VertexAIError(status, f"{fallback}（HTTP {response.status_code}）：{detail}")


def _decode_data_url(value: str, max_bytes: int = MAX_REFERENCE_IMAGE_BYTES) -> VertexImage | None:
    if not value.startswith("data:"):
        return None
    header, separator, encoded = value.partition(",")
    if not separator or ";base64" not in header:
        raise VertexAIError(400, "参考图 data URL 必须使用 base64 编码")
    mime_type = header[5:].split(";", 1)[0] or "image/png"
    if not mime_type.startswith("image/"):
        raise VertexAIError(400, "参考素材不是图片")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise VertexAIError(400, "参考图 base64 数据无效") from exc
    if len(data) > max_bytes:
        raise VertexAIError(400, "单张 Vertex AI 参考图过大")
    return VertexImage(data=data, mime_type=mime_type)


async def _download_reference_image(
    url: str,
    max_bytes: int = MAX_REFERENCE_IMAGE_BYTES,
) -> VertexImage:
    inline = _decode_data_url(url, max_bytes=max_bytes)
    if inline is not None:
        return inline
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise VertexAIError(400, "Vertex AI 参考图仅支持 HTTP(S) URL 或 data URL")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=True) as client:
            response = await client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise VertexAIError(502, f"Vertex AI 参考图下载失败：{exc}") from exc
    data = response.content
    if len(data) > max_bytes:
        raise VertexAIError(400, "单张 Vertex AI 参考图过大")
    mime_type = (response.headers.get("content-type") or "image/png").split(";", 1)[0].strip()
    if not mime_type.startswith("image/"):
        raise VertexAIError(400, "参考素材不是图片")
    return VertexImage(data=data, mime_type=mime_type)


def _extract_generated_images(payload: dict[str, Any]) -> list[VertexImage]:
    images: list[VertexImage] = []
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        return images
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content") if isinstance(candidate.get("content"), dict) else {}
        parts = content.get("parts") if isinstance(content.get("parts"), list) else []
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline, dict) or not inline.get("data"):
                continue
            try:
                data = base64.b64decode(str(inline["data"]), validate=True)
            except (ValueError, binascii.Error) as exc:
                raise VertexAIError(502, "Vertex AI 返回了无效的图片数据") from exc
            images.append(VertexImage(data=data, mime_type=str(inline.get("mimeType") or "image/png")))
    return images


def _image_failure_detail(payload: dict[str, Any]) -> str:
    feedback = payload.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        return f"Vertex AI 因安全策略拒绝了提示词：{feedback['blockReason']}"
    candidates = payload.get("candidates")
    if isinstance(candidates, list):
        reasons = [
            str(item.get("finishReason"))
            for item in candidates
            if isinstance(item, dict) and item.get("finishReason")
        ]
        if reasons:
            return f"Vertex AI 未返回图片：{', '.join(reasons)}"
    return "Vertex AI 未返回图片，请调整提示词后重试"


async def generate_vertex_images(
    *,
    prompt: str,
    model: str,
    aspect_ratio: str,
    count: int,
    reference_images: list[str],
) -> list[VertexImage]:
    token, project = await _auth_context()
    references = await asyncio.gather(
        *[_download_reference_image(url) for url in reference_images[:MAX_REFERENCE_IMAGE_COUNT]]
    )
    parts: list[dict[str, Any]] = [
        {
            "inlineData": {
                "mimeType": image.mime_type,
                "data": base64.b64encode(image.data).decode("ascii"),
            }
        }
        for image in references
    ]
    parts.append({"text": prompt.strip()})
    request_payload = {
        "contents": [{"role": "USER", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio},
        },
    }
    endpoint = _endpoint(project, VERTEX_IMAGE_LOCATION, model, "generateContent")
    generated: list[VertexImage] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
        for index in range(max(1, count)):
            body = request_payload
            if count > 1:
                body = json.loads(json.dumps(request_payload))
                body["contents"][0]["parts"][-1]["text"] = (
                    f"{prompt.strip()}\n\nGenerate variation {index + 1} of {count} as one standalone image."
                )
            try:
                response = await client.post(
                    endpoint,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=body,
                )
            except httpx.TimeoutException as exc:
                raise VertexAIError(504, "Vertex AI 图片生成超时，请稍后重试") from exc
            except httpx.HTTPError as exc:
                raise VertexAIError(502, f"Vertex AI 图片生成请求失败：{exc}") from exc
            if response.status_code >= 400:
                raise _remote_error(response, "Vertex AI 图片生成失败")
            result = response.json()
            images = _extract_generated_images(result if isinstance(result, dict) else {})
            if not images:
                raise VertexAIError(422, _image_failure_detail(result if isinstance(result, dict) else {}))
            generated.append(images[0])
    return generated


async def create_vertex_video(
    *,
    prompt: str,
    model: str,
    aspect_ratio: str,
    resolution: str,
    seconds: int,
    generate_audio: bool,
    reference_image: str = "",
) -> dict[str, Any]:
    token, project = await _auth_context()
    first_frame = (
        await _download_reference_image(reference_image, max_bytes=VEO_INPUT_IMAGE_MAX_BYTES)
        if reference_image.strip()
        else None
    )
    task = "imageToVideo" if first_frame else "textToVideo"
    instance: dict[str, Any] = {"prompt": prompt.strip()}
    parameters: dict[str, Any] = {
        "sampleCount": 1,
        "durationSeconds": seconds,
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "generateAudio": generate_audio,
        "enhancePrompt": True,
    }
    if first_frame:
        mime_type = first_frame.mime_type.lower().strip()
        if mime_type == "image/jpg":
            mime_type = "image/jpeg"
        if mime_type not in VEO_INPUT_IMAGE_MIME_TYPES:
            raise VertexAIError(400, "Vertex Veo 首帧仅支持 JPEG、PNG 或 WebP 图片")
        instance["image"] = {
            "bytesBase64Encoded": base64.b64encode(first_frame.data).decode("ascii"),
            "mimeType": mime_type,
        }
        parameters["resizeMode"] = "crop"
    if VERTEX_VIDEO_GCS_URI:
        parameters["storageUri"] = VERTEX_VIDEO_GCS_URI
    endpoint = _endpoint(project, VERTEX_VIDEO_LOCATION, model, "predictLongRunning")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=20)) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"instances": [instance], "parameters": parameters},
            )
    except httpx.TimeoutException as exc:
        raise VertexAIError(504, "Vertex Veo 任务创建超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise VertexAIError(502, f"Vertex Veo 任务创建失败：{exc}") from exc
    if response.status_code >= 400:
        raise _remote_error(response, "Vertex Veo 任务创建失败")
    result = response.json()
    operation_name = str(result.get("name") or "") if isinstance(result, dict) else ""
    if not operation_name:
        raise VertexAIError(502, "Vertex Veo 未返回 operation name")
    return {
        "id": encode_vertex_video_task(operation_name),
        "model": model,
        "status": "running",
        "request": {
            "provider": "vertex-ai",
            "model": model,
            "ratio": aspect_ratio,
            "resolution": resolution,
            "seconds": seconds,
            "generate_audio": generate_audio,
            "task": task,
            "reference_image_count": 1 if first_frame else 0,
        },
    }


def _video_entries(operation: dict[str, Any]) -> list[dict[str, str]]:
    response = operation.get("response") if isinstance(operation.get("response"), dict) else {}
    candidates = response.get("videos") or response.get("generatedVideos") or []
    if not isinstance(candidates, list):
        return []
    entries: list[dict[str, str]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        video = candidate.get("video") if isinstance(candidate.get("video"), dict) else candidate
        uri = str(video.get("gcsUri") or video.get("uri") or "").strip()
        encoded = str(video.get("bytesBase64Encoded") or video.get("videoBytes") or "").strip()
        if uri or encoded:
            entries.append(
                {
                    "uri": uri,
                    "bytesBase64Encoded": encoded,
                    "mimeType": str(video.get("mimeType") or "video/mp4"),
                }
            )
    return entries


async def get_vertex_video_operation(task_id: str, model: str) -> dict[str, Any]:
    operation_name = decode_vertex_video_task(task_id)
    token, project = await _auth_context()
    endpoint = _endpoint(project, VERTEX_VIDEO_LOCATION, model, "fetchPredictOperation")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20)) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"operationName": operation_name},
            )
    except httpx.TimeoutException as exc:
        raise VertexAIError(504, "Vertex Veo 状态查询超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise VertexAIError(502, f"Vertex Veo 状态查询失败：{exc}") from exc
    if response.status_code >= 400:
        raise _remote_error(response, "Vertex Veo 状态查询失败")
    result = response.json()
    return result if isinstance(result, dict) else {}


def vertex_video_status(task_id: str, model: str, operation: dict[str, Any]) -> dict[str, Any]:
    entries = _video_entries(operation)
    remote_error = operation.get("error")
    if isinstance(remote_error, dict):
        error = str(remote_error.get("message") or remote_error.get("status") or "Vertex Veo 生成失败")
        status = "failed"
    elif operation.get("done") and not entries:
        filtered = (operation.get("response") or {}).get("raiMediaFilteredCount", 0)
        error = "Vertex Veo 未返回视频"
        if filtered:
            error = "Vertex Veo 因安全策略过滤了生成结果"
        status = "failed"
    elif entries:
        error = ""
        status = "completed"
    else:
        error = ""
        status = "running"
    video_urls = [entry["uri"] for entry in entries if entry["uri"]]
    return {
        "id": task_id,
        "model": model,
        "status": status,
        "videoUrls": video_urls,
        "error": error or None,
        "content_path": f"/api/video/generate/{task_id}/content" if status == "completed" else "",
        "raw": {
            "name": operation.get("name"),
            "done": bool(operation.get("done")),
            "hasInlineVideo": any(entry["bytesBase64Encoded"] for entry in entries),
        },
    }


async def download_vertex_video(task_id: str, model: str) -> tuple[bytes, str]:
    operation = await get_vertex_video_operation(task_id, model)
    status = vertex_video_status(task_id, model, operation)
    if status["status"] != "completed":
        raise VertexAIError(404, str(status.get("error") or "Vertex Veo 视频尚未生成完成"))
    entry = _video_entries(operation)[0]
    if entry["bytesBase64Encoded"]:
        try:
            return base64.b64decode(entry["bytesBase64Encoded"], validate=True), entry["mimeType"]
        except (ValueError, binascii.Error) as exc:
            raise VertexAIError(502, "Vertex Veo 返回了无效的视频数据") from exc
    uri = entry["uri"]
    parsed = urlparse(uri)
    if parsed.scheme != "gs" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise VertexAIError(502, "Vertex Veo 返回的视频 URI 无法下载")
    token, _ = await _auth_context()
    object_name = quote(parsed.path.lstrip("/"), safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{quote(parsed.netloc, safe='')}/o/{object_name}?alt=media"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=20), follow_redirects=True) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise VertexAIError(502, f"Vertex Veo 视频下载失败：{exc}") from exc
    if response.status_code >= 400:
        raise _remote_error(response, "Vertex Veo 视频下载失败")
    return response.content, response.headers.get("content-type") or entry["mimeType"]
