from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from models import User

router = APIRouter(prefix="/text", tags=["text"])
logger = logging.getLogger("uvicorn.error")

TOKENOPS_BASE_URL = os.getenv("TOKENOPS_BASE_URL", "https://api.tokenops.ai").rstrip("/")
ARK_API_KEY = os.getenv("ARK_API_KEY", "").strip()
TEXT_POLISH_API_KEY = ARK_API_KEY or os.getenv("TEXT_POLISH_API_KEY", "").strip() or os.getenv("TOKENOPS_API_KEY", "").strip()
TEXT_POLISH_BASE_URL = (
    (os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3") if ARK_API_KEY else os.getenv("TEXT_POLISH_BASE_URL", f"{TOKENOPS_BASE_URL}/v1"))
    .strip()
    .rstrip("/")
)
TEXT_POLISH_MODEL = (
    (os.getenv("ARK_POLISH_MODEL", "doubao-seed-2-0-pro-260215") if ARK_API_KEY else os.getenv("TEXT_POLISH_MODEL", "doubao-seed-2-0-pro-260215"))
    .strip()
)
QWEN_TEXT_MODEL = os.getenv("QWEN_TEXT_MODEL", "qwen3.8-max").strip()
QWEN_TEXT_API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip() or os.getenv("QWEN_API_KEY", "").strip()
QWEN_COMPATIBLE_BASE_URL = (
    os.getenv("QWEN_COMPATIBLE_BASE_URL", os.getenv("DASHSCOPE_COMPATIBLE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"))
    .strip()
    .rstrip("/")
)
QWEN_TEXT_ENABLE_THINKING = os.getenv("QWEN_TEXT_ENABLE_THINKING", "false").strip().lower() in {"1", "true", "yes", "on"}
TEXT_GENERATION_MODELS = os.getenv(
    "TEXT_GENERATION_MODELS",
    f"{TEXT_POLISH_MODEL}:Doubao Seed 2.0 Pro,{QWEN_TEXT_MODEL}:Qwen3.8-Max",
)
TEXT_STREAM_READ_TIMEOUT_SECONDS = float(os.getenv("TEXT_STREAM_READ_TIMEOUT_SECONDS", "45"))
TEXT_COMPLETE_TIMEOUT_SECONDS = float(os.getenv("TEXT_COMPLETE_TIMEOUT_SECONDS", "150"))

POLISH_SYSTEM_PROMPT = (
    "你是短剧剧本与分镜生成助手。"
    "在不改变用户素材、人物、场景、商品和镜头意图的前提下，"
    "直接生成适合短视频制作链路使用的短剧剧本、分镜、台词和转场节奏。"
    "保留用户给出的素材引用和关键限制。"
    "只输出生成结果正文，不要解释。"
)


class TextGenerateRequest(BaseModel):
    prompt_text: str = Field(..., min_length=1)
    doubao_instruction: str = ""
    model: Optional[str] = None


class TextGenerateError(RuntimeError):
    pass


def _parse_text_models() -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in TEXT_GENERATION_MODELS.split(","):
        value = raw.strip()
        if not value:
            continue
        model, _, label = value.partition(":")
        model = model.strip()
        if not model or model in seen:
            continue
        models.append({"model": model, "label": label.strip() or model})
        seen.add(model)
    if TEXT_POLISH_MODEL and TEXT_POLISH_MODEL not in seen:
        models.insert(0, {"model": TEXT_POLISH_MODEL, "label": "Doubao Seed 2.0 Pro"})
        seen.add(TEXT_POLISH_MODEL)
    if QWEN_TEXT_MODEL and QWEN_TEXT_MODEL not in seen:
        models.append({"model": QWEN_TEXT_MODEL, "label": "Qwen3.8-Max"})
    return models


def _selected_model(body: TextGenerateRequest) -> str:
    model = (body.model or TEXT_POLISH_MODEL).strip() or TEXT_POLISH_MODEL
    available = {item["model"] for item in _parse_text_models()}
    if available and model not in available:
        raise HTTPException(status_code=400, detail=f"unsupported text model: {model}")
    return model


def _is_qwen_model(model: str) -> bool:
    return model == QWEN_TEXT_MODEL or model.startswith("qwen")


def _jsonl(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _chat_completions_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return f"{base}/chat/completions"


def _build_payload(body: TextGenerateRequest, *, model: str, stream: bool = True) -> dict[str, Any]:
    prompt = body.prompt_text.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt text is required")
    messages: list[dict[str, str]] = [{"role": "system", "content": POLISH_SYSTEM_PROMPT}]
    instruction = body.doubao_instruction.strip()
    if instruction:
        messages.append({"role": "system", "content": f"额外处理指令：{instruction}"})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": model,
        "messages": messages,
        "temperature": 0.35,
        "stream": stream,
    }


def _build_provider_payload(body: TextGenerateRequest, *, model: str, stream: bool = True) -> dict[str, Any]:
    payload = _build_payload(body, model=model, stream=stream)
    if _is_qwen_model(model):
        payload["enable_thinking"] = QWEN_TEXT_ENABLE_THINKING
    return payload


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _provider_headers(model: str, api_key: str) -> dict[str, str]:
    headers = _auth_headers(api_key)
    if _is_qwen_model(model):
        headers["X-DashScope-DataInspection"] = '{"input":"disable","output":"disable"}'
    return headers


def _safe_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: "<redacted>" if key.lower() == "authorization" else value
        for key, value in headers.items()
    }


def _log_provider_request(
    *,
    model: str,
    base_url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    request_mode: str,
) -> None:
    if not _is_qwen_model(model):
        return
    logger.info(
        "Qwen text API request mode=%s url=%s headers=%s payload=%s",
        request_mode,
        _chat_completions_url(base_url),
        json.dumps(_safe_headers(headers), ensure_ascii=False),
        json.dumps(payload, ensure_ascii=False),
    )


def _provider_request_id(response: httpx.Response) -> str:
    for header in ("x-request-id", "x-dashscope-request-id", "request-id"):
        value = response.headers.get(header)
        if value:
            return value
    return ""


def _log_provider_response_id(*, model: str, response: httpx.Response, request_mode: str) -> None:
    if not _is_qwen_model(model):
        return
    request_id = _provider_request_id(response)
    logger.info(
        "Qwen text API response mode=%s status=%s request_id=%s",
        request_mode,
        response.status_code,
        request_id or "<missing>",
    )


def _stream_delta_content(line: str) -> str:
    if not line.startswith("data:"):
        return ""
    data_text = line.removeprefix("data:").strip()
    if not data_text or data_text == "[DONE]":
        return ""
    try:
        data = json.loads(data_text)
    except json.JSONDecodeError:
        return ""
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    return str(delta.get("content") or "")


def _message_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def _completion_content(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message") or {}
    if isinstance(message, dict):
        content = _message_content_text(message.get("content"))
        if content:
            return content
    return str(first.get("text") or "")


def _provider_config(model: str) -> tuple[str, str, str]:
    if _is_qwen_model(model):
        return QWEN_COMPATIBLE_BASE_URL, QWEN_TEXT_API_KEY, "DASHSCOPE_API_KEY 或 QWEN_API_KEY 未配置"
    return TEXT_POLISH_BASE_URL, TEXT_POLISH_API_KEY, "ARK_API_KEY 或 TOKENOPS_API_KEY 未配置"


async def _complete_text(body: TextGenerateRequest, model: str) -> str:
    base_url, api_key, missing_message = _provider_config(model)
    if not api_key:
        raise TextGenerateError(missing_message)

    payload = _build_provider_payload(body, model=model, stream=False)
    headers = _provider_headers(model, api_key)
    _log_provider_request(model=model, base_url=base_url, headers=headers, payload=payload, request_mode="complete")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(TEXT_COMPLETE_TIMEOUT_SECONDS, connect=20)) as client:
            response = await client.post(_chat_completions_url(base_url), headers=headers, json=payload)
            _log_provider_response_id(model=model, response=response, request_mode="complete")
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                body_text = exc.response.text.strip()
                raise TextGenerateError(body_text or exc.response.reason_phrase) from exc
            content = _completion_content(response.json()).strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise TextGenerateError(str(exc)) from exc

    if not content:
        raise TextGenerateError("empty text response")
    return content


async def _stream_text(body: TextGenerateRequest, model: str) -> AsyncIterator[str]:
    base_url, api_key, missing_message = _provider_config(model)
    if not api_key:
        raise TextGenerateError(missing_message)

    payload = _build_provider_payload(body, model=model, stream=True)
    headers = _provider_headers(model, api_key)
    _log_provider_request(model=model, base_url=base_url, headers=headers, payload=payload, request_mode="stream")
    saw_content = False
    try:
        timeout = httpx.Timeout(
            TEXT_STREAM_READ_TIMEOUT_SECONDS + 30,
            connect=20,
            read=TEXT_STREAM_READ_TIMEOUT_SECONDS,
            write=20,
            pool=20,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                _chat_completions_url(base_url),
                headers=headers,
                json=payload,
            ) as response:
                _log_provider_response_id(model=model, response=response, request_mode="stream")
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    body_text = (await exc.response.aread()).decode("utf-8", errors="ignore").strip()
                    raise TextGenerateError(body_text or exc.response.reason_phrase) from exc
                async for line in response.aiter_lines():
                    content = _stream_delta_content(line)
                    if content:
                        saw_content = True
                        yield content
    except httpx.HTTPError as exc:
        raise TextGenerateError(str(exc)) from exc

    if not saw_content:
        raise TextGenerateError("empty text response")


@router.get("/models")
async def list_text_models(_: User = Depends(get_current_user)):
    return {"models": _parse_text_models(), "default": TEXT_POLISH_MODEL}


@router.post("/generate/stream")
async def stream_text_generation(
    body: TextGenerateRequest,
    _: User = Depends(get_current_user),
):
    model = _selected_model(body)
    model_label = next((item["label"] for item in _parse_text_models() if item["model"] == model), model)

    async def event_stream():
        accumulated: list[str] = []
        try:
            yield _jsonl({"type": "status", "text": f"正在连接{model_label}模型"})
            try:
                async for chunk in _stream_text(body, model):
                    if not accumulated:
                        yield _jsonl({"type": "status", "text": f"{model_label}已开始返回内容"})
                    accumulated.append(chunk)
                    yield _jsonl({"type": "delta", "text": chunk})
            except TextGenerateError:
                if accumulated:
                    raise
                yield _jsonl({"type": "status", "text": "流式响应较慢，切换普通生成"})
                content = await _complete_text(body, model)
                accumulated.append(content)
                yield _jsonl({"type": "delta", "text": content})
        except TextGenerateError as exc:
            yield _jsonl({"type": "error", "detail": str(exc) or "text generation failed"})
            return
        yield _jsonl({"type": "done", "prompt_text": "".join(accumulated).strip()})

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
