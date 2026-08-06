import json
import os
import re
import base64
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from auth import get_current_user
from models import User

router = APIRouter(prefix="/video", tags=["video"])

SEEDANCE_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
SEEDANCE_RESOLUTIONS = {"480p", "720p", "1080p"}
SEEDANCE_SECONDS = {4, 5, 6, 7, 8, 9, 10, 11, 12}

TOKENOPS_BASE_URL = os.getenv("TOKENOPS_BASE_URL", "https://api.tokenops.ai").rstrip("/")
TOKENOPS_VIDEO_MODEL = os.getenv(
    "TOKENOPS_VIDEO_MODEL",
    "doubao-seed-2-0-pro-260215",
)
TOKENOPS_VIDEO_ANALYSIS_MODE = os.getenv("TOKENOPS_VIDEO_ANALYSIS_MODE", "gemini").strip().lower()
TOKENOPS_GEMINI_MODEL = os.getenv("TOKENOPS_GEMINI_MODEL", "gemini-2.5-flash").strip()
TOKENOPS_GENERATION_MODEL = os.getenv("TOKENOPS_GENERATION_MODEL", "doubao-seedance-1-5-pro-251215").strip()
TOKENOPS_GENERATION_MODELS = os.getenv(
    "TOKENOPS_GENERATION_MODELS",
    ",".join(
        [
            "doubao-seedance-1-5-pro-251215:Seedance 1.5 Pro",
            "seedance-2-0:Seedance 2.0",
            "seedance-2-0-fast:Seedance 2.0 Fast",
            "seedance-2-0-mini:Seedance 2.0 Mini",
            "kling-3-0:Kling 3.0",
            "kling-3-0-omni:Kling 3.0 Omni",
            "veo-3-1:Veo 3.1",
            "veo-3-1-fast:Veo 3.1 Fast",
            "gemini-omni-flash:Gemini Omni Flash",
        ]
    ),
)
TOKENOPS_ASR_MODEL = os.getenv("TOKENOPS_ASR_MODEL", "whisper-1")
TOKENOPS_ASR_PATH = os.getenv("TOKENOPS_ASR_PATH", "/v1/audio/transcriptions")
TOKENOPS_INLINE_VIDEO_MAX_BYTES = int(os.getenv("TOKENOPS_INLINE_VIDEO_MAX_MB", "64")) * 1024 * 1024
TOKENOPS_GEMINI_INLINE_VIDEO_MAX_BYTES = int(os.getenv("TOKENOPS_GEMINI_INLINE_VIDEO_MAX_MB", "20")) * 1024 * 1024
VIDEO_FRAME_COUNT = int(os.getenv("VIDEO_ANALYSIS_FRAME_COUNT", "6"))
VIDEO_SEGMENT_SECONDS = float(os.getenv("VIDEO_ANALYSIS_SEGMENT_SECONDS", "8"))
VIDEO_MAX_SEGMENTS = int(os.getenv("VIDEO_ANALYSIS_MAX_SEGMENTS", "8"))
VIDEO_FRAMES_PER_SEGMENT = int(os.getenv("VIDEO_ANALYSIS_FRAMES_PER_SEGMENT", "2"))

VIDEO_ANALYSIS_PROMPT = """你是专业短视频拆解助手。请根据按时间顺序分段抽取的视频关键帧、以及音频转写文本分析整段视频，输出严格 JSON，不要 Markdown。
字段：
- summary: 一句话总结视频内容
- shot_count: 估算镜头数量，整数
- character_count: 主要人物数量，整数
- prop_count: 关键道具数量，整数
- scenes: 场景名称数组，最多 6 个
- items: 适合展示在工作流节点上的短句数组，最多 4 个
- storyboard: 分镜脚本数组，每项格式为 S01 镜头描述，最多 8 条
- report: 适合产品界面展示的对象，字段如下：
  - title: 镜头标题
  - description: 80字以内的镜头描述
  - narrative: 对象，包含 scene、character、dialogue
  - timing: 对象，包含 duration、start、end
  - camera: 对象，包含 shot_size、composition、shot_type、movement、focus
  - visual: 对象，包含 lighting、color、quality、editing
  - audio: 对象，包含 music、dialogue_function、shot_function
  - cta: 适合按钮上的下一步动作短句
- segments: 分段数组，每项包含 id、start、end、summary、narrative、camera、visual、audio、shots
重点拆解镜头、人物、场景、动作、情绪节奏、关键道具、对白/口播和可复刻的拍摄要点。声音信息优先参考音频转写；如果检测到音轨但转写失败，请在声音字段明确写出“检测到音轨，但 ASR 转写失败”。"""

GEMINI_VIDEO_ANALYSIS_PROMPT = """你是专业短视频拆解助手。请直接分析上传的完整视频，包括画面、人物、场景、动作、情绪节奏、字幕、口播/对白、音乐/音效和关键道具。
输出严格 JSON，不要 Markdown，不要解释。
字段：
- summary: 一句话总结视频内容
- shot_count: 估算镜头数量，整数
- character_count: 主要人物数量，整数
- prop_count: 关键道具数量，整数
- scenes: 场景名称数组，最多 6 个
- items: 适合展示在工作流节点上的短句数组，最多 4 个
- storyboard: 分镜脚本数组，每项格式为 S01 镜头描述，最多 8 条
- report: 适合产品界面展示的对象，字段如下：
  - title: 镜头标题
  - description: 80字以内的镜头描述
  - narrative: 对象，包含 scene、character、dialogue。dialogue 必须填写你从视频音频/字幕中判断到的口播、对白或“无人声，仅音乐/环境声”
  - timing: 对象，包含 duration、start、end
  - camera: 对象，包含 shot_size、composition、shot_type、movement、focus
  - visual: 对象，包含 lighting、color、quality、editing
  - audio: 对象，包含 music、dialogue_function、shot_function。请根据视频原始音轨判断，不要默认写“未从音频判断”
  - cta: 适合按钮上的下一步动作短句
- segments: 分段数组，每项包含 id、start、end、summary、narrative、camera、visual、audio、shots
重点产出可用于复刻拍摄和替换素材的结构化结果。"""


class VideoGenerateRequest(BaseModel):
    prompt: str
    model: str = TOKENOPS_GENERATION_MODEL
    ratio: str = "9:16"
    resolution: str = "720p"
    seconds: int = 8
    generate_audio: bool = True
    watermark: bool = False
    camerafixed: bool = False


def _video_model_options() -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_item in TOKENOPS_GENERATION_MODELS.split(","):
        item = raw_item.strip()
        if not item:
            continue
        model, _, label = item.partition(":")
        model = model.strip()
        if not model or model in seen:
            continue
        options.append({"model": model, "label": label.strip() or model})
        seen.add(model)

    if TOKENOPS_GENERATION_MODEL and TOKENOPS_GENERATION_MODEL not in seen:
        options.insert(0, {"model": TOKENOPS_GENERATION_MODEL, "label": TOKENOPS_GENERATION_MODEL})
    return options


def _select_generation_model(payload: VideoGenerateRequest) -> str:
    requested = payload.model.strip() or TOKENOPS_GENERATION_MODEL
    allowed = {item["model"] for item in _video_model_options()}
    if requested not in allowed:
        raise HTTPException(status_code=400, detail="不支持的视频生成模型")
    return requested


def _tokenops_key() -> str:
    key = os.getenv("TOKENOPS_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="TOKENOPS_API_KEY is not configured")
    return key


def _require_video(file: UploadFile) -> None:
    content_type = (file.content_type or "").lower()
    if content_type and not content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="请上传视频文件")


def _prepare_video_analysis(data: bytes, filename: str) -> dict[str, Any]:
    suffix = Path(filename).suffix or ".mp4"
    with tempfile.TemporaryDirectory() as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        input_path = tmp_dir / f"source{suffix}"
        input_path.write_bytes(data)

        duration = _probe_duration(input_path)
        segments = _build_segments(duration)
        frames = _extract_segment_frames(input_path, tmp_dir, segments)
        audio = _extract_audio(input_path, tmp_dir)

    if not frames:
        raise HTTPException(status_code=400, detail="无法抽取视频关键帧，请换一个标准 MP4 视频")

    return {
        "duration": duration,
        "segments": segments,
        "frames": frames,
        "audio": audio,
    }


def _build_segments(duration: float) -> list[dict[str, Any]]:
    if duration <= 0:
        return [{"id": "S01", "start": 0.0, "end": 0.0}]

    segment_count = max(1, min(VIDEO_MAX_SEGMENTS, int((duration + VIDEO_SEGMENT_SECONDS - 1) // VIDEO_SEGMENT_SECONDS)))
    segment_length = duration / segment_count
    return [
        {
            "id": f"S{index + 1:02d}",
            "start": round(index * segment_length, 3),
            "end": round(min(duration, (index + 1) * segment_length), 3),
        }
        for index in range(segment_count)
    ]


def _extract_segment_frames(
    input_path: Path,
    tmp_dir: Path,
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    frame_index = 1
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        timestamps = _segment_frame_timestamps(start, end, VIDEO_FRAMES_PER_SEGMENT)
        for timestamp in timestamps:
            output_path = tmp_dir / f"frame-{frame_index}.jpg"
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{timestamp:.3f}",
                "-i",
                str(input_path),
                "-frames:v",
                "1",
                "-q:v",
                "4",
                "-vf",
                "scale='min(960,iw)':-2",
                "-y",
                str(output_path),
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and output_path.exists():
                frames.append(
                    {
                        "index": frame_index,
                        "segment_id": segment["id"],
                        "timestamp": timestamp,
                        "data": output_path.read_bytes(),
                    }
                )
                frame_index += 1
    return frames


def _segment_frame_timestamps(start: float, end: float, count: int) -> list[float]:
    safe_count = max(1, min(count, 4))
    if end <= start:
        return [max(0.0, start)]
    return [start + (end - start) * (index + 0.5) / safe_count for index in range(safe_count)]


def _extract_audio(input_path: Path, tmp_dir: Path) -> dict[str, Any]:
    output_path = tmp_dir / "audio.mp3"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "-y",
        str(output_path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
    except subprocess.SubprocessError:
        return {"status": "failed", "data": b"", "mime_type": "audio/mpeg", "error": "音频提取失败"}

    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
        return {"status": "empty", "data": b"", "mime_type": "audio/mpeg", "error": "未检测到可转写音频"}

    return {
        "status": "ready",
        "data": output_path.read_bytes(),
        "mime_type": "audio/mpeg",
        "filename": "audio.mp3",
    }


def _extract_keyframes(data: bytes, filename: str) -> list[dict[str, Any]]:
    suffix = Path(filename).suffix or ".mp4"
    with tempfile.TemporaryDirectory() as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        input_path = tmp_dir / f"source{suffix}"
        input_path.write_bytes(data)

        duration = _probe_duration(input_path)
        timestamps = _frame_timestamps(duration, VIDEO_FRAME_COUNT)
        frames: list[dict[str, Any]] = []
        for index, timestamp in enumerate(timestamps, start=1):
            output_path = tmp_dir / f"frame-{index}.jpg"
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{timestamp:.3f}",
                "-i",
                str(input_path),
                "-frames:v",
                "1",
                "-q:v",
                "4",
                "-vf",
                "scale='min(960,iw)':-2",
                "-y",
                str(output_path),
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and output_path.exists():
                frames.append(
                    {
                        "index": index,
                        "timestamp": timestamp,
                        "data": output_path.read_bytes(),
                    }
                )

    if not frames:
        raise HTTPException(status_code=400, detail="无法抽取视频关键帧，请换一个标准 MP4 视频")
    return frames


def _probe_duration(input_path: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(input_path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            return max(0.0, float(result.stdout.strip() or "0"))
    except (ValueError, subprocess.SubprocessError):
        return 0.0
    return 0.0


def _probe_duration_from_bytes(data: bytes, filename: str) -> float:
    suffix = Path(filename).suffix or ".mp4"
    with tempfile.TemporaryDirectory() as tmp_dir_name:
        input_path = Path(tmp_dir_name) / f"source{suffix}"
        input_path.write_bytes(data)
        return _probe_duration(input_path)


def _frame_timestamps(duration: float, count: int) -> list[float]:
    safe_count = max(1, min(count, 10))
    if duration <= 0:
        return [0.0]
    if duration <= safe_count:
        return [max(0.0, duration * 0.5)]
    return [duration * (index + 0.5) / safe_count for index in range(safe_count)]


async def _upload_file(
    client: httpx.AsyncClient,
    key: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, str]:
    header_filename = quote(filename, safe="._-")[:255]
    response = await client.post(
        f"{TOKENOPS_BASE_URL}/v1/files/upload",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "filename": header_filename,
        },
        content=data,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps file upload failed"))

    payload = response.json()
    uri = str(payload.get("uri") or "").strip()
    mime_type = str(payload.get("mime_type") or content_type).strip()
    if not uri:
        raise HTTPException(status_code=502, detail="TokenOps file upload did not return a uri")
    return {"uri": uri, "mime_type": mime_type}


async def _upload_file_with_presigned_url(
    client: httpx.AsyncClient,
    key: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, str]:
    safe_name = quote(filename, safe="._-")[:180] or "video.mp4"
    response = await client.post(
        f"{TOKENOPS_BASE_URL}/v1/files/upload_url",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={
            "path": f"video_analysis/{safe_name}",
            "storage_provider": "COS",
        },
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps upload_url failed"))

    payload = response.json()
    upload_url = str(payload.get("upload_url") or "").strip()
    method = str(payload.get("method") or "PUT").strip().upper()
    file_uri = str(payload.get("path") or payload.get("visit_url") or "").strip()
    if not upload_url or not file_uri:
        raise HTTPException(status_code=502, detail="TokenOps upload_url did not return upload_url/path")

    upload_response = await client.request(
        method,
        upload_url,
        headers={"Content-Type": content_type},
        content=data,
    )
    if upload_response.status_code not in (200, 201, 204):
        raise HTTPException(status_code=502, detail="TokenOps presigned file upload failed")

    return {"uri": file_uri, "mime_type": content_type}


async def _analyze_gemini_video(
    client: httpx.AsyncClient,
    key: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> dict[str, Any]:
    mime_type = content_type if content_type.startswith("video/") else "video/mp4"
    file_uri = ""

    if len(data) <= TOKENOPS_GEMINI_INLINE_VIDEO_MAX_BYTES:
        parts: list[dict[str, Any]] = [
            {"text": GEMINI_VIDEO_ANALYSIS_PROMPT},
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64.b64encode(data).decode("ascii"),
                },
            },
        ]
    else:
        try:
            file_info = await _upload_file(client, key, filename, mime_type, data)
        except HTTPException:
            file_info = await _upload_file_with_presigned_url(client, key, filename, mime_type, data)

        file_uri = file_info["uri"]
        mime_type = file_info["mime_type"]
        parts = [
            {"text": GEMINI_VIDEO_ANALYSIS_PROMPT},
            {
                "fileData": {
                    "mimeType": mime_type,
                    "fileUri": file_uri,
                },
            },
        ]

    response = await _gemini_generate_content(client, key, parts)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps Gemini video analysis failed"))

    payload = response.json()
    payload["_tokenops_file_uri"] = file_uri
    payload["_tokenops_mime_type"] = mime_type
    return payload


async def _gemini_generate_content(
    client: httpx.AsyncClient,
    key: str,
    parts: list[dict[str, Any]],
) -> httpx.Response:
    try:
        return await client.post(
            f"{TOKENOPS_BASE_URL}/v1beta/models/{TOKENOPS_GEMINI_MODEL}:generateContent",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 6000,
                    "responseMimeType": "application/json",
                },
            },
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Gemini 视频分析超时，请稍后重试或换更短视频") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps Gemini 请求失败：{exc}") from exc


async def _analyze_file(
    client: httpx.AsyncClient,
    key: str,
    file_uri: str,
    mime_type: str,
    data: bytes,
) -> dict[str, Any]:
    response = await _chat_completion(client, key, file_uri)
    if response.status_code < 400:
        return response.json()

    first_error = _remote_error(response, "TokenOps video analysis failed")
    if not _should_retry_inline_video(first_error):
        raise HTTPException(status_code=502, detail=first_error)

    if len(data) > TOKENOPS_INLINE_VIDEO_MAX_BYTES:
        limit_mb = TOKENOPS_INLINE_VIDEO_MAX_BYTES // 1024 // 1024
        raise HTTPException(
            status_code=502,
            detail=f"TokenOps 不接受 file uri 视频输入；当前视频超过 {limit_mb}MB，无法自动改用 Base64，请换更短视频或公网视频链接",
        )

    inline_url = _video_data_url(data, mime_type)
    retry_response = await _chat_completion(client, key, inline_url)
    if retry_response.status_code >= 400:
        retry_error = _remote_error(retry_response, "TokenOps video analysis failed")
        raise HTTPException(status_code=502, detail=retry_error)
    return retry_response.json()


async def _chat_completion(client: httpx.AsyncClient, key: str, video_url: str) -> httpx.Response:
    response = await client.post(
        f"{TOKENOPS_BASE_URL}/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={
            "model": TOKENOPS_VIDEO_MODEL,
            "messages": [
                {"role": "system", "content": "你只输出合法 JSON。"},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VIDEO_ANALYSIS_PROMPT},
                        {"type": "video_url", "video_url": {"url": video_url, "fps": 1}},
                    ],
                },
            ],
            "temperature": 0.2,
            "max_completion_tokens": 1800,
            "response_format": {"type": "json_object"},
        },
    )
    return response


async def _analyze_frames(
    client: httpx.AsyncClient,
    key: str,
    frames: list[dict[str, Any]],
    duration: float,
    segments: list[dict[str, Any]],
    transcript: dict[str, Any],
) -> dict[str, Any]:
    segment_lines = "\n".join(
        f"{segment['id']}: {segment['start']:.1f}s-{segment['end']:.1f}s"
        for segment in segments
    )
    frame_lines = "\n".join(
        f"F{frame['index']}: {frame['segment_id']} @ {frame['timestamp']:.1f}s"
        for frame in frames
    )
    transcript_text = str(transcript.get("text") or "").strip()
    transcript_status = str(transcript.get("status") or "empty")
    transcript_error = str(transcript.get("error") or "").strip()
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"{VIDEO_ANALYSIS_PROMPT}\n"
                f"视频总时长约 {duration:.1f}s。\n"
                f"分段：\n{segment_lines}\n"
                f"关键帧映射：\n{frame_lines}\n"
                f"音频转写状态：{transcript_status}\n"
                f"音频转写错误：{transcript_error or '无'}\n"
                f"音频转写文本：{transcript_text or '无可用转写文本'}"
            ),
        }
    ]
    for frame in frames:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": _image_data_url(frame["data"]),
                    "detail": "high",
                },
            }
        )

    try:
        response = await client.post(
            f"{TOKENOPS_BASE_URL}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": TOKENOPS_VIDEO_MODEL,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON。"},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.2,
                "max_completion_tokens": 6000,
                "response_format": {"type": "json_object"},
            },
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="豆包模型分析超时，请稍后重试或换更短视频") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps 请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps video analysis failed"))
    return response.json()


async def _transcribe_audio(
    client: httpx.AsyncClient,
    key: str,
    audio: dict[str, Any],
) -> dict[str, Any]:
    if audio.get("status") != "ready" or not audio.get("data"):
        return {
            "status": audio.get("status") or "empty",
            "text": "",
            "segments": [],
            "error": audio.get("error") or "未检测到可转写音频",
        }

    try:
        response = await client.post(
            f"{TOKENOPS_BASE_URL}{TOKENOPS_ASR_PATH}",
            headers={"Authorization": f"Bearer {key}"},
            data={
                "model": TOKENOPS_ASR_MODEL,
                "response_format": "verbose_json",
                "temperature": "0",
            },
            files={
                "file": (
                    audio.get("filename") or "audio.mp3",
                    audio["data"],
                    audio.get("mime_type") or "audio/mpeg",
                )
            },
        )
    except httpx.TimeoutException:
        return {"status": "failed", "text": "", "segments": [], "error": "音频转写超时"}
    except httpx.HTTPError as exc:
        return {"status": "failed", "text": "", "segments": [], "error": f"音频转写请求失败：{exc}"}

    if response.status_code >= 400:
        error = _remote_error(response, "音频转写失败")
        if response.status_code == 404:
            error = f"TokenOps 未开放 {TOKENOPS_ASR_PATH} 或当前模型不支持 ASR（404 Not Found）"
        return {
            "status": "failed",
            "text": "",
            "segments": [],
            "error": error,
        }

    try:
        payload = response.json()
    except ValueError:
        return {"status": "done", "text": response.text.strip(), "segments": [], "raw": response.text}

    if isinstance(payload, dict):
        return {
            "status": "done",
            "text": str(payload.get("text") or "").strip(),
            "segments": payload.get("segments") if isinstance(payload.get("segments"), list) else [],
            "raw": payload,
        }

    return {"status": "done", "text": str(payload).strip(), "segments": [], "raw": payload}


def _should_retry_inline_video(message: str) -> bool:
    normalized = message.lower()
    return "format error" in normalized or "格式" in message or "video" in normalized


def _video_data_url(data: bytes, mime_type: str) -> str:
    safe_mime_type = mime_type if mime_type.startswith("video/") else "video/mp4"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{safe_mime_type};base64,{encoded}"


def _image_data_url(data: bytes) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _remote_error(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip() or fallback
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if payload.get("message"):
            return str(payload["message"])
        if payload.get("detail"):
            return str(payload["detail"])
    return fallback


def _choice_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    return ""


def _gemini_content(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first = candidates[0]
    if not isinstance(first, dict):
        return ""
    content = first.get("content")
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""
    return "\n".join(str(part.get("text") or "") for part in parts if isinstance(part, dict) and part.get("text")).strip()


def _parse_analysis(content: str) -> dict[str, Any]:
    parsed = _loads_json_object(content)

    items = _string_list(parsed.get("items")) or _string_list(parsed.get("scenes"))
    storyboard = _string_list(parsed.get("storyboard"))
    return {
        "summary": str(parsed.get("summary") or content).strip(),
        "shots": _safe_int(parsed.get("shot_count"), 0),
        "characters": _safe_int(parsed.get("character_count"), 0),
        "props": _safe_int(parsed.get("prop_count"), 0),
        "scenes": _string_list(parsed.get("scenes")),
        "items": items[:4],
        "storyboard": storyboard[:8],
        "raw": parsed or {"content": content},
    }


def _loads_json_object(content: str) -> dict[str, Any]:
    cleaned = _clean_json_content(content)
    candidates = [cleaned]

    segments_index = cleaned.find('"segments"')
    if segments_index > 0:
        prefix = cleaned[:segments_index].rstrip()
        if prefix.endswith(","):
            prefix = prefix[:-1]
        candidates.append(prefix + "\n}")

    match = re.search(r"\{.*\}", cleaned, flags=re.S)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        parsed = _try_load_json(candidate)
        if isinstance(parsed, dict):
            return parsed

    return {}


def _clean_json_content(content: str) -> str:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _try_load_json(content: str) -> Any:
    try:
        parsed = json.loads(content)
    except ValueError:
        return None
    if isinstance(parsed, str):
        return _try_load_json(parsed)
    return parsed


def _safe_int(value: Any, default: int) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _ensure_report(
    analysis: dict[str, Any],
    duration: float,
    segments: list[dict[str, Any]],
    transcript: dict[str, Any],
) -> None:
    raw = analysis.get("raw")
    if not isinstance(raw, dict):
        raw = {"content": analysis.get("summary", "")}
        analysis["raw"] = raw

    audio_note = _audio_note(transcript)
    if not isinstance(raw.get("report"), dict):
        transcript_text = str(transcript.get("text") or "").strip() or audio_note
        scene_text = "、".join(analysis.get("scenes") or []) or "已识别画面场景"
        raw["report"] = {
            "title": "视频拆解报告",
            "description": analysis.get("summary") or "已完成视频结构拆解。",
            "narrative": {
                "scene": scene_text,
                "character": f"{analysis.get('characters') or '已识别'} 个主要人物/角色线索",
                "dialogue": transcript_text,
            },
            "timing": {
                "duration": f"{duration:.1f}s" if duration else "待补充",
                "start": "00:00:00.000",
                "end": f"{duration:.1f}s" if duration else "待补充",
            },
            "camera": {
                "shot_size": f"{analysis.get('shots') or '已识别'} 个镜头/片段线索",
                "composition": "按时间顺序抽取关键帧综合判断",
                "shot_type": "分段视频分析",
                "movement": "已根据片段顺序识别画面变化",
                "focus": "主体与背景关系已识别",
            },
            "visual": {
                "lighting": "光影与色调已识别",
                "color": scene_text,
                "quality": "基于上传视频关键帧分析",
                "editing": "已按片段切分并汇总节奏",
            },
            "audio": {
                "music": audio_note if not str(transcript.get("text") or "").strip() else "检测到可用音频/口播线索",
                "dialogue_function": transcript_text,
                "shot_function": "结合画面与音频转写生成叙事判断",
            },
            "cta": "前往替换 & 定制",
        }
    elif audio_note != "未从音频判断":
        report = raw["report"]
        audio = report.get("audio") if isinstance(report.get("audio"), dict) else {}
        report["audio"] = {
            **audio,
            "music": audio.get("music") if audio.get("music") and "未从音频判断" not in str(audio.get("music")) else audio_note,
            "dialogue_function": audio.get("dialogue_function") if audio.get("dialogue_function") and "未从音频判断" not in str(audio.get("dialogue_function")) else audio_note,
            "shot_function": audio.get("shot_function") if audio.get("shot_function") and "未从音频判断" not in str(audio.get("shot_function")) else audio_note,
        }

    if not isinstance(raw.get("segments"), list):
        storyboard = analysis.get("storyboard") if isinstance(analysis.get("storyboard"), list) else []
        raw["segments"] = [
            {
                "id": segment["id"],
                "start": segment["start"],
                "end": segment["end"],
                "summary": storyboard[index] if index < len(storyboard) else "已完成分段分析",
            }
            for index, segment in enumerate(segments)
        ]


def _audio_note(transcript: dict[str, Any]) -> str:
    text = str(transcript.get("text") or "").strip()
    if text:
        return text

    status = str(transcript.get("status") or "").strip()
    error = str(transcript.get("error") or "").strip()
    if status == "failed":
        return f"检测到音轨，但 ASR 转写失败：{error or '未知错误'}"
    if status == "ready":
        return "检测到音轨，但未获得转写文本"
    return "未从音频判断"


def _validate_generation_request(payload: VideoGenerateRequest) -> None:
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="生成提示词不能为空")
    _select_generation_model(payload)
    if payload.ratio not in SEEDANCE_RATIOS:
        raise HTTPException(status_code=400, detail="不支持的视频比例")
    if payload.resolution not in SEEDANCE_RESOLUTIONS:
        raise HTTPException(status_code=400, detail="不支持的视频分辨率")
    if payload.seconds not in SEEDANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Seedance 1.5 Pro 时长需在 4-12 秒之间")


@router.get("/models")
async def list_video_generation_models(_: User = Depends(get_current_user)):
    return {"models": _video_model_options(), "default": TOKENOPS_GENERATION_MODEL}


@router.post("/generate")
async def generate_video(
    payload: VideoGenerateRequest,
    _: User = Depends(get_current_user),
):
    _validate_generation_request(payload)
    key = _tokenops_key()
    model = _select_generation_model(payload)
    request_payload = {
        "model": model,
        "content": [{"type": "text", "text": payload.prompt.strip()}],
        "ratio": payload.ratio,
        "resolution": payload.resolution,
        "seconds": str(payload.seconds),
        "framespersecond": 24,
        "generate_audio": payload.generate_audio,
        "watermark": payload.watermark,
        "camerafixed": payload.camerafixed,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20)) as client:
            response = await client.post(
                f"{TOKENOPS_BASE_URL}/v1/videos",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=request_payload,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="视频生成任务创建超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps 视频生成请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps video generation failed"))

    result = response.json()
    return {
        **result,
        "model": result.get("model") or model,
        "request": {
            "model": model,
            "ratio": payload.ratio,
            "resolution": payload.resolution,
            "seconds": payload.seconds,
            "generate_audio": payload.generate_audio,
            "watermark": payload.watermark,
            "camerafixed": payload.camerafixed,
        },
    }


@router.get("/generate/{video_id}")
async def get_generated_video_status(
    video_id: str,
    _: User = Depends(get_current_user),
):
    key = _tokenops_key()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20)) as client:
            response = await client.get(
                f"{TOKENOPS_BASE_URL}/v1/videos/{video_id}",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="视频生成状态查询超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps 状态查询失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps video status failed"))

    result = response.json()
    return {
        **result,
        "content_path": f"/api/video/generate/{video_id}/content" if result.get("status") == "completed" else "",
    }


@router.get("/generate/{video_id}/content")
async def download_generated_video(
    video_id: str,
    _: User = Depends(get_current_user),
):
    key = _tokenops_key()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
            response = await client.get(
                f"{TOKENOPS_BASE_URL}/v1/videos/{video_id}/content",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="生成视频下载超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TokenOps 视频下载失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "TokenOps video download failed"))

    media_type = response.headers.get("content-type") or "video/mp4"
    return Response(content=response.content, media_type=media_type)


@router.post("/analyze")
async def analyze_video(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    _require_video(file)
    key = _tokenops_key()
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="视频文件为空")

    filename = file.filename or "video.mp4"
    content_type = file.content_type or "application/octet-stream"

    if TOKENOPS_VIDEO_ANALYSIS_MODE == "gemini":
        duration = _probe_duration_from_bytes(data, filename)
        segments = _build_segments(duration)
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20)) as client:
            completion = await _analyze_gemini_video(client, key, filename, content_type, data)

        content = _gemini_content(completion)
        if not content:
            raise HTTPException(status_code=502, detail="TokenOps Gemini returned an empty analysis")

        transcript = {"status": "native_video", "text": "", "segments": [], "error": ""}
        analysis = _parse_analysis(content)
        _ensure_report(analysis, duration, segments, transcript)
        return {
            "model": TOKENOPS_GEMINI_MODEL,
            "provider": "gemini",
            "file_uri": completion.get("_tokenops_file_uri", ""),
            "mime_type": completion.get("_tokenops_mime_type", content_type),
            "content": content,
            "duration": duration,
            "segments": segments,
            "transcript": transcript,
            **analysis,
        }

    prepared = _prepare_video_analysis(data, filename)

    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
        transcript = await _transcribe_audio(client, key, prepared["audio"])
        completion = await _analyze_frames(
            client,
            key,
            prepared["frames"],
            prepared["duration"],
            prepared["segments"],
            transcript,
        )

    content = _choice_content(completion)
    if not content:
        raise HTTPException(status_code=502, detail="TokenOps returned an empty analysis")

    analysis = _parse_analysis(content)
    _ensure_report(analysis, prepared["duration"], prepared["segments"], transcript)
    return {
        "model": TOKENOPS_VIDEO_MODEL,
        "provider": "doubao_frames",
        "file_uri": "",
        "mime_type": content_type,
        "content": content,
        "duration": prepared["duration"],
        "segments": prepared["segments"],
        "transcript": transcript,
        **analysis,
    }
