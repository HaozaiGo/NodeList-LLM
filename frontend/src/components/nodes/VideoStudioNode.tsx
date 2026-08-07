"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import {
  Boxes,
  BrainCircuit,
  Building2,
  ChevronRight,
  Clapperboard,
  Check,
  Clock3,
  Copy,
  Film,
  FileVideo,
  Image,
  ImagePlus,
  Captions,
  Library,
  MapPin,
  MessageSquareText,
  Music2,
  PackageCheck,
  Pencil,
  Play,
  Save,
  Scissors,
  SunMedium,
  X,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import type { ImageAssetItem, ImageAssetTag, NodeData, NodeType, StudioNodeStatus } from "@/types/flow";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";
import { downloadGeneratedVideo, resolveMediaUrl, type VideoGeneratePayload } from "@/lib/api";

const iconMap: Partial<Record<NodeType, React.ComponentType<{ className?: string }>>> = {
  videoUpload: FileVideo,
  imageUpload: Image,
  doubaoAnalysis: BrainCircuit,
  storyboardScript: Clapperboard,
  characterAsset: UserRound,
  sceneAsset: Image,
  propAsset: PackageCheck,
  videoGeneration: Sparkles,
  videoStitcher: Film,
  timeline: Clock3,
};

const statusLabel: Record<StudioNodeStatus, string> = {
  idle: "Idle",
  ready: "Ready",
  running: "生成中",
  done: "完成",
  queued: "排队中",
  error: "失败",
};

const statusClass: Record<StudioNodeStatus, string> = {
  idle: "border-white/10 bg-white/5 text-zinc-400",
  ready: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  running: "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100",
  done: "border-emerald-300/35 bg-emerald-400/15 text-emerald-100",
  queued: "border-amber-300/35 bg-amber-400/15 text-amber-100",
  error: "border-rose-300/40 bg-rose-500/15 text-rose-100",
};

const imageTagLabel: Record<ImageAssetTag, string> = {
  reference: "参考图",
  character: "人物",
  scene: "场景",
  prop: "道具",
};

const imageTagOptions = Object.entries(imageTagLabel) as Array<[ImageAssetTag, string]>;
type GeneratedAssetTag = Exclude<ImageAssetTag, "reference">;

const generatedAssetOptions: Array<{
  value: GeneratedAssetTag;
  label: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    value: "character",
    label: "人物资产",
    title: "人物资产",
    description: "生成主角形象并锁定一致性。",
    icon: UserRound,
  },
  {
    value: "scene",
    label: "场景资产",
    title: "场景资产",
    description: "生成咖啡馆夜景、街道雨景等场景图。",
    icon: Image,
  },
  {
    value: "prop",
    label: "道具与品牌物料",
    title: "道具与品牌物料",
    description: "生成杯子、鞋款、Logo、包装等关键道具。",
    icon: PackageCheck,
  },
];

function generatedAssetOption(value: unknown) {
  return generatedAssetOptions.find((option) => option.value === value) ?? generatedAssetOptions[1];
}

interface AnalysisReport {
  title: string;
  description: string;
  narrative: Record<string, string>;
  timing: Record<string, string>;
  camera: Record<string, string>;
  visual: Record<string, string>;
  audio: Record<string, string>;
  cta: string;
}

interface SegmentReport {
  id: string;
  start: string;
  end: string;
  summary: string;
}

type ReplacementKind = "character" | "scene" | "prop";

interface ReplacementAsset {
  id: string;
  kind: ReplacementKind;
  label: string;
}

interface GenerationParams {
  ratio: string;
  resolution: string;
  seconds: number;
  generate_audio: boolean;
  watermark: boolean;
  camerafixed: boolean;
}

const generationRatios = ["9:16", "16:9", "1:1", "3:4", "4:3", "21:9"];
const generationResolutions = ["720p", "1080p", "480p"];
const generationSeconds = [4, 6, 8, 10, 12];

function displayNodeLabel(label: string) {
  return label === "豆包视频分析" ? "视频分析" : label;
}

function displayStudioNodeTitle(label: string, nodeType: NodeType, config: Record<string, unknown>) {
  if (
    nodeType === "storyboardScript" &&
    (config.mode === "referenced_text" || label === "文本生成")
  ) {
    return "剧本生成";
  }
  return displayNodeLabel(label);
}

function displayNodeStatus(nodeData: NodeData): StudioNodeStatus {
  const status = nodeData.status ?? "idle";
  if (status === "running" || status === "queued" || status === "done") return status;
  const config = asRecord(nodeData.config);
  const metric = typeof nodeData.metric === "string" ? nodeData.metric : "";
  const items = nodeData.items ?? [];
  const failed =
    config.generationStatus === "failed" ||
    config.status === "failed" ||
    Boolean(config.error) ||
    metric.includes("失败") ||
    items.some((item) => item.includes("失败"));
  return failed ? "error" : status;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getImageItems(config: Record<string, unknown>): ImageAssetItem[] {
  if (Array.isArray(config.images)) {
    return config.images.filter((item): item is ImageAssetItem => Boolean(item && typeof item === "object"));
  }
  const imageUrl = typeof config.imageUrl === "string" ? config.imageUrl : "";
  const fileName = typeof config.fileName === "string" ? config.fileName : "图片";
  return imageUrl
    ? [{ id: "legacy-image", name: fileName, url: imageUrl, tag: "reference", uploadStatus: "saved" }]
    : [];
}

function getPrimaryImage(images: ImageAssetItem[], primaryImageId: unknown) {
  return images.find((image) => image.id === primaryImageId) ?? images[0] ?? null;
}

function imageDisplayUrl(image: ImageAssetItem | null) {
  if (!image) return "";
  if (image.assetId) return resolveMediaUrl(`/api/assets/${image.assetId}/public-content`);
  return resolveMediaUrl(image.url);
}

type StitcherClip = {
  id: string;
  sourceNodeId: string;
  title: string;
  url: string;
  metric: string;
};

function nodeVideoUrl(node: Node<NodeData>) {
  const config = node.data.config;
  const rawVideoUrl = typeof config.videoUrl === "string" ? config.videoUrl : "";
  const assetId = typeof config.assetId === "string" ? config.assetId : "";
  const projectVideoAssetId = typeof config.projectVideoAssetId === "string" ? config.projectVideoAssetId : "";
  const taskId = typeof config.taskId === "string" ? config.taskId : "";
  const playbackAssetId = assetId || projectVideoAssetId;
  if (playbackAssetId) return resolveMediaUrl(`/api/assets/${playbackAssetId}/public-content`);
  if (node.type === "videoGeneration" && taskId && (!rawVideoUrl || rawVideoUrl.startsWith("blob:"))) {
    return resolveMediaUrl(`/api/video/generate/${encodeURIComponent(taskId)}/content`);
  }
  return resolveMediaUrl(rawVideoUrl);
}

function nodeVideoTitle(node: Node<NodeData>, index: number) {
  const config = node.data.config;
  const fileName = typeof config.fileName === "string" ? config.fileName.trim() : "";
  if (fileName) return fileName;
  return `${displayStudioNodeTitle(node.data.label, node.type as NodeType, config)} ${index + 1}`;
}

function collectStitcherClips(
  nodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  clipOrderValue: unknown
): StitcherClip[] {
  const directSourceIds = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => edge.source);
  const seen = new Set<string>();
  const clips = directSourceIds
    .map((sourceNodeId, index) => {
      if (seen.has(sourceNodeId)) return null;
      seen.add(sourceNodeId);
      const sourceNode = nodes.find((node) => node.id === sourceNodeId);
      if (!sourceNode || !["videoUpload", "videoGeneration"].includes(String(sourceNode.type))) return null;
      const url = nodeVideoUrl(sourceNode);
      if (!url) return null;
      return {
        id: sourceNodeId,
        sourceNodeId,
        title: nodeVideoTitle(sourceNode, index),
        url,
        metric: typeof sourceNode.data.metric === "string" ? sourceNode.data.metric : "",
      };
    })
    .filter((clip): clip is StitcherClip => Boolean(clip));

  const clipOrder = Array.isArray(clipOrderValue)
    ? clipOrderValue.map((item) => String(item))
    : [];
  const orderIndex = new Map(clipOrder.map((id, index) => [id, index]));
  return [...clips].sort((a, b) => {
    const aIndex = orderIndex.has(a.sourceNodeId) ? orderIndex.get(a.sourceNodeId)! : Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.has(b.sourceNodeId) ? orderIndex.get(b.sourceNodeId)! : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return directSourceIds.indexOf(a.sourceNodeId) - directSourceIds.indexOf(b.sourceNodeId);
  });
}

function parseJsonishRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};

  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [cleaned];
  const segmentsIndex = cleaned.indexOf('"segments"');
  if (segmentsIndex > 0) {
    const prefix = cleaned.slice(0, segmentsIndex).trimEnd().replace(/,\s*$/, "");
    candidates.push(`${prefix}\n}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "string") return parseJsonishRecord(parsed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }

  return {};
}

function textValue(value: unknown, fallback = "待补充") {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}`;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function timeValue(value: unknown, fallback = "待补充") {
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(1)}s`;
  return textValue(value, fallback);
}

function listText(value: unknown, fallback = "待补充") {
  if (!Array.isArray(value)) return fallback;
  const text = value.map((item) => textValue(item, "")).filter(Boolean).join("、");
  return text || fallback;
}

function splitEntityText(value: unknown) {
  const text = textValue(value, "")
    .replace(/\d+\s*个/g, "")
    .replace(/主要人物\/角色线索/g, "")
    .replace(/主要人物/g, "")
    .replace(/已识别/g, "")
    .trim();
  if (!text) return [];
  return text
    .split(/[、,，/；;]|\s和\s|\s与\s/)
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 18)
    .slice(0, 4);
}

function makeFallbackAssets(kind: ReplacementKind, countValue: unknown, fallback: string) {
  const count = Math.max(0, Math.min(Number(countValue) || 0, 4));
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index + 1}`,
    kind,
    label: count === 1 ? fallback : `${fallback} ${index + 1}`,
  }));
}

function getReplacementAssets(
  report: AnalysisReport,
  config: Record<string, unknown>,
  items: string[]
): Record<ReplacementKind, ReplacementAsset[]> {
  const characterLabels = splitEntityText(report.narrative.character);
  const sceneLabels = splitEntityText(report.narrative.scene).length
    ? splitEntityText(report.narrative.scene)
    : Array.isArray(config.scenes)
      ? config.scenes.map((item) => textValue(item, "")).filter(Boolean).slice(0, 4)
      : [];
  const propLabels = splitEntityText(asRecord(config.raw).props).length
    ? splitEntityText(asRecord(config.raw).props)
    : items
        .map((item) => item.replace(/^关键道具[:：]\s*/, "").trim())
        .filter((item) => item && !item.includes("镜头") && !item.includes("人物") && !item.includes("场景"))
        .slice(0, 4);

  const toAssets = (kind: ReplacementKind, labels: string[]) =>
    labels.map((label, index) => ({ id: `${kind}-${index + 1}`, kind, label }));

  return {
    character: toAssets("character", characterLabels).length
      ? toAssets("character", characterLabels)
      : makeFallbackAssets("character", config.characters, "主要角色"),
    scene: toAssets("scene", sceneLabels).length
      ? toAssets("scene", sceneLabels)
      : makeFallbackAssets("scene", config.scenes ? 1 : 0, "主要场景"),
    prop: toAssets("prop", propLabels).length
      ? toAssets("prop", propLabels)
      : makeFallbackAssets("prop", config.props, "关键元素"),
  };
}

function buildGenerationPrompt(
  report: AnalysisReport,
  customizeText: string,
  params: GenerationParams,
  replacedCount: number,
  totalCount: number
) {
  const requirements = customizeText.trim() || "保持原视频叙事结构，生成同风格替换版视频";
  return [
    `请生成一段 ${params.ratio}、${params.resolution}、${params.seconds} 秒的短视频。`,
    `原视频主题：${report.title}。${report.description}`,
    `场景：${report.narrative.scene}`,
    `角色：${report.narrative.character}`,
    `对白/口播：${report.narrative.dialogue}`,
    `镜头：${report.camera.shot_size}；${report.camera.composition}；${report.camera.movement}`,
    `视觉：${report.visual.lighting}；${report.visual.color}；${report.visual.editing}`,
    `声音：${report.audio.music}；${report.audio.dialogue_function}`,
    `替换要求：${requirements}`,
    `已替换素材：${replacedCount}/${totalCount || 1}。请保持原画面节奏、剧情逻辑和商业短视频质感。`,
  ].join("\n");
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, textValue(entry)])
  );
}

function audioDiagnostic(config: Record<string, unknown>) {
  const transcript = asRecord(config.transcript);
  const status = textValue(transcript.status, "");
  const error = textValue(transcript.error, "");
  const text = textValue(transcript.text, "");
  if (text) return "";
  if (status === "failed") return `检测到音轨，但 ASR 转写失败：${error || "未知错误"}`;
  if (status === "ready") return "检测到音轨，但未获得转写文本";
  return "";
}

function applyAudioDiagnostic(report: AnalysisReport, config: Record<string, unknown>) {
  const diagnostic = audioDiagnostic(config);
  if (!diagnostic) return report;

  const shouldReplace = (value: string | undefined) =>
    !value || value.includes("未从音频判断") || value.includes("无可用音频");

  return {
    ...report,
    audio: {
      ...report.audio,
      music: shouldReplace(report.audio.music) ? diagnostic : report.audio.music,
      dialogue_function: shouldReplace(report.audio.dialogue_function)
        ? diagnostic
        : report.audio.dialogue_function,
      shot_function: shouldReplace(report.audio.shot_function) ? diagnostic : report.audio.shot_function,
    },
  };
}

function getAnalysisReport(value: unknown, config: Record<string, unknown>, items: string[]): AnalysisReport | null {
  const parsedContent = parseJsonishRecord(config.content || config.summary);
  const report = asRecord(value);
  const parsedReport = asRecord(parsedContent.report);
  const mergedConfig = { ...config, ...parsedContent };
  const displayReport = Object.keys(report).length > 0 ? report : parsedReport;
  if (Object.keys(displayReport).length === 0) return fallbackAnalysisReport(mergedConfig, items);

  return applyAudioDiagnostic({
    title: textValue(displayReport.title, "镜头 1"),
    description: textValue(displayReport.description, "已完成视频结构拆解。"),
    narrative: stringRecord(displayReport.narrative),
    timing: stringRecord(displayReport.timing),
    camera: stringRecord(displayReport.camera),
    visual: stringRecord(displayReport.visual),
    audio: stringRecord(displayReport.audio),
    cta: textValue(displayReport.cta, "前往替换 & 定制"),
  }, mergedConfig);
}

function fallbackAnalysisReport(config: Record<string, unknown>, items: string[]): AnalysisReport | null {
  const hasAnalysis =
    Boolean(config.summary) ||
    Boolean(config.content) ||
    items.some((item) => item.includes("已识别") || item.includes("已识别"));
  if (!hasAnalysis) return null;

  const transcript = asRecord(config.transcript);
  const transcriptText = textValue(transcript.text, "未从音频判断");
  const scenes = listText(config.scenes, "已识别画面场景");
  const duration = timeValue(config.duration, "待补充");
  const summary = textValue(config.summary || config.content, "已完成视频结构拆解。");

  return applyAudioDiagnostic({
    title: "视频拆解报告",
    description: summary,
    narrative: {
      scene: scenes,
      character: `${textValue(config.characters, "已识别")} 个主要人物/角色线索`,
      dialogue: transcriptText,
    },
    timing: {
      duration,
      start: "00:00:00.000",
      end: duration,
    },
    camera: {
      shot_size: `${textValue(config.shots, "已识别")} 个镜头/片段线索`,
      composition: items[0] || "人物、场景和动作关系已识别",
      shot_type: "按分段关键帧综合判断",
      movement: "已根据时间顺序抽帧分析",
      focus: "主体与背景关系已识别",
    },
    visual: {
      lighting: items[1] || "光影与色调已识别",
      color: listText(config.scenes, "画面风格已识别"),
      quality: "基于上传视频关键帧分析",
      editing: "已按片段切分并汇总节奏",
    },
    audio: {
      music: transcriptText === "未从音频判断" ? "未从音频判断" : "检测到可用音频/口播线索",
      dialogue_function: transcriptText,
      shot_function: "结合画面与音频转写生成叙事判断",
    },
    cta: "前往替换 & 定制",
  }, config);
}

function getSegmentReports(value: unknown, fallbackValue: unknown, contentValue: unknown): SegmentReport[] {
  const parsedContent = parseJsonishRecord(contentValue);
  const source =
    Array.isArray(value) && value.length > 0
      ? value
      : Array.isArray(parsedContent.segments)
        ? parsedContent.segments
        : fallbackValue;
  if (!Array.isArray(source)) return [];
  return source.slice(0, 4).map((item, index) => {
    const record = asRecord(item);
    return {
      id: textValue(record.id, `S${index + 1}`),
      start: timeValue(record.start, ""),
      end: timeValue(record.end, ""),
      summary: textValue(record.summary, "已完成分段分析"),
    };
  });
}

function ReportRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  return (
    <div className="flex gap-2 text-[12px] leading-5 text-zinc-400">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-zinc-200" />
      <div>
        <span className="font-semibold text-zinc-200">{label}：</span>
        <span>{value || "待补充"}</span>
      </div>
    </div>
  );
}

function ReplacementSection({
  title,
  icon: Icon,
  assets,
  videoUrl,
  openMenuId,
  previews,
  assetSelections,
  onOpenMenu,
  onPickLocal,
  onPickAsset,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  assets: ReplacementAsset[];
  videoUrl: string;
  openMenuId: string | null;
  previews: Record<string, string>;
  assetSelections: Record<string, string>;
  onOpenMenu: (id: string | null) => void;
  onPickLocal: (id: string) => void;
  onPickAsset: (id: string) => void;
}) {
  if (assets.length === 0) return null;

  return (
    <section className="border-b border-white/8 pb-6 last:border-b-0">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Icon className="size-4 text-zinc-200" />
        <span>{title}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {assets.map((asset) => {
          const isOpen = openMenuId === asset.id;
          const previewUrl = previews[asset.id];
          const assetSelection = assetSelections[asset.id];
          const isReplaced = Boolean(previewUrl || assetSelection);
          return (
            <div key={asset.id} className="relative w-[136px] rounded-md bg-white/[0.07] p-3">
              <div className="mb-3 flex h-12 items-center">
                {previewUrl ? (
                  <img src={previewUrl} alt={asset.label} className="size-11 rounded-md object-cover" />
                ) : asset.kind === "character" && videoUrl ? (
                  <video
                    src={videoUrl}
                    className="size-11 rounded-md object-cover"
                    preload="metadata"
                    muted
                  />
                ) : (
                  <div className="flex size-11 items-center justify-center rounded-md bg-white/10 text-zinc-300">
                    {asset.kind === "scene" ? (
                      <Building2 className="size-5" />
                    ) : asset.kind === "prop" ? (
                      <PackageCheck className="size-5" />
                    ) : (
                      <UserRound className="size-5" />
                    )}
                  </div>
                )}
              </div>
              <p className="mb-3 line-clamp-2 min-h-8 text-[11px] font-semibold leading-4 text-white">
                {asset.label}
              </p>
              {isReplaced && (
                <p className="mb-2 truncate text-[10px] text-cyan-200">
                  {assetSelection || "已添加图片"}
                </p>
              )}
              <button
                className="h-9 w-full rounded-full bg-white/12 text-xs font-semibold text-white transition hover:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMenu(isOpen ? null : asset.id);
                }}
              >
                替换
              </button>

              {isOpen && (
                <div className="absolute left-3 top-[96px] z-20 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]/95 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                  <button
                    className="flex h-12 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-white transition hover:bg-white/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickLocal(asset.id);
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <ImagePlus className="size-4" />
                      添加图片
                    </span>
                    <ChevronRight className="size-4 text-zinc-500" />
                  </button>
                  <button
                    className="flex h-12 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-white transition hover:bg-white/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickAsset(asset.id);
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <Library className="size-4" />
                      资产
                    </span>
                    <ChevronRight className="size-4 text-zinc-500" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReplacementCustomizePanel({
  report,
  config,
  items,
  videoUrl,
  fileName,
  onClose,
  onGenerate,
}: {
  report: AnalysisReport;
  config: Record<string, unknown>;
  items: string[];
  videoUrl: string;
  fileName: string;
  onClose: () => void;
  onGenerate: (payload: VideoGeneratePayload) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingImageAssetId, setPendingImageAssetId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [assetSelections, setAssetSelections] = useState<Record<string, string>>({});
  const [paramsOpen, setParamsOpen] = useState(false);
  const [params, setParams] = useState<GenerationParams>({
    ratio: "9:16",
    resolution: "720p",
    seconds: 8,
    generate_audio: true,
    watermark: false,
    camerafixed: false,
  });
  const [customizeText, setCustomizeText] = useState(
    "把所有角色都换成「西方白人」长相，台词对白全部对应翻译成「英语」，保持画面和剧情都不变"
  );
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const assets = getReplacementAssets(report, config, items);
  const totalCount = assets.character.length + assets.scene.length + assets.prop.length;
  const replacedCount = new Set([
    ...Object.keys(previews),
    ...Object.keys(assetSelections),
  ]).size;

  const handlePickLocal = (assetId: string) => {
    setPendingImageAssetId(assetId);
    imageInputRef.current?.click();
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !pendingImageAssetId) return;
    const previewUrl = URL.createObjectURL(file);
    setPreviews((current) => ({ ...current, [pendingImageAssetId]: previewUrl }));
    setAssetSelections((current) => {
      const next = { ...current };
      delete next[pendingImageAssetId];
      return next;
    });
    setOpenMenuId(null);
    event.target.value = "";
  };

  const handlePickAsset = (assetId: string) => {
    setAssetSelections((current) => ({ ...current, [assetId]: "已选择资产库素材" }));
    setOpenMenuId(null);
  };

  const handleGenerate = () => {
    onGenerate({
      prompt: buildGenerationPrompt(report, customizeText, params, replacedCount, totalCount),
      model: "doubao-seedance-1-5-pro-251215",
      ratio: params.ratio,
      resolution: params.resolution,
      seconds: params.seconds,
      generate_audio: params.generate_audio,
      watermark: params.watermark,
      camerafixed: params.camerafixed,
    });
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-black/45 p-5 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="nodrag nopan flex h-full w-full max-w-[520px] flex-col rounded-[28px] border border-fuchsia-500/70 bg-[#0c0c0d]/96 p-5 text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.65)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-200">
              02. 上传替换与定制
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">替换 & 定制</h3>
            <p className="mt-1 max-w-[360px] truncate text-xs text-zinc-500">{fileName}</p>
          </div>
          <button
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="关闭替换定制"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-[24px] border border-white/10 bg-white/[0.025] p-5">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />
          <ReplacementSection
            title="角色"
            icon={UserRound}
            assets={assets.character}
            videoUrl={videoUrl}
            openMenuId={openMenuId}
            previews={previews}
            assetSelections={assetSelections}
            onOpenMenu={setOpenMenuId}
            onPickLocal={handlePickLocal}
            onPickAsset={handlePickAsset}
          />
          <ReplacementSection
            title="场景"
            icon={Building2}
            assets={assets.scene}
            videoUrl={videoUrl}
            openMenuId={openMenuId}
            previews={previews}
            assetSelections={assetSelections}
            onOpenMenu={setOpenMenuId}
            onPickLocal={handlePickLocal}
            onPickAsset={handlePickAsset}
          />
          <ReplacementSection
            title="元素"
            icon={PackageCheck}
            assets={assets.prop}
            videoUrl={videoUrl}
            openMenuId={openMenuId}
            previews={previews}
            assetSelections={assetSelections}
            onOpenMenu={setOpenMenuId}
            onPickLocal={handlePickLocal}
            onPickAsset={handlePickAsset}
          />

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-3">
            <textarea
              className="min-h-28 w-full resize-none bg-transparent text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
              value={customizeText}
              onChange={(event) => setCustomizeText(event.target.value)}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="relative">
                <button
                  className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    setParamsOpen((current) => !current);
                  }}
                >
                  {params.ratio} · {params.resolution}
                </button>
                {paramsOpen && (
                  <div className="absolute bottom-8 left-0 z-30 w-64 rounded-2xl border border-white/10 bg-[#101010]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                    <div className="mb-3">
                      <p className="mb-2 text-[11px] font-semibold text-zinc-400">画幅比例</p>
                      <div className="flex flex-wrap gap-1.5">
                        {generationRatios.map((ratio) => (
                          <button
                            key={ratio}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition",
                              params.ratio === ratio
                                ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                            )}
                            onClick={() => setParams((current) => ({ ...current, ratio }))}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-3">
                      <p className="mb-2 text-[11px] font-semibold text-zinc-400">清晰度</p>
                      <div className="flex gap-1.5">
                        {generationResolutions.map((resolution) => (
                          <button
                            key={resolution}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition",
                              params.resolution === resolution
                                ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                            )}
                            onClick={() => setParams((current) => ({ ...current, resolution }))}
                          >
                            {resolution}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-3">
                      <p className="mb-2 text-[11px] font-semibold text-zinc-400">时长</p>
                      <div className="flex flex-wrap gap-1.5">
                        {generationSeconds.map((seconds) => (
                          <button
                            key={seconds}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition",
                              params.seconds === seconds
                                ? "border-fuchsia-300/60 bg-fuchsia-300/15 text-fuchsia-100"
                                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                            )}
                            onClick={() => setParams((current) => ({ ...current, seconds }))}
                          >
                            {seconds}s
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300">
                      {[
                        ["generate_audio", "生成音频"],
                        ["watermark", "水印"],
                        ["camerafixed", "固定镜头"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(params[key as keyof GenerationParams])}
                            onChange={(event) =>
                              setParams((current) => ({ ...current, [key]: event.target.checked }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <span className="text-xs text-cyan-200">{replacedCount}/{totalCount || 1} 已替换</span>
              <button
                className="h-9 rounded-full bg-fuchsia-500 px-5 text-xs font-semibold text-white shadow-[0_12px_34px_rgba(236,72,153,0.34)] transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleGenerate}
              >
                生成｜{Math.max(1, totalCount * 4)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DoubaoReport({
  report,
  segments,
  videoUrl,
  fileName,
  count,
  onCustomize,
}: {
  report: AnalysisReport;
  segments: SegmentReport[];
  videoUrl: string;
  fileName: string;
  count: number;
  onCustomize: () => void;
}) {
  return (
    <div className="nodrag nopan mt-1 grid w-full grid-cols-[230px_1fr_180px_240px_240px] gap-8 pb-16">
      <div>
        <div className="relative mb-3 aspect-video overflow-hidden rounded-xl bg-zinc-900">
          {videoUrl ? (
            <video src={videoUrl} className="size-full object-cover" preload="metadata" />
          ) : (
            <div className="flex size-full items-center justify-center bg-white/[0.04]">
              <FileVideo className="size-8 text-zinc-600" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">
              <Play className="ml-0.5 size-4 fill-current" />
            </div>
          </div>
        </div>
        <h3 className="text-sm font-semibold text-white">{report.title}</h3>
        <p className="mt-2 text-[12px] leading-5 text-zinc-400">{report.description}</p>
        <p className="mt-2 truncate font-mono text-[10px] uppercase text-zinc-600">{fileName}</p>
        {segments.length > 0 && (
          <div className="mt-4 space-y-2">
            {segments.map((segment) => (
              <div key={segment.id} className="rounded-lg border border-white/8 bg-white/[0.035] p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-fuchsia-200">{segment.id}</span>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {segment.start}-{segment.end}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] leading-4 text-zinc-400">{segment.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white">叙事要素</h4>
        <ReportRow icon={MapPin} label="场景" value={report.narrative.scene} />
        <ReportRow icon={UserRound} label="角色" value={report.narrative.character} />
        <ReportRow icon={MessageSquareText} label="台词对白" value={report.narrative.dialogue} />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white">时间</h4>
        <ReportRow icon={Clock3} label="时长" value={report.timing.duration} />
        <ReportRow icon={Clock3} label="开始" value={report.timing.start} />
        <ReportRow icon={Clock3} label="结束" value={report.timing.end} />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white">镜头语言</h4>
        <ReportRow icon={Image} label="景别" value={report.camera.shot_size} />
        <ReportRow icon={Clapperboard} label="构图" value={report.camera.composition} />
        <ReportRow icon={FileVideo} label="镜头类型" value={report.camera.shot_type} />
        <ReportRow icon={Sparkles} label="运镜方法" value={report.camera.movement} />
        <ReportRow icon={BrainCircuit} label="焦距与景深" value={report.camera.focus} />
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white">影像处理</h4>
        <ReportRow icon={SunMedium} label="光影与色调" value={report.visual.lighting} />
        <ReportRow icon={WandSparkles} label="色彩" value={report.visual.color} />
        <ReportRow icon={Image} label="画质" value={report.visual.quality} />
        <ReportRow icon={Scissors} label="剪辑" value={report.visual.editing} />

        <h4 className="pt-2 text-sm font-semibold text-white">声音</h4>
        <ReportRow icon={Music2} label="音乐与音效" value={report.audio.music} />
        <ReportRow icon={Captions} label="分镜功能" value={report.audio.dialogue_function} />
        <ReportRow icon={Clapperboard} label="镜头叙事功能" value={report.audio.shot_function} />
      </div>

      <button
        className="absolute bottom-6 left-1/2 flex h-11 -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-500 px-10 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(236,72,153,0.35)] transition hover:bg-fuchsia-400"
        onClick={(event) => {
          event.stopPropagation();
          onCustomize();
        }}
      >
        前往替换 & 定制
        <span className="h-5 w-px bg-white/35" />
        <span>{count}</span>
      </button>
    </div>
  );
}

function ImageGroupPreview({
  images,
  primaryImage,
  onOpen,
}: {
  images: ImageAssetItem[];
  primaryImage: ImageAssetItem | null;
  onOpen: () => void;
}) {
  if (images.length === 0) return null;
  const visibleImages = images.length === 1 && primaryImage ? [primaryImage] : images.slice(0, 4);
  const hiddenCount = Math.max(0, images.length - visibleImages.length);

  return (
    <button
      className="nodrag nopan mb-3 block aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-cyan-300/45"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label="管理图片素材组"
    >
      <div className={cn("grid size-full gap-1", visibleImages.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
        {visibleImages.map((image, index) => (
          <div key={image.id} className="relative min-h-0 overflow-hidden bg-white/[0.04]">
            <img src={imageDisplayUrl(image)} alt={image.name} className="size-full object-cover" />
            {hiddenCount > 0 && index === visibleImages.length - 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/62 text-lg font-semibold text-white">
                +{hiddenCount}
              </div>
            )}
            {image.uploadStatus === "uploading" && (
              <div className="absolute bottom-1 left-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] text-cyan-100">
                上传中
              </div>
            )}
          </div>
        ))}
      </div>
    </button>
  );
}

function ImageManager({
  nodeId,
  images,
  primaryImageId,
  onClose,
}: {
  nodeId: string;
  images: ImageAssetItem[];
  primaryImageId: string;
  onClose: () => void;
}) {
  const removeImageFromNode = useFlowStore((state) => state.removeImageFromNode);
  const moveImageInNode = useFlowStore((state) => state.moveImageInNode);
  const setPrimaryImage = useFlowStore((state) => state.setPrimaryImage);
  const setImageTag = useFlowStore((state) => state.setImageTag);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[105] flex justify-end bg-black/60 p-5 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="nodrag nopan flex h-full w-full max-w-[620px] flex-col rounded-[28px] border border-cyan-300/25 bg-[#0d0d12]/96 p-5 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Image Asset Group
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">管理图片素材</h3>
              <p className="mt-1 text-xs text-zinc-500">{images.length} 张图片，可标记为人物、场景、道具或参考图。</p>
            </div>
            <button
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label="关闭图片管理"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <span className="text-xs text-zinc-400">继续追加素材，仍保留在同一个画布节点里。</span>
            <button
              className="rounded-full bg-cyan-400 px-4 py-2 text-xs font-semibold text-black transition hover:bg-cyan-300"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("nodelist:add-images-to-node", { detail: { nodeId } }));
                onClose();
              }}
            >
              继续添加图片
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-3">
            {images.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {images.map((image, index) => (
                  <div key={image.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                    <button
                      className="group relative mb-3 block aspect-video w-full overflow-hidden rounded-xl bg-black text-left"
                      onClick={() => setPreviewIndex(index)}
                      aria-label={`放大查看 ${image.name}`}
                    >
                      <img src={imageDisplayUrl(image)} alt={image.name} className="size-full object-cover transition group-hover:scale-[1.02]" />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-semibold text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                        点击放大
                      </span>
                      {primaryImageId === image.id && (
                        <span className="absolute left-2 top-2 rounded-full bg-cyan-300 px-2 py-1 text-[10px] font-semibold text-black">
                          主图
                        </span>
                      )}
                      {image.uploadStatus && image.uploadStatus !== "saved" && (
                        <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white">
                          {image.uploadStatus === "uploading" ? "上传 TOS 中" : image.error || "上传失败"}
                        </span>
                      )}
                    </button>
                    <p className="truncate text-xs font-semibold text-white">{image.name}</p>
                    <select
                      className="mt-3 h-9 w-full rounded-xl border border-white/10 bg-[#15151c] px-3 text-xs text-zinc-100 outline-none"
                      value={image.tag}
                      onChange={(event) => setImageTag(nodeId, image.id, event.target.value as ImageAssetTag)}
                    >
                      {imageTagOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <div className="mt-3 grid grid-cols-4 gap-1.5 text-[11px]">
                      <button
                        className="rounded-lg bg-white/[0.07] px-2 py-2 text-zinc-200 transition hover:bg-white/12"
                        onClick={() => setPrimaryImage(nodeId, image.id)}
                      >
                        主图
                      </button>
                      <button
                        className="rounded-lg bg-white/[0.07] px-2 py-2 text-zinc-200 transition hover:bg-white/12 disabled:opacity-35"
                        disabled={index === 0}
                        onClick={() => moveImageInNode(nodeId, image.id, -1)}
                      >
                        上移
                      </button>
                      <button
                        className="rounded-lg bg-white/[0.07] px-2 py-2 text-zinc-200 transition hover:bg-white/12 disabled:opacity-35"
                        disabled={index === images.length - 1}
                        onClick={() => moveImageInNode(nodeId, image.id, 1)}
                      >
                        下移
                      </button>
                      <button
                        className="rounded-lg bg-red-400/12 px-2 py-2 text-red-100 transition hover:bg-red-400/20"
                        onClick={() => removeImageFromNode(nodeId, image.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-zinc-500">
                当前图片组为空
              </div>
            )}
          </div>
        </div>
      </div>
      {previewIndex !== null && (
        <ImagePreviewModal
          eyebrow="Source Images"
          images={images}
          activeIndex={previewIndex}
          onActiveIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>,
    document.body
  );
}

function ImagePreviewModal({
  eyebrow,
  images,
  fallbackUrl = "",
  fallbackName = "图片",
  activeIndex,
  onActiveIndexChange,
  onClose,
}: {
  eyebrow: string;
  images: ImageAssetItem[];
  fallbackUrl?: string;
  fallbackName?: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const activeImage = images[activeIndex] ?? images[0] ?? null;
  const imageUrl = activeImage ? imageDisplayUrl(activeImage) : fallbackUrl;
  const title = activeImage?.name ?? fallbackName;
  if (!imageUrl) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/72 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
              {eyebrow}
            </p>
            <h3 className="mt-1 truncate text-base font-semibold">{title}</h3>
            {images.length > 1 && (
              <p className="mt-1 text-xs text-zinc-500">
                {Math.min(activeIndex + 1, images.length)} / {images.length}
              </p>
            )}
          </div>
          <button
            className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="关闭图片预览"
          >
            <X className="size-4" />
          </button>
        </div>
        <img
          src={imageUrl}
          alt={title}
          className="max-h-[72vh] w-full rounded-2xl bg-black object-contain"
        />
        {images.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {images.map((image, index) => (
              <button
                key={`${image.id}-preview-${index}`}
                className={cn(
                  "relative size-16 shrink-0 overflow-hidden rounded-xl border bg-black/40 transition",
                  index === activeIndex ? "border-cyan-300" : "border-white/10 hover:border-white/35"
                )}
                onClick={() => onActiveIndexChange(index)}
                aria-label={`查看图片 ${index + 1}`}
              >
                <img src={imageDisplayUrl(image)} alt={image.name} className="size-full object-cover" />
                <span className="absolute left-1 top-1 flex size-4 items-center justify-center rounded-full bg-black/70 text-[10px] font-semibold text-white">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function VideoStitcherPanel({
  clips,
  onMove,
  onPreview,
}: {
  clips: StitcherClip[];
  onMove: (sourceNodeId: string, direction: -1 | 1) => void;
  onPreview: () => void;
}) {
  return (
    <div className="nodrag nopan mb-3 space-y-2">
      <div className="rounded-xl border border-white/10 bg-black/20 p-2">
        {clips.length > 0 ? (
          <div className="space-y-1.5">
            {clips.map((clip, index) => (
              <div
                key={clip.sourceNodeId}
                className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.045] p-1.5"
              >
                <video
                  src={clip.url}
                  className="h-10 w-14 shrink-0 rounded-md bg-black object-cover"
                  preload="metadata"
                  muted
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold text-zinc-100">
                    {index + 1}. {clip.title}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[9px] uppercase text-zinc-500">
                    {clip.metric || "video clip"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    className="flex size-6 items-center justify-center rounded-md bg-white/[0.06] text-zinc-300 transition hover:bg-white/12 hover:text-white disabled:opacity-30"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(clip.sourceNodeId, -1);
                    }}
                    aria-label="上移视频"
                  >
                    <ChevronRight className="size-3 -rotate-90" />
                  </button>
                  <button
                    className="flex size-6 items-center justify-center rounded-md bg-white/[0.06] text-zinc-300 transition hover:bg-white/12 hover:text-white disabled:opacity-30"
                    disabled={index === clips.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(clip.sourceNodeId, 1);
                    }}
                    aria-label="下移视频"
                  >
                    <ChevronRight className="size-3 rotate-90" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-center">
            <Film className="mb-2 size-5 text-zinc-500" />
            <p className="text-[11px] text-zinc-400">从视频节点拉线到这里</p>
            <p className="mt-1 text-[10px] text-zinc-600">支持源视频和生成视频</p>
          </div>
        )}
      </div>
      <button
        className="w-full rounded-lg border border-fuchsia-300/45 bg-fuchsia-400/15 px-2.5 py-2 text-left text-[11px] font-semibold text-fuchsia-100 shadow-[0_0_18px_rgba(236,72,153,0.14)] transition hover:border-fuchsia-200/70 hover:bg-fuchsia-300/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        disabled={clips.length === 0}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
      >
        预览拼接结果
      </button>
    </div>
  );
}

function VideoStitcherPreviewModal({
  clips,
  activeIndex,
  onActiveIndexChange,
  onClose,
}: {
  clips: StitcherClip[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const activeClip = clips[activeIndex] ?? clips[0];
  if (!activeClip) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/72 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-300">
              Stitch Preview
            </p>
            <h3 className="mt-1 truncate text-base font-semibold">
              {activeIndex + 1} / {clips.length} · {activeClip.title}
            </h3>
          </div>
          <button
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="关闭拼接预览"
          >
            <X className="size-4" />
          </button>
        </div>
        <video
          key={activeClip.sourceNodeId}
          src={activeClip.url}
          controls
          autoPlay
          className="max-h-[68vh] w-full rounded-2xl bg-black"
          onEnded={() => {
            if (activeIndex < clips.length - 1) onActiveIndexChange(activeIndex + 1);
          }}
        />
        {clips.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {clips.map((clip, index) => (
              <button
                key={`${clip.sourceNodeId}-stitch-preview`}
                className={cn(
                  "relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border bg-black/40 transition",
                  index === activeIndex ? "border-fuchsia-300" : "border-white/10 hover:border-white/35"
                )}
                onClick={() => onActiveIndexChange(index)}
                aria-label={`预览第 ${index + 1} 段视频`}
              >
                <video src={clip.url} className="size-full object-cover" preload="metadata" muted />
                <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-[10px] font-semibold text-white">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function StoryboardScriptModal({
  title,
  metric,
  text,
  copied,
  onCopy,
  onSave,
  onClose,
}: {
  title: string;
  metric?: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== text;
  const canSave = draft.trim().length > 0 && dirty;

  useEffect(() => {
    setDraft(text);
    setIsEditing(false);
  }, [text]);

  const saveDraft = () => {
    if (!canSave) return;
    onSave(draft);
    setIsEditing(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const cancelEdit = () => {
    setDraft(text);
    setIsEditing(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/72 p-6 text-zinc-100 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-violet-300/20 bg-[#111118] shadow-[0_28px_90px_rgba(0,0,0,0.72)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-violet-300">
              Full Script
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
            {metric && <p className="mt-1 text-xs text-zinc-500">{metric}</p>}
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  className="nodrag nopan inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:border-white/25 hover:bg-white/10"
                  onClick={cancelEdit}
                >
                  取消
                </button>
                <button
                  className={cn(
                    "nodrag nopan inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition",
                    canSave
                      ? "border-emerald-300/35 bg-emerald-400/14 text-emerald-100 hover:border-emerald-200/65 hover:bg-emerald-300/22"
                      : "cursor-not-allowed border-white/10 bg-white/[0.04] text-zinc-500"
                  )}
                  onClick={saveDraft}
                  disabled={!canSave}
                >
                  <Save className="size-4" />
                  保存修改
                </button>
              </>
            ) : (
              <button
                className="nodrag nopan inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-400/12 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:border-violet-200/60 hover:bg-violet-300/20"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="size-4" />
                编辑剧本
              </button>
            )}
            <button
              className="nodrag nopan inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:border-violet-300/40 hover:bg-violet-300/12"
              onClick={onCopy}
            >
              {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4 text-zinc-300" />}
              {copied ? "已复制" : "复制全文"}
            </button>
            <button
              className="nodrag nopan rounded-full border border-white/10 bg-white/[0.05] p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label="关闭完整剧本"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {saved && (
            <div className="mb-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-xs font-semibold text-emerald-100">
              已保存到当前剧本节点，后续视频生成会使用修改后的内容。
            </div>
          )}
          {isEditing ? (
            <textarea
              className="nodrag nopan min-h-[58vh] w-full resize-none rounded-2xl border border-violet-300/25 bg-black/30 p-5 font-sans text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-200/70 focus:bg-black/38"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="编辑剧本、分镜、台词或转场内容..."
              autoFocus
            />
          ) : (
            <pre className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/24 p-5 font-sans text-sm leading-7 text-zinc-200">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function VideoStudioNode({ id, data, selected, type }: NodeProps) {
  const nodeData = data as NodeData;
  const nodeType = type as NodeType;
  const status = displayNodeStatus(nodeData);
  const accent = nodeData.accent ?? "#8b5cf6";
  const title = displayStudioNodeTitle(nodeData.label, nodeType, nodeData.config);
  const baseItems = nodeData.items ?? [];
  const hiddenCompletedVideoItems = new Set([
    "项目内已缓存",
    "缓存失败，可重试查看",
    "缓存失败，可重试缓存",
    "重新生成并覆盖",
    "重新生成视频",
  ]);
  const items = (() => {
    if (nodeType !== "videoGeneration" || status !== "done") return baseItems;
    return baseItems.filter((item) => !hiddenCompletedVideoItems.has(item));
  })();
  const runDoubaoAnalysis = useFlowStore((state) => state.runDoubaoAnalysis);
  const runTextGeneration = useFlowStore((state) => state.runTextGeneration);
  const runSeedanceGeneration = useFlowStore((state) => state.runSeedanceGeneration);
  const recoverVideoGeneration = useFlowStore((state) => state.recoverVideoGeneration);
  const addGeneratedVideoToAssets = useFlowStore((state) => state.addGeneratedVideoToAssets);
  const setGeneratedImageAssetTag = useFlowStore((state) => state.setGeneratedImageAssetTag);
  const updateNodeData = useFlowStore((state) => state.updateNodeData);
  const allNodes = useFlowStore((state) => state.nodes);
  const allEdges = useFlowStore((state) => state.edges);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState("");
  const [previewVideoLoading, setPreviewVideoLoading] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [activeImagePreviewIndex, setActiveImagePreviewIndex] = useState(0);
  const [showStitcherPreview, setShowStitcherPreview] = useState(false);
  const [activeStitcherPreviewIndex, setActiveStitcherPreviewIndex] = useState(0);
  const [showImageManager, setShowImageManager] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [showCustomizePanel, setShowCustomizePanel] = useState(false);
  const [showGeneratedAssetMenu, setShowGeneratedAssetMenu] = useState(false);
  const previewBlobUrlRef = useRef("");
  const rawVideoUrl = typeof nodeData.config.videoUrl === "string" ? nodeData.config.videoUrl : "";
  const videoAssetId = typeof nodeData.config.assetId === "string" ? nodeData.config.assetId : "";
  const projectVideoAssetId = typeof nodeData.config.projectVideoAssetId === "string" ? nodeData.config.projectVideoAssetId : "";
  const playbackAssetId = videoAssetId || projectVideoAssetId;
  const videoTaskId = typeof nodeData.config.taskId === "string" ? nodeData.config.taskId : "";
  const videoUrl = playbackAssetId
    ? resolveMediaUrl(`/api/assets/${playbackAssetId}/public-content`)
    : nodeType === "videoGeneration" && videoTaskId && (!rawVideoUrl || rawVideoUrl.startsWith("blob:"))
      ? resolveMediaUrl(`/api/video/generate/${encodeURIComponent(videoTaskId)}/content`)
      : rawVideoUrl;

  useEffect(() => {
    return () => {
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
    };
  }, []);

  const openVideoPreview = async () => {
    if (!videoUrl && !videoTaskId) return;
    if (playbackAssetId || (rawVideoUrl && !rawVideoUrl.startsWith("blob:") && !rawVideoUrl.includes("/api/video/generate/"))) {
      setPreviewVideoUrl(videoUrl);
      setShowVideoPlayer(true);
      return;
    }
    if (!videoTaskId) return;

    setPreviewVideoLoading(true);
    try {
      const blob = await downloadGeneratedVideo(videoTaskId);
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      previewBlobUrlRef.current = objectUrl;
      setPreviewVideoUrl(objectUrl);
      setShowVideoPlayer(true);
    } finally {
      setPreviewVideoLoading(false);
    }
  };
  const isGeneratedImageNode =
    nodeType === "sceneAsset" &&
    (nodeData.config.mode === "referenced_image" || nodeData.label.includes("图片生成"));
  const generatedAsset = generatedAssetOption(nodeData.config.assetTag);
  const Icon = isGeneratedImageNode ? generatedAsset.icon : iconMap[nodeType] ?? Boxes;
  const imageItems = nodeType === "imageUpload" || isGeneratedImageNode ? getImageItems(nodeData.config) : [];
  const primaryImage = getPrimaryImage(imageItems, nodeData.config.primaryImageId);
  const previewImages = imageItems.length > 0 ? imageItems : primaryImage ? [primaryImage] : [];
  const activePreviewImage = previewImages[activeImagePreviewIndex] ?? previewImages[0] ?? null;
  const imageUrl = imageDisplayUrl(primaryImage) || (typeof nodeData.config.imageUrl === "string" ? nodeData.config.imageUrl : "");
  const stitcherClips = useMemo(
    () => nodeType === "videoStitcher" ? collectStitcherClips(id, allNodes, allEdges, nodeData.config.clipOrder) : [],
    [allEdges, allNodes, id, nodeData.config.clipOrder, nodeType]
  );
  const fullScriptText =
    nodeType === "storyboardScript"
      ? textValue(
          nodeData.config.generatedText || nodeData.config.script || nodeData.config.content || nodeData.config.summary,
          ""
        )
      : "";
  const canViewFullScript = nodeType === "storyboardScript" && fullScriptText.trim().length > 0;
  const fileName = typeof nodeData.config.fileName === "string" ? nodeData.config.fileName : "源视频";
  const parsedContent =
    nodeType === "doubaoAnalysis" && status === "done"
      ? parseJsonishRecord(nodeData.config.content || nodeData.config.summary)
      : {};
  const displayMetric =
    nodeType === "videoStitcher"
      ? `${stitcherClips.length} clips / preview`
      : nodeType === "doubaoAnalysis" && status === "done" && Object.keys(parsedContent).length > 0
      ? `${textValue(parsedContent.shot_count, "0")} shots / ${textValue(parsedContent.character_count, "0")} characters / ${textValue(parsedContent.prop_count, "0")} props`
      : nodeData.metric;
  const analysisReport =
    nodeType === "doubaoAnalysis" && status === "done"
      ? getAnalysisReport(nodeData.config.report, nodeData.config, items)
      : null;
  const segmentReports = analysisReport
    ? getSegmentReports(
        nodeData.config.segmentReports,
        nodeData.config.segments,
        nodeData.config.content || nodeData.config.summary
      )
    : [];
  const replacementAssets = analysisReport
    ? getReplacementAssets(analysisReport, nodeData.config, items)
    : null;
  const replacementCount = replacementAssets
    ? replacementAssets.character.length + replacementAssets.scene.length + replacementAssets.prop.length
    : items.length;

  const copyFullScript = () => {
    if (!fullScriptText) return;
    const copied = navigator.clipboard?.writeText(fullScriptText) ?? Promise.resolve();
    void copied.catch(() => undefined).finally(() => {
      setScriptCopied(true);
      window.setTimeout(() => setScriptCopied(false), 1600);
    });
  };

  const saveFullScript = (nextText: string) => {
    const text = nextText.trim();
    if (!text) return;
    updateNodeData(id, {
      metric: "Done / edited",
      config: {
        generatedText: text,
        script: text,
        content: text,
        scriptEditedAt: new Date().toISOString(),
      },
      items: [text.slice(0, 220), "可用于分镜 / 台词", "引用上游素材"],
    });
  };

  const moveStitcherClip = (sourceNodeId: string, direction: -1 | 1) => {
    const currentOrder = stitcherClips.map((clip) => clip.sourceNodeId);
    const index = currentOrder.indexOf(sourceNodeId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    updateNodeData(id, { config: { clipOrder: nextOrder } });
  };

  return (
    <div
      className={cn(
        "studio-node group relative rounded-[18px] border bg-[#111118]/95 p-4 text-zinc-100 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur",
        status === "running" && !analysisReport && "studio-node-running",
        analysisReport ? "w-[1180px] rounded-[28px] p-7" : nodeType === "videoStitcher" ? "w-[320px]" : "w-[260px]",
        selected ? "border-fuchsia-300/80 ring-2 ring-fuchsia-400/30" : "border-white/10"
      )}
      style={{ ["--node-accent" as string]: accent }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--node-accent)]/18 text-[var(--node-accent)] ring-1 ring-[var(--node-accent)]/35">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">
              {title}
            </div>
            {displayMetric && (
              <div className="mt-1 font-mono text-[10px] uppercase text-zinc-500">
                {displayMetric}
              </div>
            )}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-7 min-w-[46px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-[10px] leading-none",
            statusClass[status]
          )}
        >
          {statusLabel[status]}
        </span>
      </div>

      {analysisReport ? (
        <DoubaoReport
          report={analysisReport}
          segments={segmentReports}
          videoUrl={videoUrl}
          fileName={fileName}
          count={replacementCount || 1}
          onCustomize={() => setShowCustomizePanel(true)}
        />
      ) : (
        <>
          {nodeData.description && (
            <p className="mb-3 text-xs leading-5 text-zinc-400">{nodeData.description}</p>
          )}

          {canViewFullScript && (
            <button
              className="nodrag nopan mb-3 flex w-full items-center justify-between rounded-xl border border-violet-300/40 bg-violet-400/12 px-3 py-2 text-left text-[11px] font-semibold text-violet-50 transition hover:border-violet-200/70 hover:bg-violet-300/20"
              onClick={(event) => {
                event.stopPropagation();
                setShowScriptModal(true);
              }}
            >
              <span>查看完整剧本</span>
              <ChevronRight className="size-3.5 text-violet-200" />
            </button>
          )}

          {imageItems.length > 0 && (
            <ImageGroupPreview
              images={imageItems}
              primaryImage={primaryImage}
              onOpen={() => {
                if (nodeType === "imageUpload") {
                  setShowImageManager(true);
                  return;
                }
                setActiveImagePreviewIndex(0);
                setShowImagePreview(true);
              }}
            />
          )}

          {nodeType === "videoStitcher" && (
            <VideoStitcherPanel
              clips={stitcherClips}
              onMove={moveStitcherClip}
              onPreview={() => {
                setActiveStitcherPreviewIndex(0);
                setShowStitcherPreview(true);
              }}
            />
          )}

          {nodeType !== "videoStitcher" && items.length > 0 && (
        <div className="space-y-1.5">
          {items.slice(0, 4).map((item, index) => {
            const canStartDoubao =
              nodeType === "videoUpload" &&
              (item === "视频分析" ||
                item === "视频分析中" ||
                item === "等待豆包分析" ||
                item === "豆包分析中");
            const canReplaceVideo =
              nodeType === "videoUpload" && (item === "视频已上传" || item === "重新上传视频");
            const canPreviewVideo =
              (nodeType === "videoUpload" && item === "查看源视频") ||
              (nodeType === "videoGeneration" && item === "查看生成视频");
            const canRecoverVideo =
              nodeType === "videoGeneration" &&
              Boolean(videoTaskId) &&
              (item === "恢复查询结果" || item.includes("等待恢复") || item.includes("任务已提交"));
            const canManageImages = nodeType === "imageUpload" && item === "管理图片";
            const canPreviewImage =
              (nodeType === "imageUpload" && item === "查看图片") ||
              (isGeneratedImageNode && item === "查看生成图片");
            const seedanceDoneLabels = ["加入制作资产", "生成完成", "已完成"];
            const seedanceAlreadyAdded = nodeType === "videoGeneration" && nodeData.config.addedToAssets === true;
            const seedanceSaving = nodeType === "videoGeneration" && item === "正在加入制作资产";
            const canAddFinishedVideo =
              nodeType === "videoGeneration" &&
              seedanceDoneLabels.includes(item) &&
              status === "done" &&
              !seedanceAlreadyAdded;
            const canShowAddedFinishedVideo =
              nodeType === "videoGeneration" &&
              status === "done" &&
              (item === "已加入制作资产" || (seedanceAlreadyAdded && seedanceDoneLabels.includes(item)));
            const isAnalysisRunning = item === "视频分析中" || item === "豆包分析中";
            const analysisLabel = isAnalysisRunning ? "视频分析中" : "视频分析";
            const canChooseGeneratedAsset = isGeneratedImageNode && index === 0;
            const isTextGenerating = nodeType === "storyboardScript" && status === "running";
            const canGenerateText =
              nodeType === "storyboardScript" &&
              index === 0 &&
              (item === "等待生成剧本" ||
                item === "等待生成文本" ||
                item === "生成失败" ||
                item === "重新生成剧本" ||
                item === "重新生成文本");

            if (canChooseGeneratedAsset) {
              return (
                <div key={`${item}-${index}`} className="nodrag nopan relative">
                  <button
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--node-accent)]/35 bg-[var(--node-accent)]/10 px-2.5 py-1.5 text-left text-[11px] font-semibold text-zinc-100 transition hover:border-[var(--node-accent)]/70 hover:bg-[var(--node-accent)]/18"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowGeneratedAssetMenu((current) => !current);
                    }}
                  >
                    <span>归类为：{generatedAsset.label}</span>
                    <ChevronRight className="size-3 rotate-90 text-zinc-400" />
                  </button>
                  {showGeneratedAssetMenu && (
                    <div
                      className="absolute left-0 top-8 z-30 w-full overflow-hidden rounded-xl border border-white/10 bg-[#101016]/95 p-1 shadow-[0_18px_45px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {generatedAssetOptions.map((option) => {
                        const OptionIcon = option.icon;
                        const active = option.value === generatedAsset.value;
                        return (
                          <button
                            key={option.value}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition",
                              active
                                ? "bg-white/12 text-white"
                                : "text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100"
                            )}
                            onClick={() => {
                              setGeneratedImageAssetTag(id, option.value);
                              setShowGeneratedAssetMenu(false);
                            }}
                          >
                            <OptionIcon className="size-3.5" />
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            if (canReplaceVideo) {
              return (
                <button
                  key={item}
                  className="nodrag nopan w-full rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-left text-[11px] text-zinc-300 transition hover:border-blue-300/35 hover:bg-blue-300/10 hover:text-blue-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("nodelist:replace-video", { detail: { nodeId: id } })
                    );
                  }}
                >
                  重新上传视频
                </button>
              );
            }

            if (canStartDoubao) {
              return (
                <button
                  key={item}
                  className={cn(
                    "nodrag nopan w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition",
                    isAnalysisRunning
                      ? "border border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                      : "border border-cyan-300/55 bg-cyan-400/18 text-cyan-50 shadow-[0_0_22px_rgba(34,211,238,0.18)] hover:border-cyan-200/80 hover:bg-cyan-300/25 hover:text-white"
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runDoubaoAnalysis(id);
                  }}
                >
                  {analysisLabel}
                </button>
              );
            }

            if (canGenerateText || isTextGenerating && index === 0) {
              return (
                <button
                  key={`${item}-${index}`}
                  className={cn(
                    "nodrag nopan w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold transition",
                    isTextGenerating
                      ? "border border-violet-300/35 bg-violet-300/10 text-violet-100"
                      : "border border-violet-300/50 bg-violet-400/14 text-violet-50 hover:border-violet-200/70 hover:bg-violet-300/22"
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isTextGenerating) void runTextGeneration(id);
                  }}
                >
                  {isTextGenerating ? "豆包剧本生成中" : item === "等待生成文本" ? "等待生成剧本" : item}
                </button>
              );
            }

            if (canPreviewVideo) {
              return (
                <button
                  key={item}
                  className="nodrag nopan w-full rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-left text-[11px] text-zinc-300 transition hover:border-violet-300/35 hover:bg-violet-300/10 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!videoUrl && !videoTaskId}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openVideoPreview();
                  }}
                >
                  {previewVideoLoading ? "视频加载中" : item}
                </button>
              );
            }

            if (canRecoverVideo) {
              return (
                <button
                  key={`${item}-${index}`}
                  className="nodrag nopan w-full rounded-lg border border-violet-300/45 bg-violet-400/14 px-2.5 py-1.5 text-left text-[11px] font-semibold text-violet-50 transition hover:border-violet-200/70 hover:bg-violet-300/22"
                  onClick={(event) => {
                    event.stopPropagation();
                    void recoverVideoGeneration(id);
                  }}
                >
                  恢复查询结果
                </button>
              );
            }

            if (canManageImages) {
              return (
                <button
                  key={item}
                  className="nodrag nopan w-full rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-2.5 py-1.5 text-left text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/18"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowImageManager(true);
                  }}
                >
                  管理图片
                </button>
              );
            }

            if (canPreviewImage) {
              return (
                <button
                  key={item}
                  className="nodrag nopan w-full rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-left text-[11px] text-zinc-300 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={previewImages.length === 0 && !imageUrl}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (previewImages.length > 0 || imageUrl) {
                      setActiveImagePreviewIndex(0);
                      setShowImagePreview(true);
                    }
                  }}
                >
                  {item}
                </button>
              );
            }

            if (canAddFinishedVideo) {
              return (
                <button
                  key={item}
                  className="nodrag nopan w-full rounded-lg border border-fuchsia-300/45 bg-fuchsia-400/15 px-2.5 py-1.5 text-left text-[11px] font-semibold text-fuchsia-100 shadow-[0_0_18px_rgba(236,72,153,0.16)] transition hover:border-fuchsia-200/70 hover:bg-fuchsia-300/25 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    void addGeneratedVideoToAssets(id);
                  }}
                >
                  加入制作资产
                </button>
              );
            }

            if (seedanceSaving) {
              return (
                <div
                  key={item}
                  className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-fuchsia-100"
                >
                  正在加入制作资产
                </div>
              );
            }

            if (canShowAddedFinishedVideo) {
              return (
                <div
                  key={item}
                  className="rounded-lg border border-emerald-300/35 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100"
                >
                  已加入制作资产
                </div>
              );
            }

            return (
              <div
                key={item}
                className="rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-[11px] text-zinc-300"
              >
                {item}
              </div>
            );
          })}
        </div>
          )}
        </>
      )}

      <div className={cn("mt-4 flex gap-1.5", analysisReport && "mt-0")}>
        <span className="h-2 w-9 rounded-full bg-sky-400" />
        <span className="h-2 w-9 rounded-full bg-cyan-300" />
        <span className="h-2 w-9 rounded-full bg-amber-300" />
        <span className="h-2 w-9 rounded-full bg-violet-400" />
      </div>

      {status === "running" && !analysisReport && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]">
          <div className="studio-node-running-sheen absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/18">
            <div className="rounded-full border border-[var(--node-accent)]/45 bg-[#111118]/82 px-4 py-2 text-center shadow-[0_0_30px_rgba(217,70,239,0.28)] backdrop-blur-md">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span className="studio-node-running-dot size-2 rounded-full bg-[var(--node-accent)]" />
                生成中
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-400">
                processing
              </div>
            </div>
          </div>
        </div>
      )}

      {nodeType !== "videoUpload" && nodeType !== "imageUpload" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-3 !border-2 !border-[#050508] !bg-[var(--node-accent)]"
        />
      )}
      {nodeType !== "timeline" && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-3 !border-2 !border-[#050508] !bg-[var(--node-accent)]"
        />
      )}

      {showVideoPlayer &&
        previewVideoUrl &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/72 p-6 backdrop-blur-sm"
            onClick={() => setShowVideoPlayer(false)}
          >
            <div
              className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#111118] p-4 text-zinc-100 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">
                    Source Video
                  </p>
                  <h3 className="mt-1 text-base font-semibold">{primaryImage?.name ?? fileName}</h3>
                </div>
                <button
                  className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
                  onClick={() => setShowVideoPlayer(false)}
                  aria-label="关闭源视频"
                >
                  <X className="size-4" />
                </button>
              </div>
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                className="max-h-[72vh] w-full rounded-2xl bg-black"
              />
            </div>
          </div>,
          document.body
        )}

      {showImagePreview &&
        (activePreviewImage || imageUrl) &&
        (
          <ImagePreviewModal
            eyebrow={isGeneratedImageNode ? "Generated Images" : "Source Images"}
            images={previewImages}
            fallbackUrl={imageUrl}
            fallbackName={primaryImage?.name ?? fileName}
            activeIndex={activeImagePreviewIndex}
            onActiveIndexChange={setActiveImagePreviewIndex}
            onClose={() => setShowImagePreview(false)}
          />
        )}

      {showStitcherPreview && stitcherClips.length > 0 && (
        <VideoStitcherPreviewModal
          clips={stitcherClips}
          activeIndex={activeStitcherPreviewIndex}
          onActiveIndexChange={setActiveStitcherPreviewIndex}
          onClose={() => setShowStitcherPreview(false)}
        />
      )}

      {showImageManager && nodeType === "imageUpload" && (
        <ImageManager
          nodeId={id}
          images={imageItems}
          primaryImageId={String(nodeData.config.primaryImageId || primaryImage?.id || "")}
          onClose={() => setShowImageManager(false)}
        />
      )}

      {showScriptModal && canViewFullScript && (
        <StoryboardScriptModal
          title={title}
          metric={displayMetric}
          text={fullScriptText}
          copied={scriptCopied}
          onCopy={copyFullScript}
          onSave={saveFullScript}
          onClose={() => setShowScriptModal(false)}
        />
      )}

      {showCustomizePanel &&
        analysisReport && (
          <ReplacementCustomizePanel
            report={analysisReport}
            config={nodeData.config}
            items={items}
            videoUrl={videoUrl}
            fileName={fileName}
            onClose={() => setShowCustomizePanel(false)}
            onGenerate={(payload) => void runSeedanceGeneration(id, payload)}
          />
        )}
    </div>
  );
}
