import json
import os
import re
import base64
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from lovart import LovartAPIError, LovartClient
from models import Asset, User
from storage import safe_storage_name, storage

router = APIRouter(prefix="/video", tags=["video"])

SEEDANCE_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
SEEDANCE_RESOLUTIONS = {"480p", "720p", "1080p", "4k"}
SEEDANCE_SECONDS = {4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}

TOKENOPS_BASE_URL = os.getenv("TOKENOPS_BASE_URL", "https://api.tokenops.ai").rstrip("/")
TOKENOPS_VIDEO_MODEL = os.getenv(
    "TOKENOPS_VIDEO_MODEL",
    "doubao-seed-2-0-pro-260215",
)
VIDEO_SPEC_MODEL = os.getenv("VIDEO_SPEC_MODEL", os.getenv("TEXT_POLISH_MODEL", "doubao-seed-2-0-pro-260215")).strip()
TOKENOPS_VIDEO_ANALYSIS_MODE = os.getenv("TOKENOPS_VIDEO_ANALYSIS_MODE", "gemini").strip().lower()
TOKENOPS_GEMINI_MODEL = os.getenv("TOKENOPS_GEMINI_MODEL", "gemini-2.5-flash").strip()
TOKENOPS_GENERATION_MODEL = os.getenv("TOKENOPS_GENERATION_MODEL", "doubao-seedance-1-5-pro-251215").strip()
BDS_PRO_MODEL = "bds-pro"
TOKENOPS_SEEDANCE_15_MODEL = "doubao-seedance-1-5-pro-251215"
LOVART_VIDEO_PREFIX = "lovart:"
WAN22_I2V_MODEL = "wan2.2-i2v-spicy"
WAN27_I2V_MODEL = "wan2.7-i2v-spicy"
WAN_VIDEO_PREFIX = "wan:"
BDS_A2_BASE_URL = os.getenv("BDS_A2_BASE_URL", os.getenv("A2_VIDEO_BASE_URL", "https://cu-api.uniphore-ai.com")).rstrip("/")
MULEROUTER_BASE_URL = os.getenv(
    "MULEROUTER_BASE_URL",
    os.getenv("MULEROUTER_VIDEO_BASE_URL", "https://api.mulerouter.ai"),
).rstrip("/")
TOKENOPS_GENERATION_MODELS = os.getenv(
    "TOKENOPS_GENERATION_MODELS",
    ",".join(
        [
            f"{BDS_PRO_MODEL}:Bds Pro",
            f"{WAN22_I2V_MODEL}:Wan 2.2",
            f"{WAN27_I2V_MODEL}:Wan 2.7",
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
    reference_images: list[str] = Field(default_factory=list)


class VideoSpecParams(BaseModel):
    ratio: str = "9:16"
    resolution: str = "720p"
    seconds: int = 8
    generate_audio: bool = True
    camerafixed: bool = False


class VideoSpecContextItem(BaseModel):
    label: str = ""
    text: str = ""


class VideoSpecRequest(BaseModel):
    user_prompt: str = ""
    model: str = TOKENOPS_GENERATION_MODEL
    params: VideoSpecParams = Field(default_factory=VideoSpecParams)
    scripts: list[VideoSpecContextItem] = Field(default_factory=list)
    summaries: list[VideoSpecContextItem] = Field(default_factory=list)
    reference_image_count: int = 0


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


def _is_bds_model(model: str) -> bool:
    return model == BDS_PRO_MODEL


def _is_tokenops_video_model(model: str) -> bool:
    return model == TOKENOPS_SEEDANCE_15_MODEL


def _is_mulerouter_video_model(model: str) -> bool:
    return model in {WAN22_I2V_MODEL, WAN27_I2V_MODEL}


def _tokenops_video_reference_limit(model: str) -> int:
    if model == TOKENOPS_SEEDANCE_15_MODEL:
        return 2
    return 4


def _tokenops_video_reference_role(model: str, index: int) -> str:
    if model == TOKENOPS_SEEDANCE_15_MODEL:
        return "first_frame" if index == 0 else "last_frame"
    return "reference_image"


def _tokenops_key() -> str:
    key = os.getenv("TOKENOPS_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="TOKENOPS_API_KEY is not configured")
    return key


def _mulerouter_key() -> str:
    key = (
        os.getenv("MULEROUTER_API_KEY", "").strip()
        or os.getenv("MULEROUTER_VIDEO_API_KEY", "").strip()
        or os.getenv("SEEDREAMBEST_VIDEO_PROVIDER_API_KEY", "").strip()
    )
    if not key:
        raise HTTPException(status_code=500, detail="MULEROUTER_API_KEY is not configured")
    return key


def _compact_text(text: str, limit: int) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    return f"{normalized[:limit]}..." if len(normalized) > limit else normalized


def _requested_shots(prompt: str) -> list[int]:
    values: list[int] = []
    for match in re.finditer(r"(?:第\s*)?(\d{1,2})(?:\s*[、,，和至到-]\s*(\d{1,2}))?\s*(?:个)?(?:分镜|镜头|镜|片段|脚本|段)", prompt):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        if start <= end and end - start <= 12:
            values.extend(range(start, end + 1))
        else:
            values.append(start)
    if not values:
        prefix = re.split(r"\n|视频参数：", prompt, maxsplit=1)[0]
        values = [int(item) for item in re.findall(r"\d{1,2}", prefix) if 0 < int(item) <= 99]
    deduped: list[int] = []
    for value in values:
        if value not in deduped and 0 < value <= 99:
            deduped.append(value)
    return deduped[:8]


def _script_rows_for_shots(script: str, shots: list[int]) -> str:
    if not shots:
        return ""
    wanted = {str(value) for value in shots}
    rows: list[str] = []
    for raw_line in script.splitlines():
        line = raw_line.strip()
        match = re.match(r"^\|?\s*(\d{1,2})\s*\|", line)
        if match and match.group(1) in wanted:
            rows.append(line)
    return "\n".join(rows)


def _fallback_video_spec(body: VideoSpecRequest) -> dict[str, Any]:
    user_prompt = body.user_prompt.strip() or "基于上游素材生成一段短视频"
    target_shots = _requested_shots(user_prompt)
    selected_rows = "\n".join(
        row
        for item in body.scripts
        if (row := _script_rows_for_shots(item.text, target_shots))
    )
    if not selected_rows:
        selected_rows = "\n".join(
            f"{item.label}：{_compact_text(item.text, 180)}"
            for item in body.summaries[:3]
            if item.text.strip()
        )
    is_bds = body.model == BDS_PRO_MODEL
    shot_label = "、".join(f"S{value:02d}" for value in target_shots) if target_shots else "自动"
    generation_prompt = "\n".join(
        item
        for item in [
            _compact_text(user_prompt, 180),
            (
                f"生成一个连续单镜头图生视频，不要生成整部剧，不要拆成多镜头。画幅 {body.params.ratio}，"
                f"时长 {body.params.seconds}s，分辨率 {body.params.resolution}。"
                if is_bds
                else f"生成对应短视频片段。画幅 {body.params.ratio}，时长 {body.params.seconds}s，分辨率 {body.params.resolution}。"
            ),
            f"参考分镜：{_compact_text(selected_rows, 620)}" if selected_rows else "",
            f"参考图片：使用已附加的 {body.reference_image_count} 张上游图片。" if body.reference_image_count else "",
            "主体清晰，动作自然，镜头运动轻微，商业短视频质感，不要文字、水印、Logo。",
        ]
        if item
    )
    return {
        "model": body.model,
        "target_shots": target_shots,
        "intent_summary": _compact_text(user_prompt, 80),
        "selected_script": selected_rows,
        "generation_prompt": generation_prompt,
        "negative_prompt": "blurry, out of focus, bad anatomy, extra limbs, duplicate person, watermark, text, logo",
        "items": [
            f"目标分镜：{shot_label}",
            f"参考图片：{body.reference_image_count}张",
            f"{body.params.seconds}s / {body.params.ratio} · {body.params.resolution}",
        ],
        "fallback": True,
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        candidates.append(cleaned[start:end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            continue
    return {}


async def _llm_video_spec(body: VideoSpecRequest) -> dict[str, Any]:
    key = _tokenops_key()
    fallback = _fallback_video_spec(body)
    scripts = "\n\n".join(
        f"{item.label}:\n{_compact_text(item.text, 1800)}"
        for item in body.scripts[:3]
        if item.text.strip()
    )
    summaries = "\n".join(
        f"{item.label}: {_compact_text(item.text, 360)}"
        for item in body.summaries[:6]
        if item.text.strip()
    )
    system_prompt = (
        "你是视频生成意图解析器。根据用户输入和上游节点内容，输出严格 JSON，不要 Markdown。"
        "你必须把用户意图转成可直接发给视频生成模型的单段 generation_prompt。"
        "如果用户指定第几段/第几镜头/第几分镜，只抽取对应分镜，不要引用整部剧本。"
        "Bds Pro 必须输出单镜头图生视频提示词；Seedance/Lovart/Kling/Veo 可输出短片段提示词。"
        "JSON 字段：model, target_shots(number[]), intent_summary, selected_script, generation_prompt, negative_prompt, items(string[])."
    )
    user_content = {
        "user_prompt": body.user_prompt,
        "target_model": body.model,
        "params": body.params.model_dump(),
        "reference_image_count": body.reference_image_count,
        "fallback_target_shots": fallback["target_shots"],
        "fallback_selected_script": fallback["selected_script"],
        "upstream_scripts": scripts,
        "upstream_summaries": summaries,
    }
    payload = {
        "model": VIDEO_SPEC_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
        ],
        "temperature": 0.2,
        "max_tokens": 1400,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20)) as client:
            response = await client.post(
                f"{TOKENOPS_BASE_URL}/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            )
        if response.status_code >= 400:
            return fallback
        result = response.json()
        choices = result.get("choices") if isinstance(result, dict) else []
        message = choices[0].get("message", {}) if choices else {}
        content = str(message.get("content") or "")
        parsed = _extract_json_object(content)
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return fallback

    generation_prompt = str(parsed.get("generation_prompt") or "").strip()
    if not generation_prompt:
        return fallback
    target_shots = parsed.get("target_shots") if isinstance(parsed.get("target_shots"), list) else fallback["target_shots"]
    items = parsed.get("items") if isinstance(parsed.get("items"), list) else fallback["items"]
    return {
        **fallback,
        "model": body.model,
        "target_shots": [int(value) for value in target_shots if isinstance(value, (int, float, str)) and str(value).isdigit()][:8],
        "intent_summary": _compact_text(str(parsed.get("intent_summary") or fallback["intent_summary"]), 120),
        "selected_script": str(parsed.get("selected_script") or fallback["selected_script"]),
        "generation_prompt": generation_prompt,
        "negative_prompt": str(parsed.get("negative_prompt") or fallback["negative_prompt"]),
        "items": [str(item)[:80] for item in items[:4] if str(item).strip()] or fallback["items"],
        "fallback": False,
    }


@router.post("/spec")
async def create_video_generation_spec(
    body: VideoSpecRequest,
    _: User = Depends(get_current_user),
):
    return await _llm_video_spec(body)


def _asset_from_reference(db: Session, user: User, reference: str) -> Optional[Asset]:
    path = urlparse(reference).path or reference
    match = re.search(r"/api/assets/([^/]+)/(?:public-content|content)$", path)
    if not match:
        return None
    asset = db.get(Asset, match.group(1))
    if not asset or asset.user_id != user.id:
        return None
    return asset


def _asset_public_source_url(asset: Asset) -> str:
    metadata = asset.metadata if isinstance(asset.metadata, dict) else {}
    source_url = str(metadata.get("sourceUrl") or metadata.get("source_url") or "").strip()
    parsed = urlparse(source_url)
    return source_url if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def _resolve_lovart_reference_images(db: Session, user: User, references: list[str]) -> list[str]:
    resolved: list[str] = []
    for reference in references:
        value = reference.strip()
        if not value:
            continue
        asset = _asset_from_reference(db, user, value)
        if asset:
            resolved.append(storage.presign_download(asset.storage_key, asset.title))
            continue
        if value.startswith("blob:"):
            continue
        resolved.append(value)
    return resolved


async def _resolve_tokenops_reference_image(db: Session, user: User, reference: str) -> str:
    value = reference.strip()
    if not value:
        raise HTTPException(status_code=400, detail="参考图片为空")
    if value.startswith("data:image/"):
        return value
    if value.startswith("blob:"):
        raise HTTPException(status_code=400, detail="图片还在本地预览中，请等待上传完成后再生成视频")

    asset = _asset_from_reference(db, user, value)
    if asset:
        public_source_url = _asset_public_source_url(asset)
        if public_source_url:
            return public_source_url
    if asset and storage.is_remote:
        return storage.presign_download(asset.storage_key, asset.title)
    if asset:
        image_data_url, _ = await _image_reference_to_data_url(db, user, value)
        return image_data_url

    return value


def _resolve_mulerouter_reference_image(db: Session, user: User, reference: str) -> str:
    value = reference.strip()
    if not value:
        raise HTTPException(status_code=400, detail="Wan 图生视频参考图片为空")
    if value.startswith("blob:") or value.startswith("data:"):
        raise HTTPException(status_code=400, detail="Wan 图生视频需要公网可访问图片 URL，请先使用已生成图片或远程资产")

    asset = _asset_from_reference(db, user, value)
    if asset:
        public_source_url = _asset_public_source_url(asset)
        if public_source_url:
            return public_source_url
        if storage.is_remote:
            return storage.presign_download(asset.storage_key, asset.title)
        raise HTTPException(status_code=400, detail="Wan 图生视频需要公网可访问图片 URL，当前本地上传图片无法直接作为参考图")

    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return value
    raise HTTPException(status_code=400, detail="Wan 图生视频参考图片必须是公网 URL")


async def _image_reference_to_data_url(db: Session, user: User, reference: str) -> tuple[str, str]:
    value = reference.strip()
    if not value:
        raise HTTPException(status_code=400, detail="Bds Pro 需要首帧图片")
    if value.startswith("data:image/"):
        return value, "source.png"
    if value.startswith("blob:"):
        raise HTTPException(status_code=400, detail="图片还在本地预览中，请等待上传完成后再生成视频")

    asset = _asset_from_reference(db, user, value)
    if asset:
        try:
            path = storage.ensure_local(asset.storage_key)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="首帧图片文件不存在") from exc
        data = path.read_bytes()
        mime_type = asset.mime_type or "image/png"
        filename = safe_storage_name(asset.title or path.name)
        return f"data:{mime_type};base64,{base64.b64encode(data).decode()}", filename

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20), follow_redirects=True) as client:
            response = await client.get(value)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bds Pro 首帧图片下载失败：{exc}") from exc

    mime_type = response.headers.get("content-type") or "image/png"
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Bds Pro 首帧必须是图片")
    filename = safe_storage_name(Path(urlparse(value).path).name or "source.png")
    return f"data:{mime_type};base64,{base64.b64encode(response.content).decode()}", filename


def _bds_dimensions(ratio: str, resolution: str) -> tuple[int, int]:
    base_by_ratio = {
        "9:16": (704, 1024),
        "16:9": (1024, 576),
        "1:1": (768, 768),
        "3:4": (768, 1024),
        "4:3": (1024, 768),
        "21:9": (1280, 544),
    }
    width, height = base_by_ratio.get(ratio, base_by_ratio["9:16"])
    if resolution == "1080p":
        scale = 1080 / max(width, height)
        return int(width * scale) // 8 * 8, int(height * scale) // 8 * 8
    if resolution == "480p":
        scale = 640 / max(width, height)
        return int(width * scale) // 8 * 8, int(height * scale) // 8 * 8
    return width, height


async def _bds_upload_image(client: httpx.AsyncClient, data_url: str, filename: str) -> str:
    response = await client.post(
        f"{BDS_A2_BASE_URL}/api/upload",
        json={"image": {"filename": filename, "data_url": data_url}},
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Bds Pro image upload failed"))
    data = response.json()
    image = str(data.get("image") or "").strip()
    if not image:
        raise HTTPException(status_code=502, detail="Bds Pro 上传首帧后未返回 image")
    return image


async def _create_bds_video(payload: VideoGenerateRequest, db: Session, user: User) -> dict[str, Any]:
    references = [item for item in payload.reference_images if item.strip()]
    if not references:
        raise HTTPException(status_code=400, detail="Bds Pro 图生视频需要至少一张上游图片作为首帧")

    first_frame, first_filename = await _image_reference_to_data_url(db, user, references[0])
    face_frame: Optional[tuple[str, str]] = None
    if len(references) > 1:
        face_frame = await _image_reference_to_data_url(db, user, references[1])

    width, height = _bds_dimensions(payload.ratio, payload.resolution)
    request_payload: dict[str, Any] = {
        "positive_prompt": payload.prompt.strip(),
        "negative_prompt": "blurry, out of focus, bad anatomy, extra limbs, duplicate person, watermark, text, logo",
        "seconds": payload.seconds,
        "steps": 13,
        "cfg": 1.0,
        "shift": 5.0,
        "painter": 1.03,
        "lynx": 0.04 if face_frame else 0,
        "width": width,
        "height": height,
        "frame_rate": 16.2,
        "crf": 10,
        "seed": -1,
        "postprocess": {"speech": "auto", "blush": "auto"},
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20)) as client:
            request_payload["image"] = await _bds_upload_image(client, first_frame, first_filename)
            if face_frame:
                request_payload["face_image"] = await _bds_upload_image(client, face_frame[0], face_frame[1])
            response = await client.post(f"{BDS_A2_BASE_URL}/api/generate", json=request_payload)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Bds Pro 视频生成任务创建超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bds Pro 视频生成请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Bds Pro video generation failed"))

    result = response.json()
    task_id = str(result.get("task_id") or result.get("id") or "").strip()
    if not task_id:
        task_id = uuid.uuid4().hex
    return {
        **result,
        "id": f"{BDS_PRO_MODEL}:{task_id}",
        "model": BDS_PRO_MODEL,
        "status": result.get("state") or result.get("status") or "queued",
        "request": {
            "model": BDS_PRO_MODEL,
            "ratio": payload.ratio,
            "resolution": payload.resolution,
            "seconds": payload.seconds,
            "width": width,
            "height": height,
        },
    }


def _bds_task_id(video_id: str) -> str:
    return video_id.split(":", 1)[1] if video_id.startswith(f"{BDS_PRO_MODEL}:") else video_id


def _normalize_bds_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"completed", "complete", "success", "succeeded", "done"}:
        return "completed"
    if normalized in {"failed", "error"}:
        return "failed"
    if normalized in {"queued", "pending", "in_queue"}:
        return "queued"
    return "running"


def _bds_error_detail(data: dict[str, Any]) -> str:
    raw_error = data.get("error") or data.get("message") or data.get("detail")
    parsed = raw_error
    if isinstance(raw_error, str):
        try:
            parsed = json.loads(raw_error)
        except json.JSONDecodeError:
            parsed = raw_error

    def find_key(value: Any, keys: set[str]) -> str:
        if isinstance(value, dict):
            for key in keys:
                item = value.get(key)
                if isinstance(item, str) and item.strip() and not item.strip().startswith(("{", "[")):
                    return item.strip()
            for item in value.values():
                text = find_key(item, keys)
                if text:
                    return text
        if isinstance(value, list):
            for item in value:
                text = find_key(item, keys)
                if text:
                    return text
        return ""

    detail = find_key(parsed, {"exception_message", "exception", "error_message"})
    if not detail:
        detail = find_key(parsed, {"message", "detail"})
    if detail:
        return detail
    if isinstance(raw_error, str) and raw_error.strip() and not raw_error.strip().startswith(("{", "[")):
        return raw_error.strip()
    if status := data.get("status"):
        return f"Bds Pro 返回状态：{status}"
    return "Bds Pro 生成失败，未返回详细错误"


def _absolute_bds_url(value: str) -> str:
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return f"{BDS_A2_BASE_URL}/{value.lstrip('/')}"


def _append_video_url(urls: list[str], value: str) -> None:
    text = value.strip().rstrip(").,，。")
    if not text.startswith(("http://", "https://")):
        return
    lower = text.lower()
    if re.search(r"\.(?:png|jpe?g|webp|gif)(?:\?|$)", lower):
        return
    if re.search(r"\.(?:mp4|mov|webm|m4v)(?:\?|$)", lower) or "video" in lower:
        urls.append(text)


def _extract_video_urls(data: Any) -> list[str]:
    urls: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                lower_key = str(key).lower()
                if lower_key in {"url", "src", "video", "video_url", "videourl", "download_url", "downloadurl", "content_url", "contenturl"}:
                    if isinstance(item, str):
                        _append_video_url(urls, item)
                    else:
                        visit(item)
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str):
            for match in re.findall(r"https?://[^\s\"'<>]+", value):
                _append_video_url(urls, match)

    visit(data)
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


async def _get_bds_result(task_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20), follow_redirects=True) as client:
        response = await client.get(f"{BDS_A2_BASE_URL}/result/{task_id}")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Bds Pro result failed"))
    data = response.json()
    return data if isinstance(data, dict) else {}


async def _get_bds_status(video_id: str) -> dict[str, Any]:
    task_id = _bds_task_id(video_id)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20), follow_redirects=True) as client:
            response = await client.get(f"{BDS_A2_BASE_URL}/status/{task_id}")
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Bds Pro 状态查询超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bds Pro 状态查询失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Bds Pro status failed"))

    data = response.json()
    if not isinstance(data, dict):
        data = {}
    status = _normalize_bds_status(data.get("state") or data.get("status"))
    result: dict[str, Any] = {}
    video_urls: list[str] = []
    if status == "completed":
        result = await _get_bds_result(task_id)
        video_urls = _extract_video_urls(result)
        if not video_urls:
            status = "failed"
    error = _bds_error_detail(data) if status == "failed" else ""
    if status == "failed" and result and not error:
        error = _bds_error_detail(result)
    return {
        **data,
        "id": f"{BDS_PRO_MODEL}:{task_id}",
        "model": BDS_PRO_MODEL,
        "status": status,
        "error": error,
        "result": result,
        "videoUrls": video_urls,
        "content_path": f"/api/video/generate/{BDS_PRO_MODEL}:{task_id}/content" if status == "completed" and video_urls else "",
    }


async def _download_bds_video(video_id: str) -> tuple[bytes, str]:
    task_id = _bds_task_id(video_id)
    result = await _get_bds_result(task_id)
    output = result.get("output") if isinstance(result.get("output"), dict) else {}
    urls = _extract_video_urls(result)
    url = str(output.get("url") or result.get("url") or (urls[0] if urls else "")).strip()
    if not url:
        raise HTTPException(status_code=404, detail="Bds Pro 结果未返回视频 URL")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20), follow_redirects=True) as client:
            response = await client.get(_absolute_bds_url(url))
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bds Pro 视频下载失败：{exc}") from exc
    return response.content, response.headers.get("content-type") or "video/mp4"


def _mulerouter_video_id(model: str, task_id: str) -> str:
    return f"{WAN_VIDEO_PREFIX}{model}:{task_id}"


def _mulerouter_video_parts(video_id: str) -> tuple[str, str]:
    if not video_id.startswith(WAN_VIDEO_PREFIX):
        raise HTTPException(status_code=400, detail="不是 Wan 视频任务")
    value = video_id[len(WAN_VIDEO_PREFIX):]
    model, separator, task_id = value.partition(":")
    if not separator or model not in {WAN22_I2V_MODEL, WAN27_I2V_MODEL} or not task_id.strip():
        raise HTTPException(status_code=400, detail="Wan 视频任务 ID 无效")
    return model, task_id.strip()


def _mulerouter_create_url(model: str) -> str:
    return f"{MULEROUTER_BASE_URL}/vendors/carrothub/v1/{model}/generation"


def _mulerouter_22_i2v_resolution(value: str) -> str:
    return "720p" if value.lower() == "720p" else "480p"


def _mulerouter_27_i2v_resolution(value: str) -> str:
    return "720p" if value.lower() == "720p" else "1080p"


def _normalize_mulerouter_22_duration(value: int) -> int:
    return 8 if int(value) == 8 else 5


def _normalize_mulerouter_27_duration(value: int) -> int:
    return max(2, min(int(value), 15))


def _build_mulerouter_video_payload(payload: VideoGenerateRequest, image_urls: list[str], model: str) -> dict[str, Any]:
    if not image_urls:
        raise HTTPException(status_code=400, detail="Wan 图生视频需要至少一张参考图")

    request: dict[str, Any] = {
        "prompt": (payload.prompt.strip() or "Generate a smooth, natural video.")[:2000],
        "image": image_urls[0],
        "prompt_extend": True,
    }
    if model == WAN22_I2V_MODEL:
        request["resolution"] = _mulerouter_22_i2v_resolution(payload.resolution)
        request["duration"] = _normalize_mulerouter_22_duration(payload.seconds)
        return request

    request["resolution"] = _mulerouter_27_i2v_resolution(payload.resolution)
    request["duration"] = _normalize_mulerouter_27_duration(payload.seconds)
    if len(image_urls) > 1:
        request["last_frame"] = image_urls[1]
    return request


def _mulerouter_task_status(data: dict[str, Any]) -> str:
    raw = str((data.get("task_info") or {}).get("status") or data.get("status") or "").strip().lower()
    if raw in {"completed", "complete", "success", "succeeded", "done"}:
        return "completed"
    if raw in {"failed", "fail", "error", "expired", "cancelled", "canceled"}:
        return "failed"
    if raw in {"queued", "pending", "in_queue"}:
        return "queued"
    return "running"


def _mulerouter_task_error(data: dict[str, Any]) -> str:
    error = (data.get("task_info") or {}).get("error") or data.get("error") or data.get("message") or data.get("detail")
    if isinstance(error, dict):
        for key in ("message", "detail", "error_message", "exception_message"):
            if error.get(key):
                return str(error[key])
        return json.dumps(error, ensure_ascii=False)[:1000]
    return str(error or "").strip()


def _extract_mulerouter_video_url(data: dict[str, Any]) -> str:
    videos = data.get("videos")
    if isinstance(videos, list) and videos:
        return str(videos[0])

    output = data.get("output")
    if isinstance(output, dict):
        output_videos = output.get("videos")
        if isinstance(output_videos, list) and output_videos:
            return str(output_videos[0])
        if output.get("video_url"):
            return str(output["video_url"])

    content = data.get("content")
    if isinstance(content, dict) and content.get("video_url"):
        return str(content["video_url"])

    if data.get("video"):
        return str(data["video"])
    urls = _extract_video_urls(data)
    return urls[0] if urls else ""


async def _create_mulerouter_video(payload: VideoGenerateRequest, db: Session, user: User, model: str) -> dict[str, Any]:
    limit = 1 if model == WAN22_I2V_MODEL else 2
    image_urls = [
        _resolve_mulerouter_reference_image(db, user, reference)
        for reference in payload.reference_images
        if reference.strip()
    ][:limit]
    request_payload = _build_mulerouter_video_payload(payload, image_urls, model)
    key = _mulerouter_key()
    create_url = _mulerouter_create_url(model)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=20)) as client:
            response = await client.post(
                create_url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=request_payload,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Wan 视频生成任务创建超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Wan 视频生成请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Wan video generation failed"))

    result = response.json()
    task_info = result.get("task_info") if isinstance(result.get("task_info"), dict) else {}
    task_id = str(task_info.get("id") or result.get("id") or "").strip()
    if not task_id:
        raise HTTPException(status_code=502, detail="Wan 视频生成未返回任务 ID")

    return {
        **result,
        "id": _mulerouter_video_id(model, task_id),
        "model": model,
        "status": _mulerouter_task_status(result),
        "request": {
            "provider": "mulerouter",
            "vendor": "carrothub",
            "model": model,
            "ratio": payload.ratio,
            "resolution": request_payload.get("resolution"),
            "seconds": request_payload.get("duration"),
            "reference_image_count": len(image_urls),
        },
    }


async def _get_mulerouter_video_status(video_id: str) -> dict[str, Any]:
    model, task_id = _mulerouter_video_parts(video_id)
    key = _mulerouter_key()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20), follow_redirects=True) as client:
            response = await client.get(
                f"{_mulerouter_create_url(model)}/{task_id}",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Wan 视频状态查询超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Wan 视频状态查询失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_remote_error(response, "Wan video status failed"))

    data = response.json()
    if not isinstance(data, dict):
        data = {}
    status = _mulerouter_task_status(data)
    video_url = _extract_mulerouter_video_url(data) if status == "completed" else ""
    if status == "completed" and not video_url:
        status = "failed"
    error = _mulerouter_task_error(data) if status == "failed" else ""
    return {
        **data,
        "id": video_id,
        "model": model,
        "status": status,
        "error": error,
        "videoUrls": [video_url] if video_url else [],
        "content_path": f"/api/video/generate/{video_id}/content" if status == "completed" and video_url else "",
    }


async def _download_mulerouter_video(video_id: str) -> tuple[bytes, str]:
    status = await _get_mulerouter_video_status(video_id)
    urls = status.get("videoUrls")
    if not isinstance(urls, list) or not urls:
        raise HTTPException(status_code=404, detail="Wan 视频结果不存在")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20), follow_redirects=True) as client:
            response = await client.get(str(urls[0]))
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Wan 视频下载失败：{exc}") from exc
    return response.content, response.headers.get("content-type") or "video/mp4"


def _lovart_video_id(task_id: str) -> str:
    return f"{LOVART_VIDEO_PREFIX}{task_id}"


def _lovart_task_id(video_id: str) -> str:
    return video_id.split(":", 1)[1] if video_id.startswith(LOVART_VIDEO_PREFIX) else video_id


def _normalize_lovart_video_status(status: Any, video_urls: list[str]) -> str:
    value = str(status or "").strip().lower()
    if video_urls or value in {"done", "completed", "complete", "success", "succeeded"}:
        return "completed" if video_urls else "running"
    if value in {"failed", "fail", "error"}:
        return "failed"
    return "running"


def _lovart_video_prompt(payload: VideoGenerateRequest, model: str) -> str:
    constraints = [
        "请立即生成一段真实可下载的视频 artifact，不要只回复文本、脚本或分析。",
        "请使用 Lovart 视频生成能力生成成片。",
        f"指定视频模型：{model}。",
        f"画幅比例：{payload.ratio}。",
        f"分辨率：{payload.resolution}。",
        f"时长：{payload.seconds}s。",
        "保持参考图中的人物身份、五官、发型、服装和气质一致。",
        "保持画面自然、清晰、无水印、无字幕。",
    ]
    if payload.generate_audio:
        constraints.append("如模型支持，请生成或保留匹配画面的音频。")
    else:
        constraints.append("不要生成音频。")
    if payload.camerafixed:
        constraints.append("镜头尽量固定，减少不必要的运镜。")

    return "\n".join(constraints) + f"\n\n视频要求：\n{payload.prompt.strip()}"


async def _create_lovart_video(payload: VideoGenerateRequest, db: Session, user: User, model: str) -> dict[str, Any]:
    references = _resolve_lovart_reference_images(db, user, payload.reference_images)
    request = {
        "model": model,
        "prompt": _lovart_video_prompt(payload, model),
        "output_type": "video",
        "reference_images": references,
        "ratio": payload.ratio,
        "resolution": payload.resolution,
        "seconds": payload.seconds,
        "generate_audio": payload.generate_audio,
        "watermark": payload.watermark,
        "camerafixed": payload.camerafixed,
    }
    try:
        result = await LovartClient().create_task(request)
    except LovartAPIError as exc:
        status = exc.status_code if exc.status_code >= 400 else 502
        if exc.status_code == 0:
            status = 500
        raise HTTPException(status_code=status, detail=exc.detail) from exc

    return {
        "id": _lovart_video_id(result.task_id),
        "model": model,
        "status": "running",
        "projectId": result.request_id,
        "request": {
            "provider": "lovart",
            "model": model,
            "ratio": payload.ratio,
            "resolution": payload.resolution,
            "seconds": payload.seconds,
            "generate_audio": payload.generate_audio,
            "watermark": payload.watermark,
            "camerafixed": payload.camerafixed,
            "reference_image_count": len(references),
        },
    }


async def _get_lovart_video_status(video_id: str) -> dict[str, Any]:
    task_id = _lovart_task_id(video_id)
    try:
        task = await LovartClient().get_task(task_id)
    except LovartAPIError as exc:
        status = exc.status_code if exc.status_code >= 400 else 502
        if exc.status_code == 0:
            status = 500
        raise HTTPException(status_code=status, detail=exc.detail) from exc

    video_urls = _extract_video_urls(task)
    status = _normalize_lovart_video_status(task.get("status"), video_urls)
    error = None
    if status == "running" and str(task.get("status") or "").lower() in {"done", "completed", "complete", "success", "succeeded"}:
        error = "Lovart 已完成但未返回视频结果"
        status = "failed"
    return {
        "id": video_id,
        "model": "lovart-video",
        "status": status,
        "videoUrls": video_urls,
        "error": error,
        "raw": task,
        "content_path": f"/api/video/generate/{video_id}/content" if status == "completed" and video_urls else "",
    }


async def _download_lovart_video(video_id: str) -> tuple[bytes, str]:
    status = await _get_lovart_video_status(video_id)
    urls = status.get("videoUrls")
    if not isinstance(urls, list) or not urls:
        raise HTTPException(status_code=404, detail="Lovart 视频结果不存在")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20), follow_redirects=True) as client:
            response = await client.get(str(urls[0]))
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Lovart 视频下载失败：{exc}") from exc
    return response.content, response.headers.get("content-type") or "video/mp4"


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
    model = _select_generation_model(payload)
    if payload.ratio not in SEEDANCE_RATIOS:
        raise HTTPException(status_code=400, detail="不支持的视频比例")
    if payload.resolution not in SEEDANCE_RESOLUTIONS:
        raise HTTPException(status_code=400, detail="不支持的视频分辨率")

    if model == WAN22_I2V_MODEL:
        if payload.resolution not in {"480p", "720p"}:
            raise HTTPException(status_code=400, detail="Wan 2.2 仅支持 480p/720p")
        if payload.seconds not in {5, 8}:
            raise HTTPException(status_code=400, detail="Wan 2.2 仅支持 5 秒或 8 秒")
        if not any(item.strip() for item in payload.reference_images):
            raise HTTPException(status_code=400, detail="Wan 2.2 需要 1 张参考图")
        return

    if model == WAN27_I2V_MODEL:
        if payload.resolution not in {"720p", "1080p"}:
            raise HTTPException(status_code=400, detail="Wan 2.7 仅支持 720p/1080p")
        if not 2 <= payload.seconds <= 15:
            raise HTTPException(status_code=400, detail="Wan 2.7 时长需在 2-15 秒之间")
        if not any(item.strip() for item in payload.reference_images):
            raise HTTPException(status_code=400, detail="Wan 2.7 需要至少 1 张参考图")
        return

    if payload.seconds not in SEEDANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Seedance 视频时长需在 4-15 秒之间")
    if model == TOKENOPS_SEEDANCE_15_MODEL and payload.seconds > 12:
        raise HTTPException(status_code=400, detail="Seedance 1.5 Pro 时长需在 4-12 秒之间")


@router.get("/models")
async def list_video_generation_models(_: User = Depends(get_current_user)):
    return {"models": _video_model_options(), "default": TOKENOPS_GENERATION_MODEL}


@router.post("/generate")
async def generate_video(
    payload: VideoGenerateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate_generation_request(payload)
    model = _select_generation_model(payload)
    if _is_bds_model(model):
        return await _create_bds_video(payload, db, user)
    if _is_mulerouter_video_model(model):
        return await _create_mulerouter_video(payload, db, user, model)
    if not _is_tokenops_video_model(model):
        return await _create_lovart_video(payload, db, user, model)

    key = _tokenops_key()
    content: list[dict[str, Any]] = [{"type": "text", "text": payload.prompt.strip()}]
    reference_count = 0
    max_reference_count = _tokenops_video_reference_limit(model)
    for index, reference in enumerate([item for item in payload.reference_images if item.strip()][:max_reference_count]):
        image_url = await _resolve_tokenops_reference_image(db, user, reference)
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": image_url,
                },
                "role": _tokenops_video_reference_role(model, index),
            }
        )
        reference_count += 1

    request_payload = {
        "model": model,
        "content": content,
        "ratio": payload.ratio,
        "resolution": payload.resolution,
        "seconds": str(payload.seconds),
        "framespersecond": 24,
        "generate_audio": payload.generate_audio,
        "watermark": payload.watermark,
        "camerafixed": payload.camerafixed,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
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
        detail = _remote_error(response, "TokenOps video generation failed")
        raise HTTPException(status_code=502, detail=f"TokenOps 视频生成创建失败（HTTP {response.status_code}）：{detail}")

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
            "reference_image_count": reference_count,
        },
    }


@router.get("/generate/{video_id}")
async def get_generated_video_status(
    video_id: str,
    _: User = Depends(get_current_user),
):
    if video_id.startswith(f"{BDS_PRO_MODEL}:"):
        return await _get_bds_status(video_id)
    if video_id.startswith(WAN_VIDEO_PREFIX):
        return await _get_mulerouter_video_status(video_id)
    if video_id.startswith(LOVART_VIDEO_PREFIX):
        return await _get_lovart_video_status(video_id)

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
    if video_id.startswith(f"{BDS_PRO_MODEL}:"):
        content, media_type = await _download_bds_video(video_id)
        return Response(content=content, media_type=media_type)
    if video_id.startswith(WAN_VIDEO_PREFIX):
        content, media_type = await _download_mulerouter_video(video_id)
        return Response(content=content, media_type=media_type)
    if video_id.startswith(LOVART_VIDEO_PREFIX):
        content, media_type = await _download_lovart_video(video_id)
        return Response(content=content, media_type=media_type)

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
