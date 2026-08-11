"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Captions,
  Film,
  FileVideo,
  Image,
  Layers3,
  Link2,
  LogOut,
  Monitor,
  MousePointer2,
  PackageCheck,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { FlowProvider } from "@/components/canvas/FlowProvider";
import { HomeLanding } from "@/components/landing/HomeLanding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createVideoGenerationSpec,
  downloadGeneratedVideo,
  listAssets,
  listImageModels,
  listVideoModels,
  resolveMediaUrl,
  uploadAsset,
  type AssetRecord,
  type ImageModelOption,
  type VideoGenerationSpec,
  type VideoModelOption,
} from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useFlowStore } from "@/stores/flowStore";
import type { ImageAssetItem, ImageAssetTag, NodeData, StudioNodeStatus } from "@/types/flow";
import { useReactFlow, type XYPosition } from "@xyflow/react";

const statusText: Record<StudioNodeStatus, string> = {
  idle: "Idle",
  ready: "Ready",
  running: "Running",
  done: "Done",
  queued: "Queued",
  error: "Error",
};

function displayNodeStatus(node: NodeData): StudioNodeStatus {
  const status = node.status ?? "idle";
  const config = node.config ?? {};
  const metric = typeof node.metric === "string" ? node.metric : "";
  const items = node.items ?? [];
  const failed =
    config.generationStatus === "failed" ||
    config.status === "failed" ||
    Boolean(config.error) ||
    metric.includes("失败") ||
    items.some((item) => item.includes("失败"));
  return status !== "done" && failed ? "error" : status;
}

const fallbackImageModels: ImageModelOption[] = [
  { model: "nano-banana-pro", label: "Nano Banana Pro" },
  { model: "nano-banana-2", label: "Nano Banana 2" },
  { model: "nano-banana-2-lite", label: "Nano Banana 2 Lite" },
  { model: "gpt-image-2", label: "GPT Image 2" },
  { model: "gpt-image-1.5", label: "GPT Image 1.5" },
  { model: "seedream-5-pro", label: "Seedream 5.0 Pro" },
  { model: "luma-uni-1", label: "Luma Uni-1" },
  { model: "luma-uni-1-max", label: "Luma Uni-1 Max" },
];

const fallbackVideoModels: VideoModelOption[] = [
  { model: "bds-pro", label: "Bds Pro" },
  { model: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro" },
  { model: "seedance-2-0", label: "Seedance 2.0" },
  { model: "seedance-2-0-fast", label: "Seedance 2.0 Fast" },
  { model: "seedance-2-0-mini", label: "Seedance 2.0 Mini" },
  { model: "kling-3-0", label: "Kling 3.0" },
  { model: "kling-3-0-omni", label: "Kling 3.0 Omni" },
  { model: "veo-3-1", label: "Veo 3.1" },
  { model: "veo-3-1-fast", label: "Veo 3.1 Fast" },
  { model: "gemini-omni-flash", label: "Gemini Omni Flash" },
];

const imageModelMeta: Record<string, { description: string; chip: string }> = {
  "nano-banana-pro": { description: "高质量图片生成，适合精修质感", chip: "60s" },
  "nano-banana-2": { description: "通用图片生成，主体一致性更稳", chip: "50s" },
  "nano-banana-2-lite": { description: "轻量快速，适合草图探索", chip: "25s" },
  "gpt-image-2": { description: "最新图片模型，长文本能力突出", chip: "60s" },
  "gpt-image-1.5": { description: "稳定生图与参考图编辑", chip: "45s" },
  "seedream-5-pro": { description: "中文语义理解强，商业素材友好", chip: "20s" },
  "luma-uni-1": { description: "风格化画面与场景生成", chip: "50s" },
  "luma-uni-1-max": { description: "更高质量的风格化输出", chip: "60s" },
};

const videoModelMeta: Record<string, { description: string; chip: string }> = {
  "bds-pro": { description: "最多2图：首帧+人物脸参考。适合单主体图生视频，不适合6图综合参考。", chip: "60s" },
  "doubao-seedance-1-5-pro-251215": { description: "最多2图：首帧+尾帧控制。稳定出片，适合明确起止画面的短镜头。", chip: "60s" },
  "seedance-2-0": { description: "支持多图参考。适合人物/场景/道具多素材合成，运动和叙事均衡。", chip: "60s" },
  "seedance-2-0-fast": { description: "支持多图参考。更快出片，适合6图参考的快速预览和多轮试错。", chip: "35s" },
  "seedance-2-0-mini": { description: "支持多图参考。轻量低成本，适合草稿验证，不追求最高质感。", chip: "25s" },
  "kling-3-0": { description: "支持多图参考。强运动表现，适合人物动作、镜头推进和动态转场。", chip: "60s" },
  "kling-3-0-omni": { description: "支持多图参考。多模态素材适配强，适合复杂参考图和角色一致性尝试。", chip: "60s" },
  "veo-3-1": { description: "支持多图参考。电影感和复杂场景更强，适合高质量成片探索。", chip: "90s" },
  "veo-3-1-fast": { description: "支持多图参考。Veo 快速模式，适合批量方向测试。", chip: "50s" },
  "gemini-omni-flash": { description: "支持多图参考。快速多模态生成与理解，适合轻量创意预览。", chip: "35s" },
};

function modelLabel(options: Array<{ model: string; label: string }>, model: string, fallback: string) {
  return options.find((option) => option.model === model)?.label ?? (model || fallback);
}

type ImageQuality = "低画质" | "标准画质" | "高画质";

type ImageGenerationParams = {
  quality: ImageQuality;
  resolution: "1K" | "2K" | "4K";
  ratio: string;
  count: 1 | 2 | 4;
};

type VideoGenerationMode = "reference" | "edit" | "first-last";

type VideoGenerationParams = {
  mode: VideoGenerationMode;
  ratio: string;
  resolution: "480p" | "720p" | "1080p" | "4k";
  seconds: 5 | 8 | 10 | 15;
  generate_audio: boolean;
  camerafixed: boolean;
};

const imageQualities: ImageQuality[] = ["低画质", "标准画质", "高画质"];
const imageResolutions: ImageGenerationParams["resolution"][] = ["1K", "2K", "4K"];
const imageRatios = ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
const imageCounts: ImageGenerationParams["count"][] = [1, 2, 4];
const videoModes: Array<{ value: VideoGenerationMode; label: string }> = [
  { value: "reference", label: "参考图/视频" },
  { value: "edit", label: "视频编辑" },
  { value: "first-last", label: "首尾帧" },
];
const videoRatios = ["Auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const videoResolutions: VideoGenerationParams["resolution"][] = ["480p", "720p", "1080p", "4k"];
const videoSeconds: VideoGenerationParams["seconds"][] = [5, 8, 10, 15];
const settingImageOptions = [
  {
    label: "角色脸部三视图",
    icon: Boxes,
    prompt:
      "基于参考图生成角色脸部三视图，包含正面、45度侧面、侧面视角。保持同一人物五官、发型、妆容、年龄感和气质一致，白色或浅灰背景，设定图排版清晰，适合后续角色一致性参考。",
  },
  {
    label: "角色设定图",
    icon: UserRound,
    prompt:
      "基于参考图生成完整角色设定图，包含角色主视觉、服装细节、发型五官、身体比例、表情气质和关键特征说明。保持人物身份一致，画面干净，设定信息清晰可读，适合用于后续图片和视频生成。",
  },
  {
    label: "角色三视图",
    icon: Image,
    prompt:
      "基于参考图生成角色三视图，包含正面、侧面、背面。保持同一人物、同一服装、同一发型和比例一致，站姿自然，背景简洁，三视图排版整齐，用于角色一致性建模参考。",
  },
  {
    label: "场景设定图",
    icon: Layers3,
    prompt:
      "基于参考图或文字生成完整场景设定图，明确场景空间结构、主体位置、光影氛围、色彩风格、材质细节和可复用元素。画面完整、透视稳定、无人物抢占主体，适合后续分镜和视频场景复用。",
  },
  {
    label: "产品设定图",
    icon: PackageCheck,
    prompt:
      "基于参考图生成产品设定图，包含产品主视觉、正侧背多角度、材质细节、结构特征、颜色规格和使用场景提示。保持产品外观准确一致，排版清晰，背景简洁，适合后续广告图和视频生成。",
  },
];

function isBuiltInSettingPrompt(value: string) {
  return settingImageOptions.some((option) => option.prompt === value.trim());
}

type ImageGenerateOptions = {
  settingPrompt?: string;
  settingLabel?: string;
};

function settingAssetTag(label?: string): "character" | "scene" | "prop" {
  if (!label) return "scene";
  if (label === "character" || label === "scene" || label === "prop") return label;
  if (label.includes("角色") || label.includes("人物")) return "character";
  if (label.includes("产品") || label.includes("道具")) return "prop";
  return "scene";
}

function displayNodeLabel(label: string) {
  return label === "豆包视频分析" ? "视频分析" : label;
}

type ComposerReference = {
  items: ComposerReferenceItem[];
  count: number;
  totalCount: number;
};

type ComposerReferenceItem = {
  kind: "image" | "video";
  url: string;
  label: string;
  tag?: ImageAssetTag;
};

type UpstreamContext = {
  references: ComposerReferenceItem[];
  scripts: Array<{ label: string; text: string }>;
  summaries: Array<{ label: string; text: string }>;
};

function getImageItemsFromConfig(config: Record<string, unknown>): ImageAssetItem[] {
  if (Array.isArray(config.images)) {
    return config.images.filter((item): item is ImageAssetItem =>
      Boolean(
        item &&
        typeof item === "object" &&
        (typeof (item as ImageAssetItem).url === "string" ||
          typeof (item as ImageAssetItem).assetId === "string")
      )
    );
  }
  const imageUrl = typeof config.imageUrl === "string" ? config.imageUrl : "";
  const fileName = typeof config.fileName === "string" ? config.fileName : "参考图";
  return imageUrl
    ? [{ id: "legacy-image", name: fileName, url: imageUrl, tag: "reference", uploadStatus: "saved" }]
    : [];
}

function imageReferenceUrl(image: ImageAssetItem) {
  if (image.assetId) return resolveMediaUrl(`/api/assets/${image.assetId}/public-content`);
  return resolveMediaUrl(image.url);
}

const imageReferenceTagMeta: Record<ImageAssetTag, { label: string; instruction: string }> = {
  reference: {
    label: "通用参考",
    instruction: "作为整体视觉、构图、风格参考，不要强行当作人物或场景主体",
  },
  character: {
    label: "人物参考",
    instruction: "作为角色身份参考，优先保持五官、发型、服装、体态和气质一致",
  },
  scene: {
    label: "场景参考",
    instruction: "作为空间/环境参考，优先保持场景布局、光线、氛围和镜头背景一致",
  },
  prop: {
    label: "道具参考",
    instruction: "作为道具/产品参考，优先保持外观、材质、颜色、品牌元素和关键细节一致",
  },
};

function normalizeImageReferenceTag(value: unknown): ImageAssetTag {
  return value === "character" || value === "scene" || value === "prop" || value === "reference"
    ? value
    : "reference";
}

function imageReferenceUsageText(context: UpstreamContext) {
  const images = context.references.filter((item) => item.kind === "image");
  if (!images.length) return "";
  return images
    .map((item, index) => {
      const tag = item.tag ?? "reference";
      const meta = imageReferenceTagMeta[tag];
      return `参考图${index + 1}（${meta.label}｜${item.label}）：${meta.instruction}`;
    })
    .join("\n");
}

function getReferencesFromNode(node?: { type?: string | null; data: NodeData } | null): ComposerReferenceItem[] {
  if (!node) return [];
  const config = node.data.config;
  const images = getImageItemsFromConfig(config).filter((image) => image.assetId || image.url);
  if (images.length > 0) {
    return images.map((image) => ({
      kind: "image",
      url: imageReferenceUrl(image),
      label: image.name || node.data.label,
      tag: normalizeImageReferenceTag(image.tag ?? config.assetTag),
    }));
  }

  const videoUrl = typeof config.videoUrl === "string" ? config.videoUrl : "";
  if (videoUrl) {
    return [{
      kind: "video",
      url: resolveMediaUrl(videoUrl),
      label: typeof config.fileName === "string" ? config.fileName : node.data.label,
    }];
  }

  return [];
}

function textConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function uniqueReferenceItems(items: ComposerReferenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceKey(item: ComposerReferenceItem) {
  return `${item.kind}:${item.url}`;
}

function collectUpstreamContext(
  nodes: Array<{ id: string; type?: string | null; data: NodeData }>,
  edges: Array<{ source: string; target: string }>,
  nodeId: string
): UpstreamContext {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  });

  const ordered: Array<{ id: string; type?: string | null; data: NodeData }> = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    (incoming.get(id) ?? []).forEach(walk);
    const node = nodeById.get(id);
    if (node) ordered.push(node);
  };
  walk(nodeId);

  const upstreamNodes = ordered.filter((node) => node.id !== nodeId);
  const references = uniqueReferenceItems(upstreamNodes.flatMap((node) => getReferencesFromNode(node)));
  const scripts = upstreamNodes
    .map((node) => ({
      label: displayNodeLabel(node.data.label),
      text: textConfigValue(node.data.config, ["generatedText", "script", "content"]),
    }))
    .filter((item) => item.text);
  const summaries = upstreamNodes
    .map((node) => ({
      label: displayNodeLabel(node.data.label),
      text:
        textConfigValue(node.data.config, ["summary", "prompt"]) ||
        (Array.isArray(node.data.items) ? node.data.items.join("；") : ""),
    }))
    .filter((item) => item.text);

  return { references, scripts, summaries };
}

function buildVideoPromptWithUpstream(
  userPrompt: string,
  context: UpstreamContext,
  params?: VideoGenerationParams
) {
  const basePrompt =
    userPrompt.trim() || "基于上游参考素材生成一段短视频，保持主体、风格、构图和运动连贯。";
  const modeLabel = params ? videoModes.find((mode) => mode.value === params.mode)?.label : "";
  const videoSettings = params
    ? `视频参数：生成方式 ${modeLabel || params.mode}；画幅 ${params.ratio}；时长 ${params.seconds}s；分辨率 ${params.resolution}；${params.generate_audio ? "生成音频" : "不生成音频"}；${params.camerafixed ? "固定镜头" : "允许镜头运动"}。`
    : "";
  const scriptText = context.scripts
    .map((item, index) => `剧本 ${index + 1}（${item.label}）：\n${item.text}`)
    .join("\n\n");
  const summaryText = context.summaries
    .slice(0, 6)
    .map((item) => `${item.label}：${item.text}`)
    .join("\n");
  const imageText = context.references.filter((item) => item.kind === "image").length
    ? `已附加 ${context.references.filter((item) => item.kind === "image").length} 张全链路上游图片作为视觉参考。`
    : "";
  const imageUsageText = imageReferenceUsageText(context);

  return [
    basePrompt,
    videoSettings,
    scriptText ? `请严格参考以下上游剧本/分镜内容：\n${scriptText}` : "",
    summaryText ? `上游节点摘要：\n${summaryText}` : "",
    imageText,
    imageUsageText ? `参考图用途标签：\n${imageUsageText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildImagePromptWithUpstream(
  userPrompt: string,
  context: UpstreamContext,
  params: ImageGenerationParams
) {
  const basePrompt =
    userPrompt.trim() || "基于上游参考素材生成一张高质量图片，保持主体、风格、构图和商业质感。";
  const scriptText = context.scripts
    .map((item, index) => `文案 ${index + 1}（${item.label}）：\n${compactForModel(item.text, 900)}`)
    .join("\n\n");
  const summaryText = context.summaries
    .slice(0, 4)
    .map((item) => `${item.label}：${compactForModel(item.text, 180)}`)
    .join("\n");
  const imageCount = context.references.filter((item) => item.kind === "image").length;
  const imageUsageText = imageReferenceUsageText(context);

  return [
    basePrompt,
    `图片参数：画幅 ${params.ratio}；画质 ${params.quality}；清晰度 ${params.resolution}；生成 ${params.count} 张。`,
    scriptText ? `请参考以下上游剧本/分镜文案，提取画面主体、场景、动作、情绪和关键元素：\n${scriptText}` : "",
    summaryText ? `上游节点摘要：\n${summaryText}` : "",
    imageCount ? `已附加 ${imageCount} 张上游图片作为视觉参考，生成时保持主体和风格一致。` : "",
    imageUsageText ? `参考图用途标签：\n${imageUsageText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function requestedShotNumbers(prompt: string) {
  const prefix = prompt.split(/\n|视频参数：/)[0] ?? prompt;
  const values = Array.from(prefix.matchAll(/\d{1,2}/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 99);
  return Array.from(new Set(values));
}

function extractScriptRows(script: string, shotNumbers: number[]) {
  if (!shotNumbers.length) return "";
  const wanted = new Set(shotNumbers.map(String));
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      const match = line.match(/^\|?\s*(\d{1,2})\s*\|/);
      return Boolean(match && wanted.has(match[1]));
    })
    .join("\n");
}

function compactForModel(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildBdsVideoPromptWithUpstream(
  userPrompt: string,
  context: UpstreamContext,
  params: VideoGenerationParams
) {
  const basePrompt = userPrompt.trim() || "基于上游参考图片生成一个单镜头短视频。";
  const shotNumbers = requestedShotNumbers(basePrompt);
  const scriptRows = context.scripts
    .map((item) => extractScriptRows(item.text, shotNumbers))
    .filter(Boolean)
    .join("\n");
  const fallbackSummary = context.summaries
    .slice(0, 3)
    .map((item) => `${item.label}：${compactForModel(item.text, 160)}`)
    .join("\n");
  const selectedScript = scriptRows || fallbackSummary;
  const referenceCount = context.references.filter((item) => item.kind === "image").length;
  const imageUsageText = imageReferenceUsageText(context);

  return [
    compactForModel(basePrompt, 180),
    `生成一个连续单镜头图生视频，不要生成整部剧，不要拆成多镜头。画幅 ${params.ratio}，时长 ${params.seconds}s，分辨率 ${params.resolution}。`,
    selectedScript ? `参考分镜：${compactForModel(selectedScript, 520)}` : "",
    referenceCount ? `使用已附加的 ${referenceCount} 张上游图片作为首帧/角色参考。` : "",
    imageUsageText ? `参考图用途标签：\n${compactForModel(imageUsageText, 520)}` : "",
    "画面要求：主体清晰，动作自然，镜头运动轻微，商业短视频质感，不要文字、水印、Logo。",
  ]
    .filter(Boolean)
    .join("\n");
}

function referenceCountLabel(reference: ComposerReference | null) {
  if (!reference) return "1张";
  const hasVideo = reference.items.some((item) => item.kind === "video");
  const imageCount = reference.items.filter((item) => item.kind === "image").length;
  if (!hasVideo) return `${imageCount || reference.count}张`;
  return `${reference.count}个素材`;
}

function Pill({
  children,
  active,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold",
        active
          ? "border-fuchsia-400/40 bg-fuchsia-400/15 text-fuchsia-100"
          : "border-white/10 bg-white/[0.06] text-zinc-300",
        className
      )}
    >
      {children}
    </div>
  );
}

function TopBar() {
  const router = useRouter();
  const { email, logout } = useAuthStore();
  const { flowName, setFlowName, saving, saveError, persistFlow } = useFlowStore();

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-5">
      <div className="pointer-events-auto flex h-[54px] min-w-[390px] items-center gap-4 rounded-2xl border border-white/10 bg-[#121217]/90 px-5 shadow-2xl backdrop-blur">
        <div className="flex size-9 items-center justify-center rounded-xl bg-fuchsia-500/15 text-sm font-black text-fuchsia-300 ring-1 ring-fuchsia-300/25">
          N
        </div>
        <div className="h-6 w-px bg-white/10" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-zinc-100 outline-none"
          value={flowName}
          onChange={(event) => setFlowName(event.target.value)}
        />
        <span
          className={cn(
            "rounded-full border px-2 py-1 font-mono text-[10px] uppercase",
            saveError
              ? "border-red-300/30 bg-red-400/10 text-red-200"
              : "border-white/10 text-zinc-500"
          )}
          title={saveError ?? undefined}
        >
          {saving ? "Saving" : saveError ? "Error" : "Saved"}
        </span>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <Pill>{email ?? "local user"}</Pill>
        <Pill>
          <Zap className="size-3.5 text-amber-300" />
          60
        </Pill>
        <Button
          className="h-9 rounded-full border border-white/10 bg-white/[0.06] px-4 text-xs text-zinc-100 hover:bg-white/10"
          onClick={persistFlow}
        >
          <Save className="mr-2 size-3.5" />
          保存
        </Button>
        <Button className="h-9 rounded-full bg-violet-500 px-4 text-xs text-white hover:bg-violet-400">
          <Rocket className="mr-2 size-3.5" />
          发布
        </Button>
        <Button
          className="size-9 rounded-full border border-white/10 bg-white/[0.06] p-0 text-zinc-300 hover:bg-white/10"
          onClick={handleLogout}
          title="退出登录"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  );
}

type AssetCategoryKey = "character" | "scene" | "prop" | "clip" | "finished";

function AssetPanel({
  collapsed,
  onToggle,
  imageModels,
  videoModels,
  selectedImageModel,
  selectedVideoModel,
}: {
  collapsed: boolean;
  onToggle: () => void;
  imageModels: ImageModelOption[];
  videoModels: VideoModelOption[];
  selectedImageModel: string;
  selectedVideoModel: string;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const flowId = useFlowStore((state) => state.flowId);
  const nodes = useFlowStore((state) => state.nodes);
  const updateNodeConfig = useFlowStore((state) => state.updateNodeConfig);
  const addImageUploadNode = useFlowStore((state) => state.addImageUploadNode);
  const addVideoUploadNode = useFlowStore((state) => state.addVideoUploadNode);
  const [activeAssetCategory, setActiveAssetCategory] = useState<AssetCategoryKey | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{ title: string; url: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<{ title: string; url: string } | null>(null);
  const [accountAssets, setAccountAssets] = useState<AssetRecord[]>([]);
  const [assetVideoUrls, setAssetVideoUrls] = useState<Record<string, string>>({});
  const [loadingAssetIds, setLoadingAssetIds] = useState<Record<string, boolean>>({});

  const studioNodes = nodes.map((node) => node.data as NodeData);
  const selectedFlowNode = nodes.find((node) => node.selected) ?? null;
  const selectedData = selectedFlowNode?.data;
  const selectedConfig = selectedData?.config ?? {};
  const selectedNodeModel = typeof selectedConfig.model === "string" ? selectedConfig.model : "";
  const selectedIsImageGeneration =
    selectedFlowNode?.type === "sceneAsset" &&
    (selectedConfig.mode === "referenced_image" || selectedData?.label.includes("图片生成"));
  const selectedIsVideoGeneration =
    selectedFlowNode?.type === "videoGeneration" &&
    (selectedConfig.mode === "referenced_video" ||
      selectedData?.label.includes("视频生成") ||
      selectedData?.label.includes("Seedance") ||
      selectedData?.label.includes("Kling") ||
      selectedData?.label.includes("Veo") ||
      selectedData?.label.includes("Gemini") ||
      selectedData?.label.includes("Bds"));
  const activePanelModel = selectedIsVideoGeneration
    ? selectedNodeModel || selectedVideoModel
    : selectedIsImageGeneration
      ? selectedNodeModel || selectedImageModel
      : "";
  const modelRows = selectedIsVideoGeneration
    ? [
        {
          label: modelLabel(videoModels, activePanelModel, "视频模型"),
          value: videoModelMeta[activePanelModel]?.description ?? "当前视频生成节点",
          className: "bg-fuchsia-400/10 text-fuchsia-100",
        },
      ]
    : selectedIsImageGeneration
      ? [
          {
            label: modelLabel(imageModels, activePanelModel, "图片模型"),
            value: imageModelMeta[activePanelModel]?.description ?? "当前图片生成节点",
            className: "bg-cyan-400/10 text-cyan-100",
          },
        ]
      : [
          {
            label: "未选中生成节点",
            value: "请选择图片/视频生成节点",
            className: "bg-white/[0.06] text-zinc-300",
          },
        ];
  const doneCount = studioNodes.filter((node) => node.status === "done").length;
  const readyCount = studioNodes.filter((node) => node.status === "ready").length;
  const assetTagCount = useCallback(
    (tag: string) =>
      accountAssets.filter((asset) => {
        const assetTag = typeof asset.metadata.tag === "string" ? asset.metadata.tag : "";
        return (asset.kind === "image" || asset.kind === "generated_image") && assetTag === tag;
      }).length,
    [accountAssets]
  );
  const clipAssetCount = accountAssets.filter((asset) => asset.kind === "video" || asset.kind === "generated_video").length;
  const finishedVideoAssets = useMemo(
    () => accountAssets.filter((asset) => asset.kind === "finished_video"),
    [accountAssets]
  );

  useEffect(() => {
    let cancelled = false;
    void listAssets()
      .then((assets) => {
        if (!cancelled) setAccountAssets(assets);
      })
      .catch(() => {
        if (!cancelled) setAccountAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const nodeFinishedVideos = useMemo(
    () =>
      nodes
        .filter((node) => node.type === "videoGeneration")
        .map((node) => {
          const assetId = typeof node.data.config.assetId === "string" ? node.data.config.assetId : "";
          return {
            id: node.id,
            assetId,
            label: String(node.data.config.assetTitle || node.data.label || "成片"),
            url: assetId
              ? `/api/assets/${assetId}/public-content`
              : typeof node.data.config.videoUrl === "string"
                ? node.data.config.videoUrl
                : "",
            taskId: typeof node.data.config.taskId === "string" ? node.data.config.taskId : "",
            ratio: String(node.data.config.ratio || ""),
            resolution: String(node.data.config.resolution || ""),
            seconds: String(node.data.config.seconds || ""),
            added: Boolean(node.data.config.addedToAssets),
            source: "node" as const,
          };
        })
        .filter((item) => item.added && (item.url || item.taskId)),
    [nodes]
  );

  const finishedVideos = useMemo(() => {
    const assetItems = finishedVideoAssets.map((asset) => ({
      id: `asset-${asset.id}`,
      assetId: asset.id,
      label: asset.title || "成片",
      url: asset.previewUrl || `/api/assets/${asset.id}/public-content`,
      taskId: asset.remoteId || "",
      ratio: String(asset.metadata.ratio || ""),
      resolution: String(asset.metadata.resolution || ""),
      seconds: String(asset.metadata.seconds || ""),
      added: true,
      source: "asset" as const,
    }));
    const assetIds = new Set(assetItems.map((item) => item.assetId).filter(Boolean));
    return [
      ...assetItems,
      ...nodeFinishedVideos.filter((item) => !item.assetId || !assetIds.has(item.assetId)),
    ];
  }, [finishedVideoAssets, nodeFinishedVideos]);

  const resolveFinishedVideoUrl = useCallback(async (video: (typeof finishedVideos)[number]) => {
    if (assetVideoUrls[video.id]) return assetVideoUrls[video.id];
    if (video.url && !video.url.startsWith("blob:")) {
      const nextUrl = resolveMediaUrl(video.url);
      setAssetVideoUrls((current) => ({ ...current, [video.id]: nextUrl }));
      return nextUrl;
    }
    if (!video.taskId) return video.url;

    setLoadingAssetIds((current) => ({ ...current, [video.id]: true }));
    try {
      const blob = await downloadGeneratedVideo(video.taskId);
      const nextUrl = URL.createObjectURL(blob);
      setAssetVideoUrls((current) => ({ ...current, [video.id]: nextUrl }));
      updateNodeConfig(video.id, { videoUrl: nextUrl });
      return nextUrl;
    } finally {
      setLoadingAssetIds((current) => ({ ...current, [video.id]: false }));
    }
  }, [assetVideoUrls, updateNodeConfig]);

  useEffect(() => {
    if (activeAssetCategory !== "finished") return;
    finishedVideos.forEach((video) => {
      if (!assetVideoUrls[video.id] && video.taskId) {
        void resolveFinishedVideoUrl(video);
      }
    });
  }, [activeAssetCategory, finishedVideos, assetVideoUrls, resolveFinishedVideoUrl]);

  const assets = [
    { key: "character" as const, label: "人物", value: String(assetTagCount("character")), icon: UserRound, color: "text-fuchsia-300" },
    { key: "scene" as const, label: "场景", value: String(assetTagCount("scene")), icon: Image, color: "text-cyan-300" },
    { key: "prop" as const, label: "道具", value: String(assetTagCount("prop")), icon: PackageCheck, color: "text-amber-300" },
    { key: "clip" as const, label: "片段", value: String(clipAssetCount), icon: Clapperboard, color: "text-emerald-300" },
    {
      key: "finished" as const,
      label: "成片",
      value: String(finishedVideos.length),
      icon: Film,
      color: "text-violet-300",
    },
  ];
  const activeAssetInfo = assets.find((asset) => asset.key === activeAssetCategory) ?? null;
  const categorizedAssets = useMemo(() => {
    if (!activeAssetCategory || activeAssetCategory === "finished") return [];
    if (activeAssetCategory === "clip") {
      return accountAssets.filter((asset) => asset.kind === "video" || asset.kind === "generated_video");
    }
    return accountAssets.filter((asset) => {
      const assetTag = typeof asset.metadata.tag === "string" ? asset.metadata.tag : "";
      return (asset.kind === "image" || asset.kind === "generated_image") && assetTag === activeAssetCategory;
    });
  }, [accountAssets, activeAssetCategory]);
  const nextAssetNodePosition = useCallback(() => {
    if (typeof window === "undefined") return { x: 120, y: 120 };
    return screenToFlowPosition({
      x: Math.max(220, window.innerWidth / 2 - 120),
      y: Math.max(180, window.innerHeight / 2 - 90),
    });
  }, [screenToFlowPosition]);
  const addImageAssetToCanvas = useCallback(
    (asset: AssetRecord) => {
      const tag = typeof asset.metadata.tag === "string" ? asset.metadata.tag : activeAssetCategory || "reference";
      const imageItem: ImageAssetItem = {
        id: `asset-${asset.id}`,
        assetId: asset.id,
        name: asset.title || "制作资产",
        url: resolveMediaUrl(asset.previewUrl || asset.publicUrl || asset.url),
        storageKey: asset.storageKey,
        tag: tag === "character" || tag === "scene" || tag === "prop" ? tag : "reference",
        uploadStatus: "saved",
      };
      addImageUploadNode([imageItem], nextAssetNodePosition());
      setActiveAssetCategory(null);
    },
    [activeAssetCategory, addImageUploadNode, nextAssetNodePosition]
  );
  const addVideoAssetToCanvas = useCallback(
    async (video: (typeof finishedVideos)[number] | AssetRecord) => {
      const title = "label" in video ? video.label : video.title || "视频资产";
      let url = video.url;
      if ("taskId" in video) {
        url = (await resolveFinishedVideoUrl(video)) || url;
      } else {
        url = resolveMediaUrl(video.previewUrl || video.publicUrl || video.url);
      }
      addVideoUploadNode(title || "视频资产", nextAssetNodePosition(), url);
      setActiveAssetCategory(null);
    },
    [addVideoUploadNode, nextAssetNodePosition, resolveFinishedVideoUrl]
  );

  return (
    <>
    <aside
      className={cn(
        "pointer-events-auto absolute right-0 top-[88px] z-10 flex h-[812px] w-[352px] flex-col rounded-l-3xl border border-r-0 border-white/10 bg-[#111118]/92 p-5 text-zinc-100 shadow-2xl backdrop-blur transition-transform duration-300 ease-out",
        collapsed ? "translate-x-[300px]" : "translate-x-0"
      )}
    >
      <button
        className="absolute -left-4 top-8 z-20 flex size-9 items-center justify-center rounded-full border border-white/10 bg-[#171720] text-zinc-300 shadow-2xl transition hover:bg-white/10 hover:text-white"
        onClick={onToggle}
        title={collapsed ? "展开制作资产" : "隐藏制作资产"}
        aria-label={collapsed ? "展开制作资产" : "隐藏制作资产"}
      >
        {collapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      <button
        className={cn(
          "absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-4 text-zinc-200 transition-opacity hover:bg-white/10",
          collapsed ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onToggle}
        aria-hidden={!collapsed}
      >
        <Layers3 className="size-4 text-fuchsia-300" />
        <span className="writing-mode-vertical text-xs font-semibold tracking-[0.2em] [writing-mode:vertical-rl]">
          制作资产
        </span>
      </button>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-opacity duration-200",
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        )}
      >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fuchsia-300">
            Assets & Runs
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">制作资产</h2>
        </div>
        <div className="flex gap-2">
          <button className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
            <Search className="size-4 text-zinc-400" />
          </button>
          <button className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
            <Layers3 className="size-4 text-zinc-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {assets.map(({ key, label, value, icon: Icon, color }) => (
          <button
            key={label}
            className="rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-fuchsia-300/40 hover:bg-white/[0.07]"
            onClick={() => setActiveAssetCategory(key)}
          >
            <div className="mb-3 flex items-center justify-between">
              <Icon className={cn("size-4", color)} />
              <span className="font-mono text-lg font-semibold text-white">{value}</span>
            </div>
            <p className="text-xs font-medium text-zinc-300">{label}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">模型选择</span>
          <span className="font-mono text-[10px] text-zinc-500">{activePanelModel ? "BOUND" : "LOCKED"}</span>
        </div>
        <div className="space-y-2 text-xs">
          {modelRows.map((row) => (
            <div key={row.label} className={cn("flex items-center justify-between gap-3 rounded-xl px-3 py-2", row.className)}>
              <span className="shrink-0 font-semibold">{row.label}</span>
              <span className="min-w-0 truncate text-right opacity-80">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex-1 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold">生成队列</span>
          <Pill active className="h-7">
            {readyCount} ready
          </Pill>
        </div>
        <div className="space-y-4">
          {studioNodes.slice(0, 5).map((node, index) => (
            (() => {
              const status = displayNodeStatus(node);
              return (
                <div key={`${node.label}-${index}`}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-zinc-300">{displayNodeLabel(node.label)}</span>
                    <span className={cn(status === "error" ? "text-rose-300" : "text-zinc-500")}>{statusText[status]}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        status === "error"
                          ? "bg-rose-400"
                          : "bg-gradient-to-r from-cyan-300 via-violet-400 to-fuchsia-400"
                      )}
                      style={{ width: status === "done" ? "100%" : status === "running" ? "68%" : status === "error" ? "100%" : "30%" }}
                    />
                  </div>
                </div>
              );
            })()
          ))}
        </div>
      </div>

      </div>
    </aside>
    {activeAssetCategory && activeAssetInfo && (
      <div
        className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm"
        onClick={() => setActiveAssetCategory(null)}
      >
        <div
          className="w-full max-w-3xl rounded-3xl border border-white/10 bg-[#111118] p-5 text-zinc-100 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300">
                Account Assets
              </p>
              <h3 className="mt-1 text-lg font-semibold">{activeAssetInfo.label}资产</h3>
              <p className="mt-1 text-xs text-zinc-500">点击素材预览，点击“加入画布”复用为新节点。</p>
            </div>
            <button
              className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => setActiveAssetCategory(null)}
              aria-label="关闭资产列表"
            >
              <X className="size-4" />
            </button>
          </div>

          {activeAssetCategory === "finished" && finishedVideos.length > 0 ? (
            <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto">
              {finishedVideos.map((video) => {
                const resolvedUrl = assetVideoUrls[video.id] || (!video.url.startsWith("blob:") ? resolveMediaUrl(video.url) : "");
                const isLoading = Boolean(loadingAssetIds[video.id]);
                return (
                  <div
                    key={video.id}
                    className="group rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-violet-300/40 hover:bg-white/[0.07]"
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={async () => {
                        const nextUrl = await resolveFinishedVideoUrl(video);
                        if (nextUrl) setPreviewVideo({ title: video.label, url: nextUrl });
                      }}
                    >
                      <div className="relative mb-3 aspect-video overflow-hidden rounded-xl bg-black">
                      {resolvedUrl && (
                        <video src={resolvedUrl} className="size-full object-cover" preload="metadata" muted />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                        <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition group-hover:scale-105">
                          <Play className="ml-0.5 size-4 fill-current" />
                        </span>
                      </div>
                      </div>
                      <p className="truncate text-sm font-semibold text-white">{video.label}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase text-zinc-500">
                        {isLoading ? "正在恢复视频" : `${video.seconds}s · ${video.ratio} · ${video.resolution}`}
                      </p>
                    </button>
                    <button
                      type="button"
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-400"
                      onClick={() => void addVideoAssetToCanvas(video)}
                    >
                      <Plus className="size-3.5" />
                      加入画布
                    </button>
                  </div>
                );
              })}
            </div>
          ) : activeAssetCategory !== "finished" && categorizedAssets.length > 0 ? (
            <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto">
              {categorizedAssets.map((asset) => {
                const isVideoAsset = asset.kind === "video" || asset.kind === "generated_video";
                const mediaUrl = resolveMediaUrl(asset.previewUrl || asset.publicUrl || asset.url);
                return (
                  <div
                    key={asset.id}
                    className="group rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-fuchsia-300/40 hover:bg-white/[0.07]"
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => {
                        if (!mediaUrl) return;
                        if (isVideoAsset) {
                          setPreviewVideo({ title: asset.title || activeAssetInfo.label, url: mediaUrl });
                        } else {
                          setPreviewImage({ title: asset.title || activeAssetInfo.label, url: mediaUrl });
                        }
                      }}
                    >
                      <div className="relative mb-3 aspect-video overflow-hidden rounded-xl bg-black">
                        {mediaUrl ? (
                          isVideoAsset ? (
                            <video src={mediaUrl} className="size-full object-cover" preload="metadata" muted />
                          ) : (
                            <img src={mediaUrl} alt={asset.title} className="size-full object-cover" />
                          )
                        ) : (
                          <div className="grid size-full place-items-center text-zinc-500">
                            <Image className="size-8" />
                          </div>
                        )}
                        {isVideoAsset ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition group-hover:scale-105">
                              <Play className="ml-0.5 size-4 fill-current" />
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <p className="truncate text-sm font-semibold text-white">{asset.title || activeAssetInfo.label}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase text-zinc-500">
                        {asset.kind} · {asset.provider || "local"}
                      </p>
                    </button>
                    <button
                      type="button"
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-400"
                      onClick={() => {
                        if (isVideoAsset) {
                          void addVideoAssetToCanvas(asset);
                        } else {
                          addImageAssetToCanvas(asset);
                        }
                      }}
                    >
                      <Plus className="size-3.5" />
                      加入画布
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 text-center text-sm text-zinc-400">
              还没有加入制作资产的{activeAssetInfo.label}
            </div>
          )}
        </div>
      </div>
    )}
    {previewImage && (
      <div
        className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        onClick={() => setPreviewImage(null)}
      >
        <div
          className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="truncate text-base font-semibold">{previewImage.title}</h3>
            <button
              className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => setPreviewImage(null)}
              aria-label="关闭图片预览"
            >
              <X className="size-4" />
            </button>
          </div>
          <img
            src={previewImage.url}
            alt={previewImage.title}
            className="max-h-[72vh] w-full rounded-2xl bg-black object-contain"
          />
        </div>
      </div>
    )}
    {previewVideo && (
      <div
        className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        onClick={() => setPreviewVideo(null)}
      >
        <div
          className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="truncate text-base font-semibold">{previewVideo.title}</h3>
            <button
              className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => setPreviewVideo(null)}
              aria-label="关闭成片预览"
            >
              <X className="size-4" />
            </button>
          </div>
          <video
            src={previewVideo.url}
            controls
            autoPlay
            className="max-h-[72vh] w-full rounded-2xl bg-black"
          />
        </div>
      </div>
    )}
    </>
  );
}

function FloatingTools({
  assetPanelCollapsed,
  onOpenAddMenu,
}: {
  assetPanelCollapsed: boolean;
  onOpenAddMenu: (event: ReactMouseEvent<HTMLButtonElement>, flowPosition: XYPosition) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const tools = [
    { icon: Plus, active: true, label: "添加素材" },
    { icon: MousePointer2 },
    { icon: Layers3 },
    { icon: Search },
  ];
  return (
    <div
      className={cn(
        "pointer-events-auto absolute top-[300px] z-10 flex w-12 flex-col items-center gap-2 rounded-full border border-white/10 bg-[#111118]/90 p-2 shadow-2xl backdrop-blur transition-[right] duration-300 ease-out",
        assetPanelCollapsed ? "right-[72px]" : "right-[376px]"
      )}
    >
      {tools.map(({ icon: Icon, active }, index) => (
        <button
          key={index}
          type="button"
          className={cn(
            "flex size-8 items-center justify-center rounded-full",
            active ? "bg-fuchsia-500 text-white" : "bg-white/[0.06] text-zinc-400"
          )}
          onClick={(event) => {
            if (index !== 0) return;
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenAddMenu(
              event,
              screenToFlowPosition({
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              })
            );
          }}
          aria-label={index === 0 ? "添加素材" : undefined}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

type ContextMenuPosition = {
  x: number;
  y: number;
};

type CanvasContextMenuEvent = MouseEvent | ReactMouseEvent;

type AssetContextMenuState = {
  screenPosition: ContextMenuPosition;
  flowPosition: XYPosition;
};

type NextStepMenuState = {
  sourceNodeId: string;
  screenPosition: ContextMenuPosition;
  flowPosition: XYPosition;
};

function AddAssetMenu({
  position,
  onPickVideo,
  onPickImage,
  onAddVideoStitcher,
}: {
  position: ContextMenuPosition;
  onPickVideo: () => void;
  onPickImage: () => void;
  onAddVideoStitcher: () => void;
}) {
  return (
    <div
      data-asset-context-menu
      className="pointer-events-auto absolute z-30 w-[246px] rounded-3xl border border-white/10 bg-[#15151c]/95 p-3 shadow-2xl backdrop-blur"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        添加素材
      </p>
      {[
        { icon: FileVideo, label: "上传视频", action: onPickVideo },
        { icon: Image, label: "上传图片", action: onPickImage },
        { icon: Film, label: "视频拼接器", action: onAddVideoStitcher },
        { icon: Clapperboard, label: "上传剧本", action: undefined },
      ].map(({ icon: Icon, label, action }) => (
        <button
          key={label}
          className="mb-2 flex h-11 w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-3 text-left text-sm font-medium text-zinc-100 hover:bg-white/[0.09]"
          onClick={action}
        >
          <Icon className="size-4 text-zinc-400" />
          {label}
        </button>
      ))}
    </div>
  );
}

function NextStepMenu({
  position,
  onPick,
}: {
  position: ContextMenuPosition;
  onPick: (kind: "text" | "image" | "video") => void;
}) {
  return (
    <div
      data-next-step-menu
      className="pointer-events-auto absolute z-30 w-[196px] rounded-2xl border border-white/10 bg-[#202026]/95 p-3 text-zinc-100 shadow-2xl backdrop-blur"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="px-2 pb-2 text-xs font-medium text-zinc-400">引用该节点生成</p>
      {[
        { icon: Type, label: "文本", kind: "text" as const },
        { icon: Image, label: "图片", kind: "image" as const },
        { icon: FileVideo, label: "视频", kind: "video" as const },
      ].map(({ icon: Icon, label, kind }) => (
        <button
          key={kind}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08]"
          onClick={() => onPick(kind)}
        >
          <Icon className="size-4 text-zinc-300" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Composer({
  collapsed,
  onPickVideo,
  reference,
  upstreamScriptCount,
  imageModels,
  videoModels,
  selectedImageModel,
  selectedVideoModel,
  imageParams,
  videoParams,
  initialPrompt,
  isImageGenerationNode,
  isVideoGenerationNode,
  isTextGenerationNode,
  generatingImage,
  generatingVideo,
  generatingText,
  onRemoveReference,
  onSelectImageModel,
  onSelectVideoModel,
  onChangeImageParams,
  onChangeVideoParams,
  onGenerateImage,
  onGenerateVideo,
  onGenerateText,
}: {
  collapsed: boolean;
  onPickVideo: () => void;
  reference: ComposerReference | null;
  upstreamScriptCount: number;
  imageModels: ImageModelOption[];
  videoModels: VideoModelOption[];
  selectedImageModel: string;
  selectedVideoModel: string;
  imageParams: ImageGenerationParams;
  videoParams: VideoGenerationParams;
  initialPrompt: string;
  isImageGenerationNode: boolean;
  isVideoGenerationNode: boolean;
  isTextGenerationNode: boolean;
  generatingImage: boolean;
  generatingVideo: boolean;
  generatingText: boolean;
  onRemoveReference: (item: ComposerReferenceItem) => void;
  onSelectImageModel: (model: string) => void;
  onSelectVideoModel: (model: string) => void;
  onChangeImageParams: (params: ImageGenerationParams) => void;
  onChangeVideoParams: (params: VideoGenerationParams) => void;
  onGenerateImage: (prompt: string, options?: ImageGenerateOptions) => void;
  onGenerateVideo: (prompt: string) => void;
  onGenerateText: (prompt: string) => void;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectedSetting, setSelectedSetting] = useState<(typeof settingImageOptions)[number] | null>(null);
  const [prompt, setPrompt] = useState("");
  const modelControlRef = useRef<HTMLDivElement>(null);
  const paramsControlRef = useRef<HTMLDivElement>(null);
  const presetControlRef = useRef<HTMLDivElement>(null);
  const references = reference?.items ?? [];
  const activePreviewIndex = previewIndex ?? 0;
  const previewItem = previewIndex !== null ? references[activePreviewIndex] ?? null : null;
  const visibleReferences = references.slice(0, 4);
  const imageReferenceCount = references.filter((item) => item.kind === "image").length;
  const referenceBadgeCount = references.length;
  const limitedVideoReferenceModel =
    selectedVideoModel === "bds-pro" || selectedVideoModel === "doubao-seedance-1-5-pro-251215";
  const videoReferenceHint =
    isVideoGenerationNode && imageReferenceCount > 0
      ? limitedVideoReferenceModel
        ? `当前模型最多使用前2张图，${imageReferenceCount > 2 ? `其余${imageReferenceCount - 2}张会写入提示词` : "适合首尾帧/单主体"}`
        : `当前模型支持多图参考，将引用${imageReferenceCount}张图片`
      : "";
  const selectedModelLabel = isVideoGenerationNode
    ? videoModels.find((item) => item.model === selectedVideoModel)?.label ?? "视频模型"
    : isTextGenerationNode
      ? "Doubao Seed 2.0 Pro"
    : imageModels.find((item) => item.model === selectedImageModel)?.label ?? "Lib Image";
  const activeModelOptions = isVideoGenerationNode ? videoModels : imageModels;
  const activeModelValue = isVideoGenerationNode ? selectedVideoModel : selectedImageModel;
  const paramsLabel = isTextGenerationNode
    ? "剧本 · 分镜 · 台词"
    : `${imageParams.ratio} · ${imageParams.quality} · ${imageParams.resolution} · ${imageParams.count}张`;
  const videoParamsLabel = `${videoParams.ratio} · ${videoParams.resolution} · ${videoParams.seconds}s`;
  const SelectedSettingIcon = selectedSetting?.icon;
  const composerPlaceholder = isVideoGenerationNode
    ? "输入视频生成要求，如：根据上游剧本和参考图，生成 8 秒镜头，写清镜头运动、人物动作、情绪节奏和画面风格"
    : isTextGenerationNode
      ? "输入剧本生成要求，如：基于上游人物和场景，生成 30 秒短剧分镜、台词和转场节奏"
      : isImageGenerationNode
        ? "输入图片生成要求，如：基于上游参考图生成角色设定图，保持人物一致性和商业质感"
        : "请先选中图片、剧本或视频生成节点，再输入生成要求";
  const textPromptRequired = isTextGenerationNode && !prompt.trim();
  const submitTitle = isImageGenerationNode
    ? "生成图片"
    : isVideoGenerationNode
      ? "生成视频，将自动引用全链路图片和剧本"
      : isTextGenerationNode
        ? textPromptRequired
          ? "请先输入剧本生成要求"
          : "生成剧本"
        : "请先选中生成节点";
  const updateParams = (patch: Partial<ImageGenerationParams>) => {
    onChangeImageParams({ ...imageParams, ...patch });
  };
  const updateVideoParams = (patch: Partial<VideoGenerationParams>) => {
    onChangeVideoParams({ ...videoParams, ...patch });
  };
  const selectModel = (model: string) => {
    if (isVideoGenerationNode) {
      onSelectVideoModel(model);
    } else if (isImageGenerationNode) {
      onSelectImageModel(model);
    }
    setModelOpen(false);
  };

  useEffect(() => {
    setPrompt(initialPrompt);
    setSelectedSetting(null);
    setModelOpen(false);
    setParamsOpen(false);
    setPresetOpen(false);
  }, [initialPrompt]);

  useEffect(() => {
    if (!modelOpen && !paramsOpen && !presetOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (modelOpen && modelControlRef.current?.contains(target)) return;
      if (paramsOpen && paramsControlRef.current?.contains(target)) return;
      if (presetOpen && presetControlRef.current?.contains(target)) return;

      setModelOpen(false);
      setParamsOpen(false);
      setPresetOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [modelOpen, paramsOpen, presetOpen]);

  return (
    <>
      <div
        className={cn(
          "pointer-events-auto absolute bottom-6 left-1/2 z-20 w-[820px] -translate-x-1/2 rounded-[22px] border border-white/10 bg-[#282828]/96 p-4 shadow-2xl backdrop-blur transition-all duration-300 ease-out",
          collapsed ? "pointer-events-none translate-y-[148px] opacity-0" : "translate-y-0 opacity-100"
        )}
        aria-hidden={collapsed}
      >
        <div className="min-h-[118px]">
          {references.length > 0 ? (
            <div className="mb-5 flex items-center gap-3">
              <div className="flex items-center gap-2">
                {visibleReferences.map((item, index) => (
                  <div
                    key={`${item.url}-${index}`}
                    className="group relative size-12"
                  >
                    <button
                      className="relative size-12 overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-white/35"
                      onClick={() => setPreviewIndex(index)}
                      aria-label={`查看参考素材 ${index + 1}`}
                    >
                      {item.kind === "video" ? (
                        <>
                          <video src={item.url} className="size-full object-cover" preload="metadata" muted />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="ml-0.5 size-4 fill-white text-white" />
                          </div>
                        </>
                      ) : (
                        <img src={item.url} alt={item.label} className="size-full object-cover" />
                      )}
                      {index === 0 && (
                        <span className="absolute left-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[#101014]/85 text-[10px] font-semibold text-white">
                          {referenceBadgeCount}
                        </span>
                      )}
                      {index === 3 && references.length > 4 && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-semibold text-white">
                          +{references.length - 4}
                        </span>
                      )}
                    </button>
                    <button
                      className="absolute -right-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full border border-white/20 bg-[#19191f] text-zinc-300 opacity-0 shadow-lg transition hover:bg-rose-500 hover:text-white group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveReference(item);
                        setPreviewIndex((current) => {
                          if (current === null) return null;
                          if (current >= references.length - 1) return Math.max(0, references.length - 2);
                          return current;
                        });
                      }}
                      aria-label={`移除参考素材 ${index + 1}`}
                      title="从本次生成中移除"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
              {isVideoGenerationNode && (
                <div className="flex flex-wrap items-center gap-2">
                  {videoReferenceHint && (
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                        limitedVideoReferenceModel && imageReferenceCount > 2
                          ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
                          : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                      )}
                    >
                      {videoReferenceHint}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              className="mb-5 flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-400 transition hover:bg-white/10 hover:text-white"
              onClick={onPickVideo}
              aria-label="添加参考素材"
            >
              <Plus className="size-5" />
            </button>
          )}

          <div className="flex min-h-14 items-start gap-2">
            {selectedSetting && isImageGenerationNode && (
              <div
                className="nodrag nopan group relative mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-fuchsia-300/35 bg-fuchsia-400/12 px-2 text-xs font-semibold text-white transition hover:bg-fuchsia-400/18"
              >
                {SelectedSettingIcon && <SelectedSettingIcon className="size-3.5 text-fuchsia-200" />}
                {selectedSetting.label}
                <button
                  className="flex size-4 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  onClick={() => setSelectedSetting(null)}
                  aria-label="清除设定图类型"
                >
                  <X className="size-3" />
                </button>
                <span className="pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-[520px] rounded-xl border border-white/12 bg-[#18181d]/98 p-3 text-left text-xs font-medium leading-5 text-zinc-200 shadow-[0_18px_48px_rgba(0,0,0,0.5)] backdrop-blur group-hover:block">
                  {selectedSetting.prompt}
                </span>
              </div>
            )}
            {isImageGenerationNode && upstreamScriptCount > 0 && (
              <div className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 text-xs font-semibold text-cyan-100">
                <Captions className="size-3.5" />
                已引用上游文案 {upstreamScriptCount}
              </div>
            )}
            <textarea
              className="nodrag nopan block h-14 min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
              placeholder={composerPlaceholder}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
        </div>

        <div className="flex h-9 items-center gap-3 text-xs text-zinc-200">
          <div ref={modelControlRef} className="relative">
            <button
              className={cn(
                "nodrag nopan flex h-8 max-w-[220px] items-center gap-2 rounded-full px-1.5 text-left transition hover:bg-white/[0.06]",
                modelOpen && "bg-white/[0.08]"
              )}
              onClick={() => {
                if (!isImageGenerationNode && !isVideoGenerationNode) return;
                setParamsOpen(false);
                setPresetOpen(false);
                setModelOpen((value) => !value);
              }}
              title={isTextGenerationNode ? "文案生成模型" : isImageGenerationNode || isVideoGenerationNode ? "选择生成模型" : "请先选中生成节点"}
            >
              <Link2 className="size-4 shrink-0 text-zinc-100" />
              <span className="truncate">{selectedModelLabel}</span>
              {(isImageGenerationNode || isVideoGenerationNode) && (
                modelOpen ? (
                  <ChevronUp className="size-3.5 shrink-0 text-zinc-400" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
                )
              )}
            </button>
            {modelOpen && (isImageGenerationNode || isVideoGenerationNode) && (
              <div className="nodrag nopan absolute bottom-10 left-0 z-30 w-[430px] overflow-hidden rounded-2xl border border-white/12 bg-[#242424]/98 p-2 text-zinc-100 shadow-[0_22px_60px_rgba(0,0,0,0.52)] backdrop-blur">
                <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
                  {activeModelOptions.map((option) => {
                    const selected = option.model === activeModelValue;
                    const meta = isVideoGenerationNode
                      ? videoModelMeta[option.model] ?? { description: "视频生成模型", chip: "60s" }
                      : imageModelMeta[option.model] ?? { description: "图片生成模型", chip: "50s" };
                    const OptionIcon = isVideoGenerationNode ? Film : option.model.includes("seedream") ? Film : Sparkles;
                    return (
                      <button
                        key={option.model}
                        className={cn(
                          "flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
                          selected ? "bg-white/[0.13]" : "hover:bg-white/[0.08]"
                        )}
                        onClick={() => selectModel(option.model)}
                      >
                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg",
                            selected ? "bg-white/[0.15] text-white" : "bg-white/[0.08] text-zinc-400"
                          )}
                        >
                          <OptionIcon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-sm font-semibold", selected ? "text-white" : "text-zinc-100")}>
                            {option.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-4 text-zinc-500">{meta.description}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-400">
                          {meta.chip}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="h-5 w-px bg-white/12" />
          <div ref={paramsControlRef} className="relative">
            <button
              className={cn(
                "nodrag nopan flex h-8 items-center gap-2 rounded-full px-1.5 transition hover:bg-white/[0.06]",
                paramsOpen && "bg-white/[0.08]"
              )}
              onClick={() => {
                if (isImageGenerationNode || isVideoGenerationNode) {
                  setModelOpen(false);
                  setPresetOpen(false);
                  setParamsOpen((value) => !value);
                }
              }}
              title={isImageGenerationNode ? "调整生成参数" : isVideoGenerationNode ? "视频生成参数" : "请先选中生成节点"}
            >
              <Monitor className="size-4 text-zinc-200" />
              <span>{isVideoGenerationNode ? videoParamsLabel : paramsLabel}</span>
              {(isImageGenerationNode || isVideoGenerationNode) && (
                paramsOpen ? (
                  <ChevronUp className="size-3.5 text-zinc-400" />
                ) : (
                  <ChevronDown className="size-3.5 text-zinc-400" />
                )
              )}
            </button>
            {paramsOpen && isImageGenerationNode && (
              <div className="nodrag nopan absolute bottom-10 left-0 z-30 w-[370px] rounded-2xl border border-white/12 bg-[#252525]/98 p-4 text-zinc-200 shadow-[0_22px_60px_rgba(0,0,0,0.48)] backdrop-blur">
                <p className="mb-2 text-sm font-semibold text-zinc-300">画质</p>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {imageQualities.map((quality) => (
                    <button
                      key={quality}
                      className={cn(
                        "h-8 rounded-lg border text-xs transition",
                        imageParams.quality === quality
                          ? "border-white bg-white/12 text-white"
                          : "border-white/14 bg-white/[0.035] text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                      )}
                      onClick={() => updateParams({ quality })}
                    >
                      {quality}
                    </button>
                  ))}
                </div>

                <p className="mb-2 text-sm font-semibold text-zinc-300">清晰度</p>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {imageResolutions.map((resolution) => (
                    <button
                      key={resolution}
                      className={cn(
                        "h-8 rounded-lg border text-xs transition",
                        imageParams.resolution === resolution
                          ? "border-white bg-white/12 text-white"
                          : "border-white/14 bg-white/[0.035] text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                      )}
                      onClick={() => updateParams({ resolution })}
                    >
                      {resolution}
                    </button>
                  ))}
                </div>

                <p className="mb-2 text-sm font-semibold text-zinc-300">比例</p>
                <div className="mb-4 grid grid-cols-5 gap-2">
                  {imageRatios.map((ratio) => (
                    <button
                      key={ratio}
                      className={cn(
                        "flex h-[62px] flex-col items-center justify-center gap-2 rounded-lg border text-xs transition",
                        imageParams.ratio === ratio
                          ? "border-white bg-white/12 text-white"
                          : "border-white/14 bg-white/[0.035] text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                      )}
                      onClick={() => updateParams({ ratio })}
                    >
                      <span
                        className="block rounded-[2px] border border-current"
                        style={{
                          width: ratio === "21:9" || ratio === "2:1" ? 18 : ratio === "1:1" ? 12 : ratio.includes(":16") || ratio === "1:2" || ratio === "2:3" || ratio === "4:5" || ratio === "9:21" ? 8 : 14,
                          height: ratio === "1:1" ? 12 : ratio === "21:9" || ratio === "2:1" ? 8 : ratio.includes(":16") || ratio === "1:2" || ratio === "2:3" || ratio === "4:5" || ratio === "9:21" ? 18 : 11,
                        }}
                      />
                      {ratio}
                    </button>
                  ))}
                </div>

                <p className="mb-2 text-sm font-semibold text-zinc-300">生成数量</p>
                <div className="grid grid-cols-3 gap-2">
                  {imageCounts.map((count) => (
                    <button
                      key={count}
                      className={cn(
                        "h-8 rounded-lg border text-xs transition",
                        imageParams.count === count
                          ? "border-white bg-white/12 text-white"
                          : "border-white/14 bg-white/[0.035] text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                      )}
                      onClick={() => updateParams({ count })}
                    >
                      {count}张
                    </button>
                  ))}
                </div>
              </div>
            )}
            {paramsOpen && isVideoGenerationNode && (
              <div className="nodrag nopan absolute bottom-10 left-0 z-30 w-[370px] rounded-2xl border border-white/12 bg-[#252525]/98 p-4 text-zinc-200 shadow-[0_22px_60px_rgba(0,0,0,0.48)] backdrop-blur">
                <p className="mb-4 text-sm font-semibold text-zinc-300">视频设置</p>

                <p className="mb-2 text-xs font-semibold text-zinc-400">生成方式</p>
                <div className="mb-5 grid grid-cols-3 rounded-xl bg-white/[0.045] p-1">
                  {videoModes.map((mode) => (
                    <button
                      key={mode.value}
                      className={cn(
                        "h-8 rounded-lg text-xs font-medium transition",
                        videoParams.mode === mode.value
                          ? "bg-white/12 text-white shadow-sm"
                          : "text-zinc-500 hover:text-zinc-200"
                      )}
                      onClick={() => updateVideoParams({ mode: mode.value })}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <p className="mb-2 text-xs font-semibold text-zinc-400">宽高比</p>
                <div className="mb-5 grid grid-cols-4 gap-2">
                  {videoRatios.map((ratio) => {
                    const active = videoParams.ratio === ratio;
                    const isAuto = ratio === "Auto";
                    return (
                      <button
                        key={ratio}
                        className={cn(
                          "flex h-[66px] flex-col items-center justify-center gap-2 rounded-xl border bg-white/[0.035] text-xs transition",
                          active
                            ? "border-white bg-white/12 text-white"
                            : "border-white/14 text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                        )}
                        onClick={() => updateVideoParams({ ratio })}
                      >
                        {isAuto ? (
                          <span className="font-medium">Auto</span>
                        ) : (
                          <span
                            className="block rounded-[3px] border border-current"
                            style={{
                              width: ratio === "21:9" || ratio === "16:9" ? 18 : ratio === "1:1" ? 14 : 10,
                              height: ratio === "21:9" || ratio === "16:9" ? 8 : ratio === "1:1" ? 14 : 18,
                            }}
                          />
                        )}
                        <span>{ratio}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mb-5">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-400">时长</span>
                    <span className="text-zinc-500">{videoParams.seconds}s / max 15s</span>
                  </div>
                  <input
                    className="w-full accent-white"
                    type="range"
                    min={0}
                    max={videoSeconds.length - 1}
                    step={1}
                    value={videoSeconds.indexOf(videoParams.seconds)}
                    onChange={(event) => updateVideoParams({ seconds: videoSeconds[Number(event.target.value)] })}
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                    {videoSeconds.map((second) => (
                      <span key={second}>{second}s</span>
                    ))}
                  </div>
                </div>

                <p className="mb-2 text-xs font-semibold text-zinc-400">分辨率</p>
                <div className="mb-5 flex flex-wrap gap-2">
                  {videoResolutions.map((resolution) => (
                    <button
                      key={resolution}
                      className={cn(
                        "h-9 rounded-full border px-4 text-xs font-medium transition",
                        videoParams.resolution === resolution
                          ? "border-white bg-white/12 text-white"
                          : "border-white/14 bg-white/[0.035] text-zinc-400 hover:border-white/35 hover:text-zinc-100"
                      )}
                      onClick={() => updateVideoParams({ resolution })}
                    >
                      {resolution}
                    </button>
                  ))}
                </div>

                {[
                  { label: "音频", checked: videoParams.generate_audio, patch: { generate_audio: !videoParams.generate_audio } },
                  { label: "固定镜头", checked: videoParams.camerafixed, patch: { camerafixed: !videoParams.camerafixed } },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="flex h-10 w-full items-center justify-between text-sm text-zinc-300"
                    onClick={() => updateVideoParams(item.patch)}
                  >
                    <span>{item.label}</span>
                    <span
                      className={cn(
                        "flex h-5 w-9 items-center rounded-full p-0.5 transition",
                        item.checked ? "bg-white" : "bg-white/14"
                      )}
                    >
                      <span
                        className={cn(
                          "size-4 rounded-full shadow transition",
                          item.checked ? "bg-[#252525]" : "bg-zinc-500",
                          item.checked && "translate-x-4"
                        )}
                      />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="h-5 w-px bg-white/12" />
          <div ref={presetControlRef} className="relative">
            <button
              className={cn(
                "nodrag nopan relative flex size-8 items-center justify-center rounded-full transition hover:bg-white/[0.06]",
                presetOpen && "bg-white/[0.08]"
              )}
              onClick={() => {
                if (!isImageGenerationNode) return;
                setModelOpen(false);
                setParamsOpen(false);
                setPresetOpen((value) => !value);
              }}
              title={isImageGenerationNode ? "设定图" : "请先选中图片生成节点"}
            >
              <SlidersHorizontal className="size-4 text-zinc-200" />
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-cyan-300" />
            </button>
            {presetOpen && isImageGenerationNode && (
              <div className="nodrag nopan absolute bottom-10 left-1/2 z-30 w-[260px] -translate-x-1/2 rounded-2xl border border-white/12 bg-[#252525]/98 p-4 text-zinc-100 shadow-[0_22px_60px_rgba(0,0,0,0.48)] backdrop-blur">
                <p className="mb-3 text-sm font-semibold text-zinc-400">设定图</p>
                <div className="space-y-2">
                  {settingImageOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                    <button
                      key={option.label}
                      className="flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left transition hover:bg-white/[0.07]"
                      onClick={() => {
                        setSelectedSetting(option);
                        setPrompt((current) => (isBuiltInSettingPrompt(current) ? "" : current));
                        setPresetOpen(false);
                      }}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-zinc-200">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-zinc-100">{option.label}</span>
                      </span>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button className="flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300">
            <Sparkles className="size-4" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Type className="size-4 text-zinc-100" />
            <div className="flex items-center gap-1 text-zinc-500">
              <Zap className="size-3.5" />
              <span>22</span>
            </div>
            <button
              className="ml-1 flex size-9 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100"
              disabled={
                (!isImageGenerationNode && !isVideoGenerationNode && !isTextGenerationNode) ||
                textPromptRequired ||
                generatingImage ||
                generatingVideo ||
                generatingText
              }
              onClick={() => {
                setModelOpen(false);
                setParamsOpen(false);
                setPresetOpen(false);
                const userPrompt = prompt.trim();
                if (isImageGenerationNode) {
                  onGenerateImage(userPrompt, selectedSetting
                    ? { settingPrompt: selectedSetting.prompt, settingLabel: selectedSetting.label }
                    : undefined);
                } else if (isVideoGenerationNode) {
                  onGenerateVideo(userPrompt);
                } else if (isTextGenerationNode) {
                  onGenerateText(userPrompt);
                }
              }}
              title={submitTitle}
            >
              {generatingImage || generatingVideo || generatingText ? <Sparkles className="size-4 animate-pulse" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      {previewItem && (
        <div
          className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
          onClick={() => setPreviewIndex(null)}
        >
          <div
            className="w-full max-w-5xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
                  Reference {activePreviewIndex + 1} / {references.length}
                </p>
                <h3 className="mt-1 truncate text-base font-semibold">{previewItem.label}</h3>
              </div>
              <button
                className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
                onClick={() => setPreviewIndex(null)}
                aria-label="关闭参考素材预览"
              >
                <X className="size-4" />
              </button>
            </div>
            {previewItem.kind === "video" ? (
              <video
                src={previewItem.url}
                controls
                autoPlay
                className="max-h-[72vh] w-full rounded-2xl bg-black"
              />
            ) : (
              <img
                src={previewItem.url}
                alt={previewItem.label}
                className="max-h-[72vh] w-full rounded-2xl bg-black object-contain"
              />
            )}
            {references.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {references.map((item, index) => (
                  <button
                    key={`${item.url}-preview-${index}`}
                    className={cn(
                      "relative size-14 shrink-0 overflow-hidden rounded-xl border bg-black/40",
                      index === activePreviewIndex ? "border-cyan-300" : "border-white/10"
                    )}
                    onClick={() => setPreviewIndex(index)}
                    aria-label={`切换参考素材 ${index + 1}`}
                  >
                    {item.kind === "video" ? (
                      <video src={item.url} className="size-full object-cover" preload="metadata" muted />
                    ) : (
                      <img src={item.url} alt={item.label} className="size-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StudioShell() {
  const [assetMenu, setAssetMenu] = useState<AssetContextMenuState | null>(null);
  const [nextStepMenu, setNextStepMenu] = useState<NextStepMenuState | null>(null);
  const [assetPanelCollapsed, setAssetPanelCollapsed] = useState(true);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>(fallbackImageModels);
  const [videoModels, setVideoModels] = useState<VideoModelOption[]>(fallbackVideoModels);
  const [selectedImageModel, setSelectedImageModel] = useState("gpt-image-2");
  const [selectedVideoModel, setSelectedVideoModel] = useState("doubao-seedance-1-5-pro-251215");
  const [imageParams, setImageParams] = useState<ImageGenerationParams>({
    quality: "标准画质",
    resolution: "2K",
    ratio: "16:9",
    count: 1,
  });
  const [videoParams, setVideoParams] = useState<VideoGenerationParams>({
    mode: "reference",
    ratio: "9:16",
    resolution: "720p",
    seconds: 8,
    generate_audio: true,
    camerafixed: false,
  });
  const [activeGenerationNodeIds, setActiveGenerationNodeIds] = useState<Set<string>>(() => new Set());
  const [excludedReferencesByNode, setExcludedReferencesByNode] = useState<Record<string, string[]>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadPositionRef = useRef<XYPosition | null>(null);
  const pendingImageUploadPositionRef = useRef<XYPosition | null>(null);
  const pendingImageAppendNodeIdRef = useRef<string | null>(null);
  const pendingReplaceNodeIdRef = useRef<string | null>(null);
  const videoObjectUrlsRef = useRef<string[]>([]);
  const imageObjectUrlsRef = useRef<string[]>([]);
  const ignoreNextPaneClickRef = useRef(false);
  const addVideoUploadNode = useFlowStore((state) => state.addVideoUploadNode);
  const addVideoStitcherNode = useFlowStore((state) => state.addVideoStitcherNode);
  const addImageUploadNode = useFlowStore((state) => state.addImageUploadNode);
  const appendImagesToNode = useFlowStore((state) => state.appendImagesToNode);
  const updateImageAsset = useFlowStore((state) => state.updateImageAsset);
  const updateNodeConfig = useFlowStore((state) => state.updateNodeConfig);
  const updateNodeData = useFlowStore((state) => state.updateNodeData);
  const addReferencedNode = useFlowStore((state) => state.addReferencedNode);
  const runTextGeneration = useFlowStore((state) => state.runTextGeneration);
  const runImageGeneration = useFlowStore((state) => state.runImageGeneration);
  const runSeedanceGeneration = useFlowStore((state) => state.runSeedanceGeneration);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const selectedNodeId = useFlowStore((state) => state.nodes.find((node) => node.selected)?.id ?? null);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedNodeGenerating = Boolean(selectedNodeId && activeGenerationNodeIds.has(selectedNodeId));
  const isImageGenerationNode =
    selectedNode?.type === "sceneAsset" &&
    (selectedNode.data.config.mode === "referenced_image" || selectedNode.data.label.includes("图片生成"));
  const isVideoGenerationNode =
    selectedNode?.type === "videoGeneration" &&
    (selectedNode.data.config.mode === "referenced_video" ||
      selectedNode.data.label.includes("视频生成") ||
      selectedNode.data.label.includes("Seedance") ||
      selectedNode.data.label.includes("Kling") ||
      selectedNode.data.label.includes("Veo") ||
      selectedNode.data.label.includes("Gemini") ||
      selectedNode.data.label.includes("Bds"));
  const isTextGenerationNode =
    selectedNode?.type === "storyboardScript" &&
    (selectedNode.data.config.mode === "referenced_text" ||
      selectedNode.data.label.includes("文本生成") ||
      selectedNode.data.label.includes("剧本生成"));
  const hasSelectedNode = Boolean(selectedNodeId);
  const shouldShowComposer = Boolean(selectedNodeId && selectedNode?.type !== "videoStitcher");
  const selectedComposerPrompt = useMemo(() => {
    if (!selectedNode) return "";
    const config = selectedNode.data.config;
    const rawUserPrompt = typeof config.userPrompt === "string" ? config.userPrompt.trim() : "";
    if (rawUserPrompt) return rawUserPrompt;
    const rawPrompt = typeof config.prompt === "string" ? config.prompt.trim() : "";
    if (selectedNode.type === "sceneAsset" && rawPrompt) return rawPrompt;
    const spec = config.generationSpec;
    if (
      selectedNode.type === "videoGeneration" &&
      spec &&
      typeof spec === "object" &&
      "intent_summary" in spec
    ) {
      return String((spec as { intent_summary?: unknown }).intent_summary || "").trim();
    }
    return "";
  }, [selectedNode]);
  const rawSelectedUpstreamContext = useMemo(() => {
    if (!selectedNodeId) return { references: [], scripts: [], summaries: [] };
    return collectUpstreamContext(nodes, edges, selectedNodeId);
  }, [edges, nodes, selectedNodeId]);
  const selectedUpstreamContext = useMemo(() => {
    if (!selectedNodeId) return rawSelectedUpstreamContext;
    const excluded = new Set(excludedReferencesByNode[selectedNodeId] ?? []);
    return {
      ...rawSelectedUpstreamContext,
      references: rawSelectedUpstreamContext.references.filter((item) => !excluded.has(referenceKey(item))),
    };
  }, [excludedReferencesByNode, rawSelectedUpstreamContext, selectedNodeId]);
  const composerReference = useMemo(() => {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return null;
    const excluded = new Set(selectedNodeId ? excludedReferencesByNode[selectedNodeId] ?? [] : []);
    const upstreamReferences = rawSelectedUpstreamContext.references;
    const selfReferences = getReferencesFromNode(selectedNode);
    const rawItems = upstreamReferences.length > 0 ? upstreamReferences : selfReferences;
    const items = rawItems.filter((item) => !excluded.has(referenceKey(item)));
    return rawItems.length > 0 ? { items, count: items.length, totalCount: rawItems.length } : null;
  }, [excludedReferencesByNode, nodes, rawSelectedUpstreamContext.references, selectedNodeId]);
  const flowId = useFlowStore((state) => state.flowId);
  const markVideoUploaded = useFlowStore((state) => state.markVideoUploaded);
  const replaceVideoUploadNode = useFlowStore((state) => state.replaceVideoUploadNode);

  const removeComposerReference = useCallback(
    (item: ComposerReferenceItem) => {
      if (!selectedNodeId) return;
      const key = referenceKey(item);
      setExcludedReferencesByNode((current) => {
        const existing = current[selectedNodeId] ?? [];
        if (existing.includes(key)) return current;
        return { ...current, [selectedNodeId]: [...existing, key] };
      });
    },
    [selectedNodeId]
  );

  useEffect(() => {
    const videoObjectUrls = videoObjectUrlsRef.current;
    const imageObjectUrls = imageObjectUrlsRef.current;
    return () => {
      videoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const handleReplaceVideo = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (!nodeId) return;
      pendingReplaceNodeIdRef.current = nodeId;
      pendingUploadPositionRef.current = null;
      closeAssetMenu();
      inputRef.current?.click();
    };

    window.addEventListener("nodelist:replace-video", handleReplaceVideo);
    return () => window.removeEventListener("nodelist:replace-video", handleReplaceVideo);
  }, []);

  useEffect(() => {
    const handleAppendImages = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (!nodeId) return;
      pendingImageAppendNodeIdRef.current = nodeId;
      pendingImageUploadPositionRef.current = null;
      closeAssetMenu();
      imageInputRef.current?.click();
    };

    window.addEventListener("nodelist:add-images-to-node", handleAppendImages);
    return () => window.removeEventListener("nodelist:add-images-to-node", handleAppendImages);
  }, []);

  useEffect(() => {
    let active = true;
    void listImageModels()
      .then((result) => {
        if (!active) return;
        const nextModels = result.models.length ? result.models : fallbackImageModels;
        setImageModels(nextModels);
        setSelectedImageModel(result.default || nextModels[0]?.model || "gpt-image-2");
      })
      .catch(() => {
        if (!active) return;
        setImageModels(fallbackImageModels);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void listVideoModels()
      .then((result) => {
        if (!active) return;
        const nextModels = result.models.length ? result.models : fallbackVideoModels;
        setVideoModels(nextModels);
        setSelectedVideoModel(result.default || nextModels[0]?.model || "doubao-seedance-1-5-pro-251215");
      })
      .catch(() => {
        if (!active) return;
        setVideoModels(fallbackVideoModels);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldShowComposer) setAgentCollapsed(false);
  }, [shouldShowComposer]);

  useEffect(() => {
    if (!isImageGenerationNode) return;
    const nodeModel = typeof selectedNode?.data.config.model === "string" ? selectedNode.data.config.model : "";
    if (nodeModel) setSelectedImageModel(nodeModel);
  }, [isImageGenerationNode, selectedNode]);

  useEffect(() => {
    if (!isVideoGenerationNode) return;
    const nodeModel = typeof selectedNode?.data.config.model === "string" ? selectedNode.data.config.model : "";
    if (nodeModel) setSelectedVideoModel(nodeModel);
  }, [isVideoGenerationNode, selectedNode]);

  const handleSelectImageModel = (model: string) => {
    setSelectedImageModel(model);
    if (selectedNodeId && isImageGenerationNode) {
      updateNodeConfig(selectedNodeId, { model });
    }
  };

  const handleSelectVideoModel = (model: string) => {
    setSelectedVideoModel(model);
    if (selectedNodeId && isVideoGenerationNode) {
      updateNodeConfig(selectedNodeId, { model });
    }
  };

  const closeAssetMenu = () => setAssetMenu(null);
  const closeNextStepMenu = () => setNextStepMenu(null);

  const handleCanvasContextMenu = (event: CanvasContextMenuEvent, flowPosition: XYPosition) => {
    event.preventDefault();
    const menuWidth = 246;
    const menuHeight = 256;
    const gutter = 16;
    setAssetMenu({
      screenPosition: {
        x: Math.min(event.clientX, window.innerWidth - menuWidth - gutter),
        y: Math.min(event.clientY, window.innerHeight - menuHeight - gutter),
      },
      flowPosition,
    });
  };

  const handleFloatingAddMenu = (event: ReactMouseEvent<HTMLButtonElement>, flowPosition: XYPosition) => {
    const menuWidth = 246;
    const menuHeight = 256;
    const gutter = 16;
    const rect = event.currentTarget.getBoundingClientRect();
    closeNextStepMenu();
    setAssetMenu({
      screenPosition: {
        x: Math.max(gutter, Math.min(rect.left - menuWidth - 14, window.innerWidth - menuWidth - gutter)),
        y: Math.max(gutter, Math.min(rect.top - 12, window.innerHeight - menuHeight - gutter)),
      },
      flowPosition,
    });
  };

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if ((!assetMenu && !nextStepMenu) || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-asset-context-menu]")) return;
    if (target.closest("[data-next-step-menu]")) return;
    closeAssetMenu();
    closeNextStepMenu();
  };

  const handleLooseConnectEnd = ({
    sourceNodeId,
    screenPosition,
    flowPosition,
  }: {
    sourceNodeId: string;
    screenPosition: XYPosition;
    flowPosition: XYPosition;
  }) => {
    const menuWidth = 196;
    const menuHeight = 154;
    const gutter = 16;
    ignoreNextPaneClickRef.current = true;
    closeAssetMenu();
    setNextStepMenu({
      sourceNodeId,
      screenPosition: {
        x: Math.min(screenPosition.x, window.innerWidth - menuWidth - gutter),
        y: Math.min(screenPosition.y, window.innerHeight - menuHeight - gutter),
      },
      flowPosition,
    });
  };

  const handlePickNextStep = (kind: "text" | "image" | "video") => {
    if (!nextStepMenu) return;
    addReferencedNode(nextStepMenu.sourceNodeId, kind, nextStepMenu.flowPosition);
    closeNextStepMenu();
  };

  const handleVideo = (file?: File) => {
    if (!file) return;
    const videoUrl = URL.createObjectURL(file);
    videoObjectUrlsRef.current.push(videoUrl);
    if (pendingReplaceNodeIdRef.current) {
      replaceVideoUploadNode(pendingReplaceNodeIdRef.current, file.name, videoUrl, file);
    } else if (pendingUploadPositionRef.current) {
      addVideoUploadNode(file.name, pendingUploadPositionRef.current, videoUrl, file);
    } else {
      markVideoUploaded(file.name, videoUrl, file);
    }
    pendingReplaceNodeIdRef.current = null;
    pendingUploadPositionRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    closeAssetMenu();
  };

  const imageItemId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const uploadImagesForNode = (nodeId: string, entries: Array<{ item: ImageAssetItem; file: File }>) => {
    entries.forEach(({ item, file }) => {
      void uploadAsset({
        file,
        kind: "image",
        flowId,
        nodeId,
        title: file.name,
        tag: item.tag,
      })
        .then((asset) => {
          updateImageAsset(nodeId, item.id, {
            assetId: asset.id,
            name: asset.title || item.name,
            url: resolveMediaUrl(asset.previewUrl || asset.publicUrl || asset.url),
            storageKey: asset.storageKey,
            uploadStatus: "saved",
          });
        })
        .catch((error) => {
          updateImageAsset(nodeId, item.id, {
            uploadStatus: "failed",
            error: error instanceof Error ? error.message : "上传失败",
          });
        });
    });
  };

  const handleImage = (fileList?: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    const entries = files.map((file) => {
      const url = URL.createObjectURL(file);
      imageObjectUrlsRef.current.push(url);
      return {
        file,
        item: {
          id: imageItemId(),
          name: file.name,
          url,
          tag: "reference",
          uploadStatus: "uploading",
        } satisfies ImageAssetItem,
      };
    });

    if (pendingImageAppendNodeIdRef.current) {
      const nodeId = pendingImageAppendNodeIdRef.current;
      appendImagesToNode(nodeId, entries.map(({ item }) => item));
      uploadImagesForNode(nodeId, entries);
    } else if (pendingImageUploadPositionRef.current) {
      const nodeId = addImageUploadNode(entries.map(({ item }) => item), pendingImageUploadPositionRef.current);
      uploadImagesForNode(nodeId, entries);
    }

    pendingImageAppendNodeIdRef.current = null;
    pendingImageUploadPositionRef.current = null;
    if (imageInputRef.current) imageInputRef.current.value = "";
    closeAssetMenu();
  };

  const openVideoPicker = (position?: XYPosition) => {
    pendingReplaceNodeIdRef.current = null;
    pendingUploadPositionRef.current = position ?? null;
    closeAssetMenu();
    inputRef.current?.click();
  };

  const openImagePicker = (position: XYPosition) => {
    pendingImageAppendNodeIdRef.current = null;
    pendingImageUploadPositionRef.current = position;
    closeAssetMenu();
    imageInputRef.current?.click();
  };

  const addVideoStitcherAt = (position: XYPosition) => {
    addVideoStitcherNode(position);
    closeAssetMenu();
  };

  const handleGenerateImage = async (prompt: string, options: ImageGenerateOptions = {}) => {
    if (!selectedNode || !isImageGenerationNode || activeGenerationNodeIds.has(selectedNode.id)) return;
    const nodeId = selectedNode.id;
    const referenceItems = selectedUpstreamContext.references.length > 0 ? selectedUpstreamContext.references : composerReference?.items ?? [];
    const upstreamContext = { ...selectedUpstreamContext, references: referenceItems };
    const references = referenceItems
      .filter((item) => item.kind === "image")
      .map((item) => item.url);
    const userPrompt = prompt.trim();
    const settingPrompt = options.settingPrompt?.trim() ?? "";
    const promptForGeneration = [
      userPrompt || settingPrompt,
      settingPrompt && userPrompt
        ? `生成类型参考：${settingPrompt}\n注意：用户原始要求优先；如果用户要求合并两个角色、多人同框或改变构图，不要被预设中的“同一人物/单人物”限制覆盖。`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const finalPrompt = buildImagePromptWithUpstream(promptForGeneration, upstreamContext, imageParams);

    setActiveGenerationNodeIds((current) => new Set(current).add(nodeId));
    try {
      await runImageGeneration(nodeId, {
        prompt: finalPrompt,
        user_prompt: userPrompt,
        setting_prompt: settingPrompt,
        setting_label: options.settingLabel ?? "",
        asset_tag: options.settingLabel
          ? settingAssetTag(options.settingLabel)
          : settingAssetTag(String(selectedNode.data.config.assetTag || "")),
        model: selectedImageModel,
        ratio: imageParams.ratio,
        resolution: imageParams.resolution,
        quality: imageParams.quality,
        count: imageParams.count,
        reference_images: references,
        flowId,
        nodeId,
      });
    } finally {
      setActiveGenerationNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleGenerateVideo = async (prompt: string) => {
    if (!selectedNode || !isVideoGenerationNode || activeGenerationNodeIds.has(selectedNode.id)) return;
    const nodeId = selectedNode.id;
    const overwriteCurrent = selectedNode.data.status === "done";
    const upstreamContext = selectedUpstreamContext;
    const references = upstreamContext.references
      .filter((item) => item.kind === "image")
      .map((item) => item.url) ?? [];
    const normalizedVideoParams = {
      ...videoParams,
      ratio: videoParams.ratio === "Auto" ? "9:16" : videoParams.ratio,
    };
    updateNodeData(nodeId, {
      status: "running",
      metric: "解析视频生成要求",
      config: {
        model: selectedVideoModel,
        ratio: normalizedVideoParams.ratio,
        resolution: normalizedVideoParams.resolution,
        seconds: normalizedVideoParams.seconds,
        generate_audio: normalizedVideoParams.generate_audio,
        camerafixed: normalizedVideoParams.camerafixed,
        prompt: prompt.trim(),
        referenceImages: references,
        referenceImageCount: references.length,
        taskId: "",
        error: "",
      },
      items: [
        "正在整理上游剧本 / 参考图",
        references.length ? `参考图片 ${references.length} 张` : "引用上游素材",
        `${normalizedVideoParams.seconds}s / ${normalizedVideoParams.ratio} · ${normalizedVideoParams.resolution}`,
      ],
    });
    const fallbackPrompt =
      selectedVideoModel === "bds-pro"
        ? buildBdsVideoPromptWithUpstream(prompt, upstreamContext, normalizedVideoParams)
        : buildVideoPromptWithUpstream(prompt, upstreamContext, normalizedVideoParams);
    const referenceUsageText = imageReferenceUsageText(upstreamContext);
    const videoSpecSummaries = referenceUsageText
      ? [
          ...upstreamContext.summaries.map((item) => ({ label: item.label, text: item.text })),
          { label: "参考图用途标签", text: referenceUsageText },
        ]
      : upstreamContext.summaries.map((item) => ({ label: item.label, text: item.text }));
    let generationSpec: VideoGenerationSpec = {
      model: selectedVideoModel,
      target_shots: requestedShotNumbers(prompt),
      intent_summary: compactForModel(prompt.trim() || "基于上游素材生成短视频", 120),
      selected_script: "",
      generation_prompt: fallbackPrompt,
      negative_prompt: "blurry, out of focus, watermark, text, logo",
      items: [
        references.length ? `参考图片：${references.length}张` : "引用上游素材",
        `${normalizedVideoParams.seconds}s / ${normalizedVideoParams.ratio} · ${normalizedVideoParams.resolution}`,
      ],
      fallback: true,
    };

    setActiveGenerationNodeIds((current) => new Set(current).add(nodeId));
    try {
      try {
        generationSpec = await createVideoGenerationSpec({
          user_prompt: prompt,
          model: selectedVideoModel,
          params: {
            ratio: normalizedVideoParams.ratio,
            resolution: normalizedVideoParams.resolution,
            seconds: normalizedVideoParams.seconds,
            generate_audio: normalizedVideoParams.generate_audio,
            camerafixed: normalizedVideoParams.camerafixed,
          },
          scripts: upstreamContext.scripts.map((item) => ({ label: item.label, text: item.text })),
          summaries: videoSpecSummaries,
          reference_image_count: references.length,
        });
      } catch (error) {
        console.warn("Video generation spec fallback:", error);
      }

      await runSeedanceGeneration(nodeId, {
        prompt: generationSpec.generation_prompt || fallbackPrompt,
        user_prompt: prompt.trim(),
        model: selectedVideoModel,
        ratio: normalizedVideoParams.ratio,
        resolution: normalizedVideoParams.resolution,
        seconds: normalizedVideoParams.seconds,
        generate_audio: normalizedVideoParams.generate_audio,
        watermark: false,
        camerafixed: normalizedVideoParams.camerafixed,
        reference_images: references,
        generation_spec: generationSpec,
        overwrite_current: overwriteCurrent,
      });
    } finally {
      setActiveGenerationNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleGenerateText = async (prompt: string) => {
    if (!selectedNode || !isTextGenerationNode || activeGenerationNodeIds.has(selectedNode.id)) return;
    const nodeId = selectedNode.id;
    if (!prompt.trim()) {
      await runTextGeneration(nodeId, "");
      return;
    }
    setActiveGenerationNodeIds((current) => new Set(current).add(nodeId));
    try {
      await runTextGeneration(nodeId, prompt);
    } finally {
      setActiveGenerationNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  };

  return (
    <FlowProvider>
      <main
        className="relative h-screen w-screen overflow-hidden bg-[#030306] text-zinc-100"
        onPointerDownCapture={handlePointerDownCapture}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(event) => handleVideo(event.target.files?.[0])}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => handleImage(event.target.files)}
        />
        <FlowCanvas
          onPaneContextMenu={handleCanvasContextMenu}
          onPaneClick={() => {
            if (ignoreNextPaneClickRef.current) {
              ignoreNextPaneClickRef.current = false;
              return;
            }
            closeAssetMenu();
            closeNextStepMenu();
          }}
          onLooseConnectEnd={handleLooseConnectEnd}
        />
        <TopBar />
        <AssetPanel
          collapsed={assetPanelCollapsed}
          onToggle={() => setAssetPanelCollapsed((value) => !value)}
          imageModels={imageModels}
          videoModels={videoModels}
          selectedImageModel={selectedImageModel}
          selectedVideoModel={selectedVideoModel}
        />
        <FloatingTools
          assetPanelCollapsed={assetPanelCollapsed}
          onOpenAddMenu={handleFloatingAddMenu}
        />
        {assetMenu && (
          <AddAssetMenu
            position={assetMenu.screenPosition}
            onPickVideo={() => openVideoPicker(assetMenu.flowPosition)}
            onPickImage={() => openImagePicker(assetMenu.flowPosition)}
            onAddVideoStitcher={() => addVideoStitcherAt(assetMenu.flowPosition)}
          />
        )}
        {nextStepMenu && (
          <NextStepMenu
            position={nextStepMenu.screenPosition}
            onPick={handlePickNextStep}
          />
        )}
        {shouldShowComposer && (
          <Composer
            collapsed={agentCollapsed}
            onPickVideo={() => openVideoPicker()}
            reference={composerReference}
            upstreamScriptCount={selectedUpstreamContext.scripts.length}
            imageModels={imageModels}
            videoModels={videoModels}
            selectedImageModel={selectedImageModel}
            selectedVideoModel={selectedVideoModel}
            imageParams={imageParams}
            videoParams={videoParams}
            initialPrompt={selectedComposerPrompt}
            isImageGenerationNode={isImageGenerationNode}
            isVideoGenerationNode={isVideoGenerationNode}
            isTextGenerationNode={isTextGenerationNode}
            generatingImage={isImageGenerationNode && selectedNodeGenerating}
            generatingVideo={isVideoGenerationNode && selectedNodeGenerating}
            generatingText={isTextGenerationNode && selectedNodeGenerating}
            onRemoveReference={removeComposerReference}
            onSelectImageModel={handleSelectImageModel}
            onSelectVideoModel={handleSelectVideoModel}
            onChangeImageParams={setImageParams}
            onChangeVideoParams={setVideoParams}
            onGenerateImage={handleGenerateImage}
            onGenerateVideo={handleGenerateVideo}
            onGenerateText={handleGenerateText}
          />
        )}
      </main>
    </FlowProvider>
  );
}

export default function Home() {
  const router = useRouter();
  const { hydrate, hydrated, token } = useAuthStore();
  const loadFlow = useFlowStore((state) => state.loadFlow);
  const [studioRequested, setStudioRequested] = useState(false);
  const [initialAuthMode, setInitialAuthMode] = useState<"login" | "register" | null>(null);

  const boot = useMemo(
    () => async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedFlowId = params.get("flow");
      if (requestedFlowId) {
        await loadFlow(requestedFlowId);
      } else {
        router.replace("/projects");
        return;
      }
    },
    [loadFlow, router]
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStudioRequested(params.get("studio") === "1");
    const authMode = params.get("auth");
    setInitialAuthMode(authMode === "login" || authMode === "register" ? authMode : null);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!studioRequested) return;
    if (!token) return;
    void boot();
  }, [boot, hydrated, studioRequested, token]);

  if (!hydrated) return null;
  if (!studioRequested || !token) {
    return (
      <HomeLanding
        isAuthenticated={Boolean(token)}
        authRequired={studioRequested && !token}
        initialAuthMode={initialAuthMode}
      />
    );
  }

  return <StudioShell />;
}
