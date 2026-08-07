from __future__ import annotations

import json
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


def _jsonl(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _chat_completions_url() -> str:
    base = TEXT_POLISH_BASE_URL.rstrip("/")
    return f"{base}/chat/completions"


def _build_payload(body: TextGenerateRequest, *, stream: bool = True) -> dict[str, Any]:
    prompt = body.prompt_text.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt text is required")
    messages: list[dict[str, str]] = [{"role": "system", "content": POLISH_SYSTEM_PROMPT}]
    instruction = body.doubao_instruction.strip()
    if instruction:
        messages.append({"role": "system", "content": f"额外处理指令：{instruction}"})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": (body.model or TEXT_POLISH_MODEL).strip() or TEXT_POLISH_MODEL,
        "messages": messages,
        "temperature": 0.35,
        "stream": stream,
    }


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TEXT_POLISH_API_KEY}",
        "Content-Type": "application/json",
    }


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


async def _complete_text(body: TextGenerateRequest) -> str:
    if not TEXT_POLISH_API_KEY:
        raise TextGenerateError("ARK_API_KEY 或 TOKENOPS_API_KEY 未配置")

    payload = _build_payload(body, stream=False)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(TEXT_COMPLETE_TIMEOUT_SECONDS, connect=20)) as client:
            response = await client.post(_chat_completions_url(), headers=_auth_headers(), json=payload)
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


async def _stream_text(body: TextGenerateRequest) -> AsyncIterator[str]:
    if not TEXT_POLISH_API_KEY:
        raise TextGenerateError("ARK_API_KEY 或 TOKENOPS_API_KEY 未配置")

    payload = _build_payload(body, stream=True)
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
                _chat_completions_url(),
                headers=_auth_headers(),
                json=payload,
            ) as response:
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


@router.post("/generate/stream")
async def stream_text_generation(
    body: TextGenerateRequest,
    _: User = Depends(get_current_user),
):
    async def event_stream():
        accumulated: list[str] = []
        try:
            yield _jsonl({"type": "status", "text": "正在连接豆包模型"})
            try:
                async for chunk in _stream_text(body):
                    if not accumulated:
                        yield _jsonl({"type": "status", "text": "豆包已开始返回内容"})
                    accumulated.append(chunk)
                    yield _jsonl({"type": "delta", "text": chunk})
            except TextGenerateError:
                if accumulated:
                    raise
                yield _jsonl({"type": "status", "text": "流式响应较慢，切换普通生成"})
                content = await _complete_text(body)
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
