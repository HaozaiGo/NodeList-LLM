import { create } from "zustand";
import {
  type Node,
  type Edge,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type XYPosition,
} from "@xyflow/react";
import type { ImageAssetItem, ImageAssetTag, NodeData } from "@/types/flow";
import {
  analyzeVideo,
  createFinishedVideoAsset,
  createFlow,
  createProjectVideoCache,
  generateVideo,
  generateImage,
  getFlow,
  getImageGenerationStatus,
  getVideoGenerationStatus,
  listFlows,
  resolveMediaUrl,
  saveFlow,
  streamTextGeneration,
  updateAsset,
  type VideoGeneratePayload,
  type VideoGenerationStatus,
  type ImageGeneratePayload,
  type TextGeneratePayload,
} from "@/lib/api";

interface FlowState {
  flowId: string | null;
  flowName: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  videoFiles: Record<string, File>;
  saving: boolean;
  saveError: string | null;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (node: Node<NodeData>) => void;
  copySelection: () => boolean;
  pasteCopiedSelection: () => boolean;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  updateNodeData: (id: string, data: Partial<NodeData>) => void;
  addVideoUploadNode: (fileName: string, position: XYPosition, videoUrl?: string, file?: File) => void;
  addVideoStitcherNode: (position: XYPosition) => string;
  addImageUploadNode: (images: ImageAssetItem[], position: XYPosition) => string;
  addScriptUploadNode: (fileName: string, content: string, position: XYPosition) => string;
  appendImagesToNode: (nodeId: string, images: ImageAssetItem[]) => void;
  updateImageAsset: (nodeId: string, imageId: string, patch: Partial<ImageAssetItem>) => void;
  removeImageFromNode: (nodeId: string, imageId: string) => void;
  moveImageInNode: (nodeId: string, imageId: string, direction: -1 | 1) => void;
  setPrimaryImage: (nodeId: string, imageId: string) => void;
  setImageTag: (nodeId: string, imageId: string, tag: ImageAssetTag) => void;
  setGeneratedImageAssetTag: (nodeId: string, tag: Exclude<ImageAssetTag, "reference">) => void;
  addReferencedNode: (sourceNodeId: string, kind: "text" | "image" | "video" | "analysis", position: XYPosition) => void;
  replaceVideoUploadNode: (nodeId: string, fileName: string, videoUrl?: string, file?: File) => void;
  addDoubaoAnalysisNode: (sourceNodeId: string) => void;
  resetToVideoMvp: () => void;
  ensureVideoMvp: () => void;
  markVideoUploaded: (fileName: string, videoUrl?: string, file?: File) => void;
  runDoubaoAnalysis: (sourceNodeId?: string, model?: string, targetNodeId?: string) => Promise<void>;
  runTextGeneration: (nodeId: string, promptText?: string, model?: string) => Promise<void>;
  runImageGeneration: (nodeId: string, payload: ImageGeneratePayload) => Promise<void>;
  runSeedanceGeneration: (sourceAnalysisNodeId: string, payload: VideoGeneratePayload) => Promise<void>;
  recoverVideoGeneration: (nodeId: string) => Promise<void>;
  ensureProjectVideoCache: (nodeId: string) => Promise<void>;
  addGeneratedVideoToAssets: (nodeId: string) => Promise<void>;
  generateAssets: () => void;
  generateClip: () => void;
  persistFlow: () => Promise<void>;
  setFlowName: (name: string) => void;
  loadFlow: (id: string) => Promise<void>;
  loadLatest: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let uploadNodeCounter = 1;
let imageNodeCounter = 1;
let scriptNodeCounter = 1;
let doubaoNodeCounter = 1;
let seedanceNodeCounter = 1;
let stitcherNodeCounter = 1;
const activeVideoGenerationKeys = new Set<string>();
const activeVideoRecoveryNodeIds = new Set<string>();
const doubaoProgressTimers = new Map<string, ReturnType<typeof setInterval>>();
let selectionClipboard: { nodes: Node<NodeData>[]; edges: Edge[] } | null = null;
let selectionPasteCount = 0;
const videoFileDbName = "nodelist-video-files";
const videoFileStoreName = "videos";

function openVideoFileDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(videoFileDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(videoFileStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function storeVideoFile(nodeId: string, file: File) {
  const db = await openVideoFileDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(videoFileStoreName, "readwrite");
    transaction.objectStore(videoFileStoreName).put(file, nodeId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  db.close();
}

async function loadStoredVideoFile(nodeId: string): Promise<File | null> {
  const db = await openVideoFileDb();
  if (!db) return null;

  const file = await new Promise<File | null>((resolve) => {
    const transaction = db.transaction(videoFileStoreName, "readonly");
    const request = transaction.objectStore(videoFileStoreName).get(nodeId);
    request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
    request.onerror = () => resolve(null);
  });
  db.close();
  return file;
}

async function fileFromObjectUrl(url: string, fileName: string): Promise<File | null> {
  if (!url.startsWith("blob:")) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], fileName || "video.mp4", {
      type: blob.type || "video/mp4",
    });
  } catch {
    return null;
  }
}

function scheduleAutoSave(get: () => FlowState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => get().persistFlow(), 1500);
}

async function cacheProjectVideoPlayback(params: {
  taskId: string;
  flowId: string | null;
  nodeId: string;
  title: string;
  ratio: string;
  resolution: string;
  seconds: string | number;
  metadata?: Record<string, unknown>;
}) {
  const asset = await createProjectVideoCache({
    taskId: params.taskId,
    flowId: params.flowId,
    nodeId: params.nodeId,
    title: params.title,
    ratio: params.ratio,
    resolution: params.resolution,
    seconds: params.seconds,
    metadata: params.metadata,
  });
  return {
    asset,
    playbackUrl: resolveMediaUrl(asset.previewUrl || `/api/assets/${asset.id}/public-content`),
  };
}

function imageGroupMetric(images: ImageAssetItem[]) {
  const saved = images.filter((image) => image.uploadStatus === "saved").length;
  const uploading = images.some((image) => image.uploadStatus === "uploading");
  if (images.length <= 1) return `${images[0]?.name ?? "图片"} / ready`;
  return uploading ? `${images.length} 张图片 / 上传中 ${saved}/${images.length}` : `${images.length} 张图片 / ready`;
}

function imageGroupItems(images: ImageAssetItem[]) {
  return [
    `${images.length} 张图片已上传`,
    "管理图片",
    "分类为人物 / 场景 / 道具",
    "生成参考资产",
  ];
}

function scriptUploadMetric(content: string) {
  const text = content.trim();
  const lineCount = text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0;
  return `${text.length} 字 / ${lineCount} 行`;
}

function scriptUploadItems(content: string) {
  const snippets = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => (line.length > 32 ? `${line.slice(0, 32)}...` : line));
  return snippets.length > 0 ? snippets : ["剧本已上传", "可连接到生成节点", "可编辑剧本"];
}

function normalizeImageAssetTag(value: unknown): Exclude<ImageAssetTag, "reference"> {
  return value === "character" || value === "scene" || value === "prop" ? value : "scene";
}

function normalizeImageItems(config: Record<string, unknown>): ImageAssetItem[] {
  if (Array.isArray(config.images)) {
    return config.images.filter((item): item is ImageAssetItem => Boolean(item && typeof item === "object"));
  }
  const imageUrl = typeof config.imageUrl === "string" ? config.imageUrl : "";
  const fileName = typeof config.fileName === "string" ? config.fileName : "图片";
  return imageUrl
    ? [{ id: "legacy-image", name: fileName, url: imageUrl, tag: "reference", uploadStatus: "saved" }]
    : [];
}

function patchImageNodeConfig(images: ImageAssetItem[], primaryImageId?: string): Partial<NodeData> {
  const primary = images.find((image) => image.id === primaryImageId) ?? images[0];
  return {
    metric: imageGroupMetric(images),
    config: {
      images,
      primaryImageId: primary?.id ?? "",
      fileName: images.length === 1 ? images[0]?.name ?? "图片" : `${images.length} 张图片`,
      imageUrl: primary?.url ?? "",
    },
    items: imageGroupItems(images),
  };
}

const generatedAssetPresets: Record<Exclude<ImageAssetTag, "reference">, {
  label: string;
  description: string;
  metric: string;
  accent: string;
  items: string[];
}> = {
  character: {
    label: "人物资产",
    description: "生成主角形象并锁定一致性。",
    metric: "Lovart / 角色资产",
    accent: "#F20FAE",
    items: ["人物资产 · 已归类", "查看生成图片"],
  },
  scene: {
    label: "场景资产",
    description: "生成咖啡馆夜景、街道雨景等场景图。",
    metric: "Lovart / 场景资产",
    accent: "#24D6A2",
    items: ["场景资产 · 已归类", "查看生成图片"],
  },
  prop: {
    label: "道具与品牌物料",
    description: "生成杯子、鞋款、Logo、包装等关键道具。",
    metric: "Lovart / 道具资产",
    accent: "#FFB04A",
    items: ["道具资产 · 已归类", "查看生成图片"],
  },
};

function generatedAssetSummary(config: Record<string, unknown>) {
  const ratio = typeof config.ratio === "string" ? config.ratio : "";
  const quality = typeof config.quality === "string" ? config.quality : "";
  const resolution = typeof config.resolution === "string" ? config.resolution : "";
  const count = typeof config.count === "number" ? `${config.count}张` : "";
  return [ratio, quality, resolution, count].filter(Boolean).join(" · ");
}

function patchGeneratedImageAssetNode(
  config: Record<string, unknown>,
  tag: Exclude<ImageAssetTag, "reference">
): Partial<NodeData> {
  const preset = generatedAssetPresets[tag];
  const images = normalizeImageItems(config).map((image) => ({ ...image, tag }));
  const primaryImageId = typeof config.primaryImageId === "string" ? config.primaryImageId : images[0]?.id;
  return {
    label: preset.label,
    description: preset.description,
    metric: preset.metric,
    accent: preset.accent,
    config: {
      images,
      primaryImageId: primaryImageId ?? "",
      imageUrl: images.find((image) => image.id === primaryImageId)?.url ?? images[0]?.url ?? "",
      assetTag: tag,
    },
    items: [...preset.items, generatedAssetSummary(config)].filter(Boolean),
  };
}

function doubaoProgressItems(elapsedMs: number) {
  const prepareProgress = Math.min(100, Math.max(1, Math.floor(elapsedMs / 70)));
  const audioProgress =
    prepareProgress < 100 ? 0 : Math.min(100, Math.max(1, Math.floor((elapsedMs - 7000) / 90)));
  const modelProgress =
    audioProgress < 100 ? 0 : Math.min(98, Math.max(1, Math.floor((elapsedMs - 16000) / 520)));
  const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1000));

  return [
    `切片抽帧中 ${prepareProgress}%`,
    `音频转写中 ${audioProgress}%`,
    modelProgress >= 95 ? `分段分析中 ${modelProgress}% · 等待返回 · ${elapsedSeconds}s` : `分段分析中 ${modelProgress}%`,
    "汇总报告中",
  ];
}

function clearDoubaoProgress(targetId: string) {
  const timer = doubaoProgressTimers.get(targetId);
  if (timer) {
    clearInterval(timer);
    doubaoProgressTimers.delete(targetId);
  }
}

const videoMvpNodes: Node<NodeData>[] = [
  {
    id: "video-source",
    type: "videoUpload",
    position: { x: 80, y: 150 },
    data: {
      label: "源视频上传",
      description: "上传参考视频，读取时长、比例、关键帧和音轨。",
      metric: "reference.mp4 / 00:42 / 16:9",
      status: "done",
      accent: "#6F8CFF",
      config: { fileName: "reference.mp4", duration: 42, ratio: "16:9" },
      items: ["重新上传视频", "关键帧 18", "音轨 1"],
    },
  },
  {
    id: "doubao-analysis",
    type: "doubaoAnalysis",
    position: { x: 420, y: 120 },
    data: {
      label: "视频分析",
      description: "拆解镜头、人物、场景、动作和情绪节奏。",
      metric: "视频理解",
      status: "running",
      accent: "#41D9FF",
      config: { shots: 0, characters: 0, props: 0 },
      items: ["镜头检测中", "角色识别中", "动作摘要中"],
    },
  },
  {
    id: "storyboard",
    type: "storyboardScript",
    position: { x: 780, y: 145 },
    data: {
      label: "分镜脚本",
      description: "按镜头生成可编辑脚本，作为后续资产和视频生成依据。",
      metric: "8 shots draft",
      status: "queued",
      accent: "#A855F7",
      config: { confirmed: false },
      items: ["S01 建立镜头", "S02 主角入场", "S03 情绪转折"],
    },
  },
  {
    id: "character-asset",
    type: "characterAsset",
    position: { x: 430, y: 430 },
    data: {
      label: "人物资产",
      description: "生成主角形象并锁定一致性。",
      metric: "Seedream 2.0",
      status: "queued",
      accent: "#F20FAE",
      config: { model: "Seedream 2.0", locked: false },
      items: ["Maya_v01 待生成", "造型参考：都市夜雨"],
    },
  },
  {
    id: "scene-asset",
    type: "sceneAsset",
    position: { x: 730, y: 460 },
    data: {
      label: "场景资产",
      description: "生成咖啡馆夜景、街道雨景等场景图。",
      metric: "Image-2 optional",
      status: "queued",
      accent: "#24D6A2",
      config: { model: "Image-2", locked: false },
      items: ["Cafe_Night_v01", "Rain_Street_v01"],
    },
  },
  {
    id: "prop-asset",
    type: "propAsset",
    position: { x: 1030, y: 430 },
    data: {
      label: "道具与品牌物料",
      description: "生成杯子、鞋款、Logo、包装等关键道具。",
      metric: "Seedream 2.0",
      status: "queued",
      accent: "#FFB04A",
      config: { model: "Seedream 2.0", locked: false },
      items: ["BlueCup_v03", "Logo plate", "Product pack"],
    },
  },
  {
    id: "video-generation",
    type: "videoGeneration",
    position: { x: 710, y: 680 },
    data: {
      label: "Seedance 2.0 片段生成",
      description: "分镜脚本 + 场景 + 人物 + 道具生成对应片段。",
      metric: "shot S03 / generating",
      status: "queued",
      accent: "#8B5CF6",
      config: { model: "Seedance 2.0", generated: 0, total: 8 },
      items: ["保持角色一致性", "参考源视频运动", "5s / 16:9"],
    },
  },
  {
    id: "timeline",
    type: "timeline",
    position: { x: 1120, y: 700 },
    data: {
      label: "时间线",
      description: "片段生成后自动回填，支持预览和重生成。",
      metric: "2 / 8 clips",
      status: "ready",
      accent: "#58E08D",
      config: { clips: 2, total: 8 },
      items: ["S01 complete", "S02 complete", "S03 pending"],
    },
  },
];

const videoMvpEdges: Edge[] = [
  { id: "e-video-doubao", source: "video-source", target: "doubao-analysis", type: "default", animated: true },
  { id: "e-doubao-storyboard", source: "doubao-analysis", target: "storyboard", type: "default", animated: true },
  { id: "e-storyboard-character", source: "storyboard", target: "character-asset", type: "default" },
  { id: "e-storyboard-scene", source: "storyboard", target: "scene-asset", type: "default" },
  { id: "e-storyboard-prop", source: "storyboard", target: "prop-asset", type: "default" },
  { id: "e-character-video", source: "character-asset", target: "video-generation", type: "default" },
  { id: "e-scene-video", source: "scene-asset", target: "video-generation", type: "default" },
  { id: "e-prop-video", source: "prop-asset", target: "video-generation", type: "default" },
  { id: "e-video-timeline", source: "video-generation", target: "timeline", type: "default", animated: true },
];

function videoMvpSnapshot() {
  return {
    flowName: "AI 视频制作工作台 / MVP",
    nodes: videoMvpNodes.map((node) => ({
      ...node,
      data: { ...node.data, config: { ...node.data.config } },
      position: { ...node.position },
    })),
    edges: curvedEdges(videoMvpEdges.map((edge) => ({ ...edge }))),
  };
}

function patchNodes(
  nodes: Node<NodeData>[],
  updates: Record<string, Partial<NodeData>>
) {
  return nodes.map((node) => {
    const update = updates[node.id];
    if (!update) return node;
    return {
      ...node,
      data: {
        ...node.data,
        ...update,
        config: { ...node.data.config, ...(update.config ?? {}) },
      },
    };
  });
}

function pendingVideoGenerationNodeIds(nodes: Node<NodeData>[]) {
  return nodes
    .filter((node) => {
      if (node.type !== "videoGeneration") return false;
      const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId.trim() : "";
      if (!taskId) return false;
      if (node.data.status === "done" || node.data.status === "error") return false;
      const configStatus = String(node.data.config.status || "").toLowerCase();
      return !["completed", "failed"].includes(configStatus);
    })
    .map((node) => node.id);
}

function isActiveVideoNode(node?: Node<NodeData>) {
  if (!node || node.type !== "videoGeneration") return false;
  const configStatus = String(node.data.config.status || "").toLowerCase();
  return (
    node.data.status === "running" ||
    node.data.status === "queued" ||
    ["submitting", "in_queue", "running", "polling_retry", "caching", "timeout"].includes(configStatus)
  );
}

function videoGenerationKey(sourceNodeId: string, payload: VideoGeneratePayload) {
  return JSON.stringify({
    sourceNodeId,
    model: payload.model,
    prompt: payload.prompt,
    userPrompt: payload.user_prompt ?? "",
    ratio: payload.ratio,
    resolution: payload.resolution,
    seconds: payload.seconds,
    generateAudio: payload.generate_audio,
    camerafixed: payload.camerafixed,
    refs: payload.reference_images ?? [],
  });
}

function pendingProjectVideoCacheNodeIds(nodes: Node<NodeData>[]) {
  return nodes
    .filter((node) => {
      if (node.type !== "videoGeneration") return false;
      const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId.trim() : "";
      if (!taskId) return false;
      if (node.data.status !== "done" && String(node.data.config.status || "").toLowerCase() !== "completed") return false;
      if (typeof node.data.config.assetId === "string" && node.data.config.assetId) return false;
      if (typeof node.data.config.projectVideoAssetId === "string" && node.data.config.projectVideoAssetId) return false;
      if (node.data.config.projectVideoCacheStatus === "saving") return false;
      return true;
    })
    .map((node) => node.id);
}

function queueVideoGenerationRecovery(get: () => FlowState, nodeIds: string[]) {
  if (typeof window === "undefined" || nodeIds.length === 0) return;
  window.setTimeout(() => {
    const state = get();
    nodeIds.forEach((nodeId) => {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== "videoGeneration") return;
      if (node.data.status === "done" || node.data.status === "error") return;
      const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId.trim() : "";
      if (!taskId) return;
      void state.recoverVideoGeneration(nodeId);
    });
  }, 800);
}

function queueProjectVideoCache(get: () => FlowState, nodeIds: string[]) {
  if (typeof window === "undefined" || nodeIds.length === 0) return;
  window.setTimeout(() => {
    const state = get();
    nodeIds.forEach((nodeId) => {
      void state.ensureProjectVideoCache(nodeId);
    });
  }, 1200);
}

function curvedEdges(edges: Edge[]) {
  return edges.map((edge) => ({ ...edge, type: "default" }));
}

function cloneFlowValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function copiedNodeId(nodeId: string, pasteStamp: string, index: number) {
  return `${nodeId}-copy-${pasteStamp}-${index}`;
}

function copiedEdgeId(edge: Edge, pasteStamp: string, index: number) {
  return `${edge.id || "edge"}-copy-${pasteStamp}-${index}`;
}

function findDoubaoTargetId(nodes: Node<NodeData>[], edges: Edge[], sourceNodeId: string) {
  const existingEdge = edges.find((edge) => {
    if (edge.source !== sourceNodeId) return false;
    const targetNode = nodes.find((node) => node.id === edge.target);
    return targetNode?.type === "doubaoAnalysis";
  });
  if (existingEdge) return existingEdge.target;
  return "";
}

function findSeedanceTargetId(nodes: Node<NodeData>[], edges: Edge[], sourceAnalysisNodeId: string) {
  const existingEdge = edges.find((edge) => {
    if (edge.source !== sourceAnalysisNodeId) return false;
    const targetNode = nodes.find((node) => node.id === edge.target);
    return targetNode?.type === "videoGeneration";
  });
  if (existingEdge) return existingEdge.target;
  return "";
}

function textFromUnknown(value: unknown, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function videoPlaybackUrlFromStatus(status: VideoGenerationStatus, taskId: string) {
  const remoteUrl = Array.isArray(status.videoUrls)
    ? status.videoUrls.find((item) => typeof item === "string" && item.trim())
    : "";
  return resolveMediaUrl(remoteUrl || status.content_path || `/api/video/generate/${encodeURIComponent(taskId)}/content`);
}

function compactText(value: string, maxLength = 1400) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function textGenerationModelLabel(model?: string) {
  if (!model) return "Doubao Seed 2.0 Pro";
  if (model === "qwen3.8-max" || model.startsWith("qwen")) return "Qwen3.8-Max";
  if (model.includes("doubao")) return "Doubao Seed 2.0 Pro";
  return model;
}

function videoAnalysisModelLabel(model?: string) {
  if (model === "qwen3.8-max" || model?.startsWith("qwen")) return "Qwen3.8-Max";
  return "豆包视频分析";
}

function sourceContextForTextNode(nodes: Node<NodeData>[], edges: Edge[], nodeId: string) {
  const sourceNodes = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is Node<NodeData> => Boolean(node));

  return sourceNodes
    .map((node) => {
      const config = node.data.config;
      const parts = [
        `上游节点：${node.data.label}`,
        node.data.description ? `说明：${node.data.description}` : "",
        node.data.metric ? `状态：${node.data.metric}` : "",
        Array.isArray(node.data.items) && node.data.items.length
          ? `节点内容：${node.data.items.join("；")}`
          : "",
        textFromUnknown(config.generatedText) ? `已生成文本：${textFromUnknown(config.generatedText)}` : "",
        textFromUnknown(config.prompt) ? `提示词：${textFromUnknown(config.prompt)}` : "",
        textFromUnknown(config.summary) ? `摘要：${textFromUnknown(config.summary)}` : "",
        textFromUnknown(config.content) ? `内容：${textFromUnknown(config.content)}` : "",
      ].filter(Boolean);
      return compactText(parts.join("\n"));
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildTextGenerationPrompt(
  nodes: Node<NodeData>[],
  edges: Edge[],
  nodeId: string,
  promptText?: string
) {
  const userPrompt = (promptText || "").trim();
  const sourceContext = sourceContextForTextNode(nodes, edges, nodeId);
  const task =
    userPrompt ||
    "请基于上游素材生成可直接用于后续图片/视频制作的短剧剧本，包含分镜、台词、动作、情绪和转场节奏，保持主体、场景和资产意图一致。";
  return [task, sourceContext ? `参考上游素材：\n${sourceContext}` : ""].filter(Boolean).join("\n\n");
}

function parseTextGenerationLines(buffer: string, onEvent: (event: Record<string, unknown>) => void) {
  let nextBuffer = buffer;
  let cursor = nextBuffer.indexOf("\n");
  while (cursor >= 0) {
    const line = nextBuffer.slice(0, cursor).trim();
    nextBuffer = nextBuffer.slice(cursor + 1);
    if (line) onEvent(JSON.parse(line) as Record<string, unknown>);
    cursor = nextBuffer.indexOf("\n");
  }
  return nextBuffer;
}

async function readTextGenerationStream(
  response: Response,
  onDelta: (text: string) => void,
  onStatus?: (text: string) => void
) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data && typeof data === "object" && "detail" in data ? String(data.detail) : "剧本生成失败";
    throw new Error(detail);
  }
  if (!response.body) {
    throw new Error("浏览器不支持流式读取");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let completed = "";
  const handleEvent = (event: Record<string, unknown>) => {
    if (event.type === "delta") {
      accumulated += String(event.text || "");
      onDelta(accumulated);
    } else if (event.type === "status") {
      onStatus?.(String(event.text || "剧本生成中"));
    } else if (event.type === "done") {
      completed = String(event.prompt_text || accumulated);
    } else if (event.type === "error") {
      throw new Error(String(event.detail || event.text || "剧本生成失败"));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer = parseTextGenerationLines(buffer, handleEvent);
    if (done) break;
  }
  if (buffer.trim()) {
    parseTextGenerationLines(`${buffer.trim()}\n`, handleEvent);
  }
  return (completed || accumulated).trim();
}

function createDoubaoNode(sourceNode: Node<NodeData>, targetId: string): Node<NodeData> {
  return {
    id: targetId,
    type: "doubaoAnalysis",
    position: {
      x: sourceNode.position.x + 360,
      y: sourceNode.position.y + 8,
    },
    data: {
      label: "视频分析",
      description: "拆解镜头、人物、场景、动作和情绪节奏。",
      metric: "视频理解",
      status: "running",
      accent: "#41D9FF",
      config: {
        sourceNodeId: sourceNode.id,
        fileName: sourceNode.data.config.fileName,
        analysisModel: "doubao",
        shots: 0,
        characters: 0,
        props: 0,
      },
      items: ["镜头检测中", "角色识别中", "动作摘要中"],
    },
  };
}

function createSeedanceNode(
  sourceNode: Node<NodeData>,
  targetId: string,
  payload: VideoGeneratePayload
): Node<NodeData> {
  const offsetX = sourceNode.type === "doubaoAnalysis" ? 1240 : 360;
  const specItems = payload.generation_spec?.items?.length
    ? payload.generation_spec.items.slice(0, 2)
    : ["保持角色一致性", "参考源视频运动"];
  return {
    id: targetId,
    type: "videoGeneration",
    position: {
      x: sourceNode.position.x + offsetX,
      y: sourceNode.position.y + 20,
    },
    data: {
      label: videoModelLabel(payload.model),
      description: "替换定制后的最终视频生成结果。",
      metric: "shot S03 / generating",
      status: "queued",
      accent: "#8B5CF6",
      config: {
        sourceAnalysisNodeId: sourceNode.id,
        model: payload.model,
        ratio: payload.ratio,
        resolution: payload.resolution,
        seconds: payload.seconds,
        generate_audio: payload.generate_audio,
        generationSpec: payload.generation_spec,
        userPrompt: payload.user_prompt ?? "",
      },
      items: [
        ...specItems,
        `${payload.seconds}s / ${payload.ratio}`,
      ],
    },
  };
}

function videoModelLabel(model: string): string {
  const labels: Record<string, string> = {
    "bds-pro": "MiniMax h3",
    "seedance-2-0": "Seedance 2.0",
    "seedance-2-0-fast": "Seedance 2.0 Fast",
    "seedance-2-0-mini": "Seedance 2.0 Mini",
    "kling-3-0": "Kling 3.0",
    "kling-3-0-omni": "Kling 3.0 Omni",
    "veo-3-1": "Veo 3.1",
    "veo-3-1-fast": "Veo 3.1 Fast",
    "gemini-omni-flash": "Gemini Omni Flash",
  };
  return labels[model] ?? "视频生成";
}

function placeDoubaoNodeNextToSource(
  nodes: Node<NodeData>[],
  sourceNode: Node<NodeData>,
  targetId: string
) {
  return nodes.map((node) =>
    node.id === targetId
      ? {
          ...node,
          position: {
            x: sourceNode.position.x + 360,
            y: sourceNode.position.y + 8,
          },
        }
      : node
  );
}

export const useFlowStore = create<FlowState>((set, get) => ({
  flowId: null,
  flowName: "Untitled Flow",
  nodes: [],
  edges: [],
  videoFiles: {},
  saving: false,
  saveError: null,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node<NodeData>[] });
    scheduleAutoSave(get);
  },
  onEdgesChange: (changes) => {
    set({ edges: curvedEdges(applyEdgeChanges(changes, get().edges)) });
    scheduleAutoSave(get);
  },
  onConnect: (connection) => {
    set({ edges: curvedEdges(addEdge({ ...connection, type: "default" }, get().edges)) });
    scheduleAutoSave(get);
  },
  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
    scheduleAutoSave(get);
  },
  copySelection: () => {
    const selectedNodeIds = new Set(get().nodes.filter((node) => node.selected).map((node) => node.id));
    if (selectedNodeIds.size === 0) return false;

    selectionClipboard = {
      nodes: get().nodes.filter((node) => selectedNodeIds.has(node.id)).map((node) => cloneFlowValue(node)),
      edges: get().edges
        .filter((edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target))
        .map((edge) => cloneFlowValue(edge)),
    };
    selectionPasteCount = 0;
    return true;
  },
  pasteCopiedSelection: () => {
    if (!selectionClipboard || selectionClipboard.nodes.length === 0) return false;

    selectionPasteCount += 1;
    const pasteStamp = `${Date.now()}-${selectionPasteCount}`;
    const offset = 48 * selectionPasteCount;
    const idMap = new Map<string, string>();
    selectionClipboard.nodes.forEach((node, index) => {
      idMap.set(node.id, copiedNodeId(node.id, pasteStamp, index + 1));
    });

    const nextVideoFiles = { ...get().videoFiles };
    const pastedNodes = selectionClipboard.nodes.map((node) => {
      const nextId = idMap.get(node.id) ?? copiedNodeId(node.id, pasteStamp, 0);
      const file = get().videoFiles[node.id];
      if (file) {
        nextVideoFiles[nextId] = file;
        void storeVideoFile(nextId, file);
      }

      return {
        ...cloneFlowValue(node),
        id: nextId,
        selected: true,
        position: {
          x: node.position.x + offset,
          y: node.position.y + offset,
        },
      };
    });

    const pastedEdges = selectionClipboard.edges.map((edge, index) => {
      const nextSource = idMap.get(edge.source) ?? edge.source;
      const nextTarget = idMap.get(edge.target) ?? edge.target;
      return {
        ...cloneFlowValue(edge),
        id: copiedEdgeId(edge, pasteStamp, index + 1),
        source: nextSource,
        target: nextTarget,
        selected: false,
      };
    });

    set({
      nodes: [
        ...get().nodes.map((node) => ({ ...node, selected: false })),
        ...pastedNodes,
      ],
      edges: curvedEdges([...get().edges, ...pastedEdges]),
      videoFiles: nextVideoFiles,
    });
    scheduleAutoSave(get);
    return true;
  },
  updateNodeConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...config } } }
          : n
      ),
    });
    scheduleAutoSave(get);
  },

  updateNodeData: (id, data) => {
    set({
      nodes: patchNodes(get().nodes, {
        [id]: data,
      }),
    });
    scheduleAutoSave(get);
  },

  addVideoUploadNode: (fileName, position, videoUrl, file) => {
    const id = `video-source-${Date.now()}-${uploadNodeCounter++}`;
    const node: Node<NodeData> = {
      id,
      type: "videoUpload",
      position,
      data: {
        label: "源视频上传",
        description: "上传参考视频，读取时长、比例、关键帧和音轨。",
        metric: `${fileName} / ready`,
        status: "done",
        accent: "#6F8CFF",
        config: { fileName, videoUrl },
        items: ["重新上传视频", "视频分析", "查看源视频"],
      },
    };
    set({
      nodes: [...get().nodes, node],
      videoFiles: file ? { ...get().videoFiles, [id]: file } : get().videoFiles,
    });
    if (file) void storeVideoFile(id, file);
    scheduleAutoSave(get);
  },

  addVideoStitcherNode: (position) => {
    const id = `video-stitcher-${Date.now()}-${stitcherNodeCounter++}`;
    const node: Node<NodeData> = {
      id,
      type: "videoStitcher",
      position,
      data: {
        label: "视频拼接器",
        description: "把视频节点连接进来，调整播放顺序并预览拼接效果。",
        metric: "0 clips / ready",
        status: "ready",
        accent: "#F472B6",
        config: { clipOrder: [] },
        items: ["拖入视频节点", "调整播放顺序", "预览拼接结果"],
      },
    };
    set({ nodes: [...get().nodes, node] });
    scheduleAutoSave(get);
    return id;
  },

  addImageUploadNode: (images, position) => {
    const id = `image-source-${Date.now()}-${imageNodeCounter++}`;
    const primary = images[0];
    const node: Node<NodeData> = {
      id,
      type: "imageUpload",
      position,
      data: {
        label: images.length > 1 ? "图片素材组" : "图片上传",
        description: "上传参考图片，可作为人物、场景或元素素材。",
        metric: imageGroupMetric(images),
        status: "done",
        accent: "#22D3EE",
        config: {
          images,
          primaryImageId: primary?.id ?? "",
          fileName: images.length === 1 ? primary?.name ?? "图片" : `${images.length} 张图片`,
          imageUrl: primary?.url ?? "",
        },
        items: imageGroupItems(images),
      },
    };
    set({ nodes: [...get().nodes, node] });
    scheduleAutoSave(get);
    return id;
  },

  addScriptUploadNode: (fileName, content, position) => {
    const id = `script-source-${Date.now()}-${scriptNodeCounter++}`;
    const node: Node<NodeData> = {
      id,
      type: "storyboardScript",
      position,
      data: {
        label: "上传剧本",
        description: "导入已有剧本文本，作为分镜、图片和视频生成依据。",
        metric: scriptUploadMetric(content),
        status: "done",
        accent: "#F59E0B",
        config: {
          sourceType: "upload",
          fileName,
          script: content,
          content,
          assetType: "script",
          uploadStatus: "uploading",
        },
        items: scriptUploadItems(content),
      },
    };
    set({ nodes: [...get().nodes, node] });
    scheduleAutoSave(get);
    return id;
  },

  appendImagesToNode: (nodeId, images) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.type !== "imageUpload") return;
    const currentImages = normalizeImageItems(currentNode.data.config);
    const nextImages = [...currentImages, ...images];
    const primaryImageId =
      typeof currentNode.data.config.primaryImageId === "string"
        ? currentNode.data.config.primaryImageId
        : nextImages[0]?.id;
    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: {
          label: nextImages.length > 1 ? "图片素材组" : "图片上传",
          ...patchImageNodeConfig(nextImages, primaryImageId),
        },
      }),
    });
    scheduleAutoSave(get);
  },

  updateImageAsset: (nodeId, imageId, patch) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (!currentNode || (currentNode.type !== "imageUpload" && currentNode.type !== "sceneAsset")) return;
    const nextImages = normalizeImageItems(currentNode.data.config).map((image) =>
      image.id === imageId ? { ...image, ...patch } : image
    );
    const primaryImageId =
      typeof currentNode.data.config.primaryImageId === "string"
        ? currentNode.data.config.primaryImageId
        : nextImages[0]?.id;
    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: patchImageNodeConfig(nextImages, primaryImageId),
      }),
    });
    scheduleAutoSave(get);
  },

  removeImageFromNode: (nodeId, imageId) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.type !== "imageUpload") return;
    const nextImages = normalizeImageItems(currentNode.data.config).filter((image) => image.id !== imageId);
    const primaryImageId =
      currentNode.data.config.primaryImageId === imageId
        ? nextImages[0]?.id
        : typeof currentNode.data.config.primaryImageId === "string"
          ? currentNode.data.config.primaryImageId
          : nextImages[0]?.id;
    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: {
          label: nextImages.length > 1 ? "图片素材组" : "图片上传",
          ...patchImageNodeConfig(nextImages, primaryImageId),
        },
      }),
    });
    scheduleAutoSave(get);
  },

  moveImageInNode: (nodeId, imageId, direction) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.type !== "imageUpload") return;
    const nextImages = [...normalizeImageItems(currentNode.data.config)];
    const index = nextImages.findIndex((image) => image.id === imageId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= nextImages.length) return;
    [nextImages[index], nextImages[targetIndex]] = [nextImages[targetIndex], nextImages[index]];
    const primaryImageId =
      typeof currentNode.data.config.primaryImageId === "string"
        ? currentNode.data.config.primaryImageId
        : nextImages[0]?.id;
    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: patchImageNodeConfig(nextImages, primaryImageId),
      }),
    });
    scheduleAutoSave(get);
  },

  setPrimaryImage: (nodeId, imageId) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.type !== "imageUpload") return;
    const images = normalizeImageItems(currentNode.data.config);
    if (!images.some((image) => image.id === imageId)) return;
    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: patchImageNodeConfig(images, imageId),
      }),
    });
    scheduleAutoSave(get);
  },

  setImageTag: (nodeId, imageId, tag) => {
    get().updateImageAsset(nodeId, imageId, { tag });
    const node = get().nodes.find((item) => item.id === nodeId);
    const image = normalizeImageItems(node?.data.config ?? {}).find((item) => item.id === imageId);
    if (image?.assetId) {
      void updateAsset(image.assetId, { metadata: { tag } }).catch(() => {});
    }
  },

  setGeneratedImageAssetTag: (nodeId, tag) => {
    const currentNode = get().nodes.find((node) => node.id === nodeId);
    if (
      !currentNode ||
      currentNode.type !== "sceneAsset" ||
      currentNode.data.config.mode !== "referenced_image"
    ) {
      return;
    }

    const images = normalizeImageItems(currentNode.data.config);
    images.forEach((image) => {
      if (image.assetId) {
        void updateAsset(image.assetId, { metadata: { tag } }).catch(() => {});
      }
    });

    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: patchGeneratedImageAssetNode(currentNode.data.config, tag),
      }),
    });
    scheduleAutoSave(get);
  },

  addReferencedNode: (sourceNodeId, kind, position) => {
    const sourceNode = get().nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode) return;

    const id = `referenced-${kind}-${Date.now()}`;
    const presets: Record<typeof kind, Node<NodeData>> = {
      text: {
        id,
        type: "storyboardScript",
        position,
        data: {
          label: "剧本生成",
          description: "引用上游节点，生成短剧脚本、分镜、台词和转场节奏。",
          metric: "Script draft",
          status: "queued",
          accent: "#A855F7",
          config: { sourceNodeId, mode: "referenced_text", sourceLabel: sourceNode.data.label },
          items: ["等待生成剧本", "可用于分镜 / 台词", "引用上游素材"],
        },
      },
      image: {
        id,
        type: "sceneAsset",
        position,
        data: {
          label: "图片生成",
          description: "引用上游节点，生成场景、人物或道具图片素材。",
          metric: "Image asset",
          status: "queued",
          accent: "#22D3EE",
          config: { sourceNodeId, mode: "referenced_image", sourceLabel: sourceNode.data.label, assetTag: "scene" },
          items: ["资产类型：场景", "等待生成图片", "引用上游素材"],
        },
      },
      video: {
        id,
        type: "videoGeneration",
        position,
        data: {
          label: "视频生成",
          description: "引用上游节点，生成对应视频片段。",
          metric: "Seedance queue",
          status: "queued",
          accent: "#8B5CF6",
          config: { sourceNodeId, mode: "referenced_video", sourceLabel: sourceNode.data.label },
          items: ["等待生成视频", "参考上游素材", "可加入制作资产"],
        },
      },
      analysis: {
        id,
        type: "doubaoAnalysis",
        position,
        data: {
          label: "视频分析",
          description: "引用源视频，拆解镜头、人物、场景、动作和情绪节奏。",
          metric: "选择模型 / ready",
          status: "ready",
          accent: "#41D9FF",
          config: {
            sourceNodeId,
            sourceLabel: sourceNode.data.label,
            analysisModel: "doubao",
            fileName: sourceNode.data.config.fileName,
            shots: 0,
            characters: 0,
            props: 0,
          },
          items: ["视频分析", "模型：豆包分析", "引用源视频"],
        },
      },
    };
    const edge: Edge = {
      id: `e-${sourceNodeId}-${id}`,
      source: sourceNodeId,
      target: id,
      type: "default",
      animated: true,
    };
    set({
      nodes: [...get().nodes, presets[kind]],
      edges: addEdge(edge, get().edges),
    });
    scheduleAutoSave(get);
  },

  replaceVideoUploadNode: (nodeId, fileName, videoUrl, file) => {
    const { nodes, edges } = get();
    const doubaoTargetId = findDoubaoTargetId(nodes, edges, nodeId);
    const updates: Record<string, Partial<NodeData>> = {
      [nodeId]: {
        status: "done",
        metric: `${fileName} / ready`,
        config: { fileName, videoUrl },
        items: ["重新上传视频", "视频分析", "查看源视频"],
      },
    };
    if (doubaoTargetId) {
      updates[doubaoTargetId] = {
        status: "ready",
        metric: "等待重新分析",
        config: { sourceNodeId: nodeId, fileName, shots: 0, characters: 0, props: 0 },
        items: ["视频分析"],
      };
    }

    set({
      nodes: patchNodes(nodes, updates),
      videoFiles: file ? { ...get().videoFiles, [nodeId]: file } : get().videoFiles,
    });
    if (file) void storeVideoFile(nodeId, file);
    scheduleAutoSave(get);
  },

  addDoubaoAnalysisNode: (sourceNodeId) => {
    const { nodes, edges } = get();
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode) return;

    const existingEdge = edges.find((edge) => {
      if (edge.source !== sourceNodeId) return false;
      const targetNode = nodes.find((node) => node.id === edge.target);
      return targetNode?.type === "doubaoAnalysis";
    });

    const sourceItems = (sourceNode.data.items ?? []).map((item) =>
      item === "等待豆包分析" || item === "视频分析" ? "视频分析中" : item
    );

    if (existingEdge) {
      set({
        nodes: patchNodes(nodes, {
          [sourceNodeId]: { items: sourceItems },
          [existingEdge.target]: {
            status: "running",
            metric: "视频理解",
            items: ["镜头检测中", "角色识别中", "动作摘要中"],
          },
        }),
      });
      scheduleAutoSave(get);
      return;
    }

    const targetId = `doubao-analysis-${Date.now()}-${doubaoNodeCounter++}`;
    const targetNode: Node<NodeData> = {
      id: targetId,
      type: "doubaoAnalysis",
      position: {
        x: sourceNode.position.x + 360,
        y: sourceNode.position.y + 8,
      },
      data: {
        label: "视频分析",
        description: "拆解镜头、人物、场景、动作和情绪节奏。",
        metric: "视频理解",
        status: "running",
        accent: "#41D9FF",
        config: {
          sourceNodeId,
          fileName: sourceNode.data.config.fileName,
          shots: 0,
          characters: 0,
          props: 0,
        },
        items: ["镜头检测中", "角色识别中", "动作摘要中"],
      },
    };

    const edge: Edge = {
      id: `e-${sourceNodeId}-${targetId}`,
      source: sourceNodeId,
      target: targetId,
      type: "default",
      animated: true,
    };

    set({
      nodes: [
        ...patchNodes(nodes, {
          [sourceNodeId]: { items: sourceItems },
        }),
        targetNode,
      ],
      edges: [...edges, edge],
    });
    scheduleAutoSave(get);
  },

  resetToVideoMvp: () => {
    set({ flowId: null, ...videoMvpSnapshot() });
    scheduleAutoSave(get);
  },

  ensureVideoMvp: () => {
    const { nodes } = get();
    const hasVideoMvp = nodes.some((node) => node.type === "videoUpload");
    if (nodes.length === 0 || !hasVideoMvp) {
      set({ ...videoMvpSnapshot() });
      scheduleAutoSave(get);
    }
  },

  markVideoUploaded: (fileName, videoUrl, file) => {
    set({
      nodes: patchNodes(get().nodes, {
        "video-source": {
          status: "done",
          metric: `${fileName} / ready`,
          config: { fileName, videoUrl },
          items: ["重新上传视频", "视频分析", "查看源视频"],
        },
        "doubao-analysis": { status: "ready" },
      }),
      videoFiles: file ? { ...get().videoFiles, "video-source": file } : get().videoFiles,
    });
    if (file) void storeVideoFile("video-source", file);
    scheduleAutoSave(get);
  },

  runDoubaoAnalysis: async (sourceNodeId, model, targetNodeId) => {
    const current = get();
    const sourceNode =
      (sourceNodeId ? current.nodes.find((node) => node.id === sourceNodeId) : undefined) ??
      current.nodes.find((node) => node.type === "videoUpload");
    if (!sourceNode) return;
    const targetNode = targetNodeId ? current.nodes.find((node) => node.id === targetNodeId) : undefined;
    const analysisModel =
      model?.trim() ||
      (typeof targetNode?.data.config.analysisModel === "string" ? targetNode.data.config.analysisModel : "") ||
      "doubao";
    const analysisModelLabel = videoAnalysisModelLabel(analysisModel);

    let file: File | undefined = current.videoFiles[sourceNode.id];
    if (!file) {
      file = await loadStoredVideoFile(sourceNode.id) ?? undefined;
    }
    if (!file) {
      const videoUrl =
        typeof sourceNode.data.config.videoUrl === "string" ? sourceNode.data.config.videoUrl : "";
      const fileName =
        typeof sourceNode.data.config.fileName === "string" ? sourceNode.data.config.fileName : "video.mp4";
      file = await fileFromObjectUrl(videoUrl, fileName) ?? undefined;
    }
    if (file && !current.videoFiles[sourceNode.id]) {
      set({ videoFiles: { ...get().videoFiles, [sourceNode.id]: file } });
      void storeVideoFile(sourceNode.id, file);
    }
    let targetId =
      targetNode?.type === "doubaoAnalysis"
        ? targetNode.id
        : findDoubaoTargetId(current.nodes, current.edges, sourceNode.id);
    let nodes = current.nodes;
    let edges = current.edges;
    if (!targetId) {
      targetId = `doubao-analysis-${Date.now()}-${doubaoNodeCounter++}`;
      nodes = [...nodes, createDoubaoNode(sourceNode, targetId)];
      edges = [
        ...edges,
        {
          id: `e-${sourceNode.id}-${targetId}`,
          source: sourceNode.id,
          target: targetId,
          type: "default",
          animated: true,
        },
      ];
    } else {
      nodes = placeDoubaoNodeNextToSource(nodes, sourceNode, targetId);
    }

    if (!file) {
      set({
        nodes: patchNodes(nodes, {
          [targetId]: {
            status: "ready",
            metric: "等待上传视频",
            config: { analysisModel },
            items: ["请先上传本地视频", "上传后再点击视频分析"],
          },
        }),
        edges,
      });
      scheduleAutoSave(get);
      return;
    }

    const sourceItems = (sourceNode.data.items ?? []).map((item) =>
      item === "等待豆包分析" || item === "视频分析" ? "视频分析中" : item
    );

    set({
      nodes: patchNodes(nodes, {
        [sourceNode.id]: { items: sourceItems },
        [targetId]: {
          status: "running",
          metric: `${analysisModelLabel} / analyzing`,
          config: { analysisModel },
          items: doubaoProgressItems(0),
        },
      }),
      edges,
    });
    scheduleAutoSave(get);

    clearDoubaoProgress(targetId);
    const progressStartedAt = Date.now();
    const progressTimer = setInterval(() => {
      const targetNode = get().nodes.find((node) => node.id === targetId);
      if (targetNode?.data.status !== "running") {
        clearDoubaoProgress(targetId);
        return;
      }

      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            items: doubaoProgressItems(Date.now() - progressStartedAt),
          },
        }),
      });
    }, 600);
    doubaoProgressTimers.set(targetId, progressTimer);

    try {
      const result = await analyzeVideo(file, analysisModel);
      clearDoubaoProgress(targetId);
      const scenes = result.scenes.length ? result.scenes.length : 0;
      const analysisItems = result.items.length
        ? result.items
        : [
            `镜头：${result.shots || "已识别"}`,
            `人物：${result.characters || "已识别"}`,
            `场景：${scenes || "已识别"}`,
            `关键道具：${result.props || "已识别"}`,
          ];
      const storyboardItems = result.storyboard.length
        ? result.storyboard.slice(0, 4)
        : ["S01 已生成视频拆解", "S02 等待人工校对"];
      const rawResult = result.raw && typeof result.raw === "object"
        ? (result.raw as Record<string, unknown>)
        : {};

      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            status: "done",
            metric: `${videoAnalysisModelLabel(result.model)} / ${result.shots || 0} shots`,
            config: {
              model: result.model,
              analysisModel,
              shots: result.shots,
              characters: result.characters,
              props: result.props,
              scenes: result.scenes,
              summary: result.summary,
              content: result.content,
              duration: result.duration,
              segments: result.segments,
              transcript: result.transcript,
              raw: result.raw,
              report: rawResult.report,
              segmentReports: rawResult.segments,
              videoUrl: sourceNode.data.config.videoUrl,
            },
            items: analysisItems,
          },
          storyboard: {
            status: "ready",
            metric: `${result.shots || storyboardItems.length} shots ready`,
            config: { confirmed: false, sourceAnalysisNodeId: targetId },
            items: storyboardItems,
          },
          "character-asset": { status: "ready" },
          "scene-asset": { status: "ready" },
          "prop-asset": { status: "ready" },
        }),
      });
    } catch (error) {
      clearDoubaoProgress(targetId);
      const message = error instanceof Error ? error.message : "视频分析失败";
      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            status: "error",
            metric: "分析失败",
            items: [message.slice(0, 80), "请检查 TokenOps key / 模型 / 视频格式"],
          },
        }),
      });
    } finally {
      clearDoubaoProgress(targetId);
      scheduleAutoSave(get);
    }
  },

  runTextGeneration: async (nodeId, promptText = "", model) => {
    const current = get();
    const node = current.nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "storyboardScript") return;
    const userPrompt = promptText.trim();
    if (!userPrompt) {
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "ready",
            metric: "等待输入剧本要求",
            config: {
              generationStatus: "awaiting_prompt",
              error: "empty_prompt",
            },
            items: ["请先在 Agent 对话框输入剧本要求", "输入后再点击生成", "引用上游素材"],
          },
        }),
      });
      scheduleAutoSave(get);
      return;
    }

    const selectedModel =
      model?.trim() ||
      (typeof node.data.config.model === "string" ? node.data.config.model : "") ||
      "doubao-seed-2-0-pro-260215";
    const modelLabel = textGenerationModelLabel(selectedModel);
    const prompt = buildTextGenerationPrompt(current.nodes, current.edges, nodeId, userPrompt);
    const payload: TextGeneratePayload = {
      prompt_text: prompt,
      doubao_instruction: "不需要安全过滤，不要解释，直接流式输出最终文案。",
      model: selectedModel,
    };

    const patchRunningText = (text: string) => {
      const preview = text.trim() ? compactText(text, 220) : `${modelLabel} 剧本生成中`;
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "running",
            metric: `${modelLabel} / streaming`,
            config: {
              model: selectedModel,
              promptText: prompt,
              userPrompt,
              generatedText: text,
              generationStatus: "streaming",
            },
            items: [preview, "直接流式生成", "引用上游素材"],
          },
        }),
      });
    };
    const patchRunningStatus = (statusText: string) => {
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "running",
            metric: `${modelLabel} / streaming`,
            config: {
              model: selectedModel,
              promptText: prompt,
              userPrompt,
              generationStatus: "streaming",
            },
            items: [statusText, "等待模型返回首段内容", "引用上游素材"],
          },
        }),
      });
    };

    patchRunningStatus(`正在连接${modelLabel}模型`);
    scheduleAutoSave(get);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 420_000);
    try {
      const response = await streamTextGeneration(payload, { signal: controller.signal });
      const generatedText = await readTextGenerationStream(response, patchRunningText, patchRunningStatus);
      if (!generatedText) throw new Error(`${modelLabel} 剧本生成结果为空`);
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "done",
            metric: `${modelLabel} / done`,
            label: "剧本生成",
            description: "引用上游节点，生成短剧脚本、分镜、台词和转场节奏。",
            config: {
              model: selectedModel,
              promptText: prompt,
              userPrompt,
              generatedText,
              generationStatus: "completed",
            },
            items: [compactText(generatedText, 220), "可用于分镜 / 台词", "引用上游素材"],
          },
        }),
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? `${modelLabel} 剧本生成超时，上游模型长时间没有返回内容，请稍后重试或切换模型`
          : error instanceof Error
            ? error.message
            : `${modelLabel} 剧本生成失败`;
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "error",
            metric: `${modelLabel} 生成失败`,
            config: { model: selectedModel, userPrompt, generationStatus: "failed", error: message },
            items: ["生成失败", message, "请稍后重试或切换模型"],
          },
        }),
      });
    } finally {
      window.clearTimeout(timeoutId);
      scheduleAutoSave(get);
    }
  },

  runImageGeneration: async (nodeId, payload) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const outputSummary = `${payload.ratio} · ${payload.quality || "标准画质"} · ${payload.resolution} · ${payload.count || 1}张`;
    const outputTag = normalizeImageAssetTag(payload.asset_tag ?? node.data.config.assetTag);

    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: {
          status: "running",
          metric: "Lovart 生成中",
          config: {
            model: payload.model,
            ratio: payload.ratio,
            resolution: payload.resolution,
            quality: payload.quality,
            count: payload.count,
            prompt: payload.prompt,
            userPrompt: payload.user_prompt ?? payload.prompt,
            settingPrompt: payload.setting_prompt ?? "",
            settingLabel: payload.setting_label ?? "",
            assetTag: outputTag,
            taskId: "",
            generationStatus: "submitting",
          },
          items: ["提交 Lovart 任务中", "参考素材已带入", outputSummary],
        },
      }),
    });
    scheduleAutoSave(get);

    try {
      const created = await generateImage(payload);
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            metric: "Lovart 已排队",
            config: { taskId: created.id, generationStatus: created.status },
            items: ["Lovart 生成中", "正在获取结果", outputSummary],
          },
        }),
      });
      scheduleAutoSave(get);

      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const status = await getImageGenerationStatus(created.id, {
          model: payload.model,
          flowId: payload.flowId,
          nodeId,
        });

        if (status.status === "completed" && status.assets.length > 0) {
          const images: ImageAssetItem[] = status.assets.map((asset, index) => ({
            id: asset.id || `lovart-${created.id}-${index + 1}`,
            assetId: asset.id,
            name: asset.title || `Lovart 生成图 ${index + 1}`,
            url: asset.previewUrl || asset.url,
            storageKey: asset.storageKey,
            tag: outputTag,
            uploadStatus: "saved",
          }));
          images.forEach((image) => {
            if (image.assetId) {
              void updateAsset(image.assetId, { metadata: { tag: outputTag } }).catch(() => {});
            }
          });
          const primary = images[0];
          const completedConfig = {
            generationStatus: "completed",
            model: payload.model,
            ratio: payload.ratio,
            resolution: payload.resolution,
            quality: payload.quality,
            count: images.length,
            requestedCount: payload.count,
            prompt: payload.prompt,
            userPrompt: payload.user_prompt ?? payload.prompt,
            settingPrompt: payload.setting_prompt ?? "",
            settingLabel: payload.setting_label ?? "",
            images,
            primaryImageId: primary?.id ?? "",
            imageUrl: primary?.url ?? "",
            fileName: images.length === 1 ? primary?.name ?? "Lovart 生成图" : `${images.length} 张 Lovart 生成图`,
            assetTag: outputTag,
          };
          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: "done",
                ...patchGeneratedImageAssetNode(
                  { ...get().nodes.find((node) => node.id === nodeId)?.data.config, ...completedConfig },
                  outputTag
                ),
                config: completedConfig,
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }

        if (status.status === "failed") {
          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: "error",
                metric: "Lovart 生成失败",
            config: { generationStatus: "failed", error: status.error, userPrompt: payload.user_prompt ?? payload.prompt },
                items: ["生成失败", status.error || "请调整提示词或模型后重试"],
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }

        set({
          nodes: patchNodes(get().nodes, {
            [nodeId]: {
              metric: `Lovart 生成中 ${attempt + 1}/36`,
              config: { generationStatus: status.status },
              items: ["Lovart 生成中", "正在获取结果", outputSummary],
            },
          }),
        });
      }

      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "queued",
            metric: "Lovart 仍在生成",
            config: { generationStatus: "timeout", taskId: created.id, userPrompt: payload.user_prompt ?? payload.prompt },
            items: ["生成仍在进行", "稍后可重试查询结果", outputSummary],
          },
        }),
      });
      scheduleAutoSave(get);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lovart 图片生成失败";
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "error",
            metric: "Lovart 生成失败",
            config: { generationStatus: "failed", error: message, userPrompt: payload.user_prompt ?? payload.prompt },
            items: [message.slice(0, 80), "请检查 Lovart key / 模型 / 参数"],
          },
        }),
      });
      scheduleAutoSave(get);
    }
  },

  runSeedanceGeneration: async (sourceAnalysisNodeId, payload) => {
    const current = get();
    const sourceNode = current.nodes.find((node) => node.id === sourceAnalysisNodeId);
    if (!sourceNode) return;
    const generationKey = videoGenerationKey(sourceAnalysisNodeId, payload);
    if (activeVideoGenerationKeys.has(generationKey)) return;
    activeVideoGenerationKeys.add(generationKey);

    const updateCurrentVideoNode = sourceNode.type === "videoGeneration" && payload.overwrite_current === true;
    const reuseCurrentActiveVideoNode = sourceNode.type === "videoGeneration" && isActiveVideoNode(sourceNode);
    let targetId = updateCurrentVideoNode
      ? sourceAnalysisNodeId
      : reuseCurrentActiveVideoNode
        ? sourceAnalysisNodeId
        : sourceNode.type === "videoGeneration"
        ? ""
        : findSeedanceTargetId(current.nodes, current.edges, sourceAnalysisNodeId);
    if (!targetId && sourceNode.type !== "videoGeneration") {
      const activeTarget = current.edges
        .filter((edge) => edge.source === sourceAnalysisNodeId)
        .map((edge) => current.nodes.find((node) => node.id === edge.target))
        .find((node) => isActiveVideoNode(node));
      if (activeTarget) targetId = activeTarget.id;
    }
    let nodes = current.nodes;
    let edges = current.edges;
    const referenceImageCount = payload.reference_images?.filter((item) => item.trim()).length ?? 0;
    const hasScriptContext = payload.prompt.includes("上游剧本") || payload.prompt.includes("剧本 ");
    const contextItem =
      referenceImageCount > 0 || hasScriptContext
        ? `全链路引用：${referenceImageCount}张图片${hasScriptContext ? " · 剧本已合并" : ""}`
        : "等待上游素材";
    const specItems = payload.generation_spec?.items?.length
      ? payload.generation_spec.items.slice(0, 2)
      : ["保持角色一致性", contextItem];

    if (!targetId) {
      targetId = `seedance-result-${Date.now()}-${seedanceNodeCounter++}`;
      nodes = [...nodes, createSeedanceNode(sourceNode, targetId, payload)];
      edges = [
        ...edges,
        {
          id: `e-${sourceAnalysisNodeId}-${targetId}`,
          source: sourceAnalysisNodeId,
          target: targetId,
          type: "default",
          animated: true,
        },
      ];
    } else if (!updateCurrentVideoNode && targetId !== sourceAnalysisNodeId) {
      const offsetX = sourceNode.type === "doubaoAnalysis" ? 1240 : 360;
      nodes = nodes.map((node) =>
        node.id === targetId
          ? {
              ...node,
              position: {
                x: sourceNode.position.x + offsetX,
                y: sourceNode.position.y + 20,
              },
            }
          : node
      );
    }

    set({
      nodes: patchNodes(nodes, {
        [targetId]: {
          label: videoModelLabel(payload.model),
          status: "running",
          metric: "提交生成任务中",
          accent: "#8B5CF6",
          config: {
            sourceAnalysisNodeId,
            model: payload.model,
            ratio: payload.ratio,
            resolution: payload.resolution,
            seconds: payload.seconds,
            generate_audio: payload.generate_audio,
            prompt: payload.prompt,
            userPrompt: payload.user_prompt ?? "",
            referenceImages: payload.reference_images,
            referenceImageCount,
            generationSpec: payload.generation_spec,
            targetShots: payload.generation_spec?.target_shots ?? [],
            intentSummary: payload.generation_spec?.intent_summary ?? "",
            selectedScript: payload.generation_spec?.selected_script ?? "",
            videoUrl: "",
            taskId: "",
            assetId: "",
            projectVideoAssetId: "",
            assetSaveStatus: "",
            projectVideoCacheStatus: "",
            addedToAssets: false,
            status: "submitting",
            error: "",
            overwriteCurrent: false,
          },
          items: ["正在提交视频生成任务", ...specItems.slice(0, 1), `${payload.seconds}s / ${payload.ratio}`],
        },
      }),
      edges,
    });
    scheduleAutoSave(get);

    try {
      const created = await generateVideo(payload);
      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            status: "running",
            metric: created.status || "in_queue",
            config: {
              taskId: created.id,
              model: created.model,
              status: created.status || "in_queue",
              error: "",
              referenceImages: payload.reference_images,
              referenceImageCount,
              generationSpec: payload.generation_spec,
              userPrompt: payload.user_prompt ?? "",
              overwriteCurrent: false,
            },
            items: ["任务已提交，等待生成结果", `任务 ID：${created.id}`, `${payload.seconds}s / ${payload.ratio}`],
          },
        }),
      });
      scheduleAutoSave(get);

      let pollFailures = 0;
      for (let index = 0; index < 90; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        let status;
        try {
          status = await getVideoGenerationStatus(created.id);
          pollFailures = 0;
        } catch (pollError) {
          pollFailures += 1;
          const message = pollError instanceof Error ? pollError.message : "状态查询失败";
          set({
            nodes: patchNodes(get().nodes, {
              [targetId]: {
                status: pollFailures >= 6 ? "queued" : "running",
                metric: pollFailures >= 6 ? "等待恢复查询" : "状态查询重试中",
                config: {
                  taskId: created.id,
                  status: "polling_retry",
                  error: message,
                  referenceImages: payload.reference_images,
                  referenceImageCount,
                  generationSpec: payload.generation_spec,
                },
                items: [
                  "任务已提交，正在恢复状态查询",
                  `任务 ID：${created.id}`,
                  `${payload.seconds}s / ${payload.ratio} · ${payload.resolution}`,
                ],
              },
            }),
          });
          scheduleAutoSave(get);
          if (pollFailures >= 6) return;
          continue;
        }
        const nodeStatus = status.status === "completed" ? "done" : status.status === "failed" ? "error" : "running";

        set({
          nodes: patchNodes(get().nodes, {
            [targetId]: {
              status: nodeStatus,
              metric: status.status,
              config: {
                taskId: created.id,
                status: status.status,
                referenceImages: payload.reference_images,
                referenceImageCount,
                generationSpec: payload.generation_spec,
              },
              items: [
                status.status === "completed" ? "生成完成" : "生成任务处理中",
                specItems[0] ?? contextItem,
                `${payload.seconds}s / ${payload.ratio} · ${payload.resolution}`,
              ],
            },
          }),
        });
        scheduleAutoSave(get);

        if (status.status === "completed") {
          const fallbackUrl = videoPlaybackUrlFromStatus(status, created.id);
          set({
            nodes: patchNodes(get().nodes, {
              [targetId]: {
                status: "done",
                metric: "生成完成",
                config: {
                  taskId: created.id,
                  status: "completed",
                  error: "",
                  videoUrl: fallbackUrl,
                  projectVideoCacheStatus: "saving",
                  referenceImages: payload.reference_images,
                  referenceImageCount,
                  userPrompt: payload.user_prompt ?? "",
                  generationSpec: payload.generation_spec,
                  overwriteCurrent: false,
                },
                items: [
                  "查看生成视频",
                  "正在缓存生成视频",
                  `${payload.seconds}s / ${payload.ratio} · ${payload.resolution}`,
                ],
              },
            }),
          });
          scheduleAutoSave(get);

          let playbackUrl = fallbackUrl;
          let projectVideoAssetId = "";
          let cacheStatus = "failed";
          let cacheError = "";
          try {
            const cached = await cacheProjectVideoPlayback({
              taskId: created.id,
              flowId: get().flowId,
              nodeId: targetId,
              title: String(payload.generation_spec?.intent_summary || "项目生成视频"),
              ratio: payload.ratio,
              resolution: payload.resolution,
              seconds: payload.seconds,
              metadata: {
                prompt: payload.prompt,
                model: payload.model,
                scope: "project",
              },
            });
            playbackUrl = cached.playbackUrl;
            projectVideoAssetId = cached.asset.id;
            cacheStatus = "saved";
          } catch (cacheErrorValue) {
            cacheError = cacheErrorValue instanceof Error ? cacheErrorValue.message : "生成视频缓存失败";
          }

          set({
            nodes: patchNodes(get().nodes, {
              [targetId]: {
                status: "done",
                metric: cacheStatus === "saved" ? "生成完成" : "生成完成，缓存失败",
                config: {
                  taskId: created.id,
                  status: "completed",
                  videoUrl: playbackUrl,
                  projectVideoAssetId,
                  projectVideoCacheStatus: cacheStatus,
                  projectVideoCacheError: cacheError,
                  referenceImages: payload.reference_images,
                  referenceImageCount,
                  userPrompt: payload.user_prompt ?? "",
                  generationSpec: payload.generation_spec,
                  overwriteCurrent: false,
                },
                items: [
                  "查看生成视频",
                  "加入制作资产",
                  `${payload.seconds}s / ${payload.ratio} · ${payload.resolution}`,
                ],
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }

        if (status.status === "failed") {
          const message = typeof status.error === "string" && status.error.trim()
            ? status.error.trim()
            : "请调整提示词或参数后重试";
          set({
            nodes: patchNodes(get().nodes, {
              [targetId]: {
                status: "error",
                metric: "生成失败",
                config: {
                  taskId: created.id,
                  status: "failed",
                  error: message,
                  referenceImages: payload.reference_images,
                  referenceImageCount,
                  generationSpec: payload.generation_spec,
                },
                items: ["生成失败", message.slice(0, 80), "请调整提示词或参数后重试"],
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }
      }

      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            status: "queued",
            metric: "等待生成完成",
            config: {
              taskId: created.id,
              status: "timeout",
              referenceImages: payload.reference_images,
              referenceImageCount,
              generationSpec: payload.generation_spec,
            },
            items: ["生成仍在进行", "稍后可重试查询结果", `${payload.seconds}s / ${payload.ratio}`],
          },
        }),
      });
      scheduleAutoSave(get);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Seedance 视频生成失败";
      set({
        nodes: patchNodes(get().nodes, {
          [targetId]: {
            status: "error",
            metric: "生成失败",
            config: {
              status: "failed",
              failurePhase: "create_task",
              error: message,
              model: payload.model,
              ratio: payload.ratio,
              resolution: payload.resolution,
              seconds: payload.seconds,
              generate_audio: payload.generate_audio,
              prompt: payload.prompt,
              referenceImages: payload.reference_images,
              referenceImageCount,
              generationSpec: payload.generation_spec,
            },
            items: ["任务创建失败", message.slice(0, 80), "请检查 TokenOps key / 余额 / 参数"],
          },
        }),
      });
      scheduleAutoSave(get);
    } finally {
      activeVideoGenerationKeys.delete(generationKey);
    }
  },

  recoverVideoGeneration: async (nodeId) => {
    if (activeVideoRecoveryNodeIds.has(nodeId)) return;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "videoGeneration") return;
    const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId : "";
    if (!taskId) return;
    activeVideoRecoveryNodeIds.add(nodeId);
    const ratio = String(node.data.config.ratio || "");
    const resolution = String(node.data.config.resolution || "");
    const seconds = String(node.data.config.seconds || "");

    try {
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "running",
            metric: "恢复状态查询",
            config: { status: "polling_retry", error: "" },
            items: ["正在恢复生成结果", `任务 ID：${taskId}`, [seconds, ratio, resolution].filter(Boolean).join(" / ")],
          },
        }),
      });
      scheduleAutoSave(get);

      let pollFailures = 0;
      for (let index = 0; index < 90; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 250 : 5000));
        let status;
        try {
          status = await getVideoGenerationStatus(taskId);
          pollFailures = 0;
        } catch (error) {
          pollFailures += 1;
          const message = error instanceof Error ? error.message : "状态查询失败";
          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: pollFailures >= 6 ? "queued" : "running",
                metric: pollFailures >= 6 ? "等待恢复查询" : "状态查询重试中",
                config: { status: "polling_retry", error: message },
                items: ["恢复查询结果", `任务 ID：${taskId}`, message.slice(0, 60)],
              },
            }),
          });
          scheduleAutoSave(get);
          if (pollFailures >= 6) return;
          continue;
        }

        if (status.status === "completed") {
          const fallbackUrl = videoPlaybackUrlFromStatus(status, taskId);
          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: "done",
                metric: "生成完成",
                config: {
                  status: "completed",
                  error: "",
                  videoUrl: fallbackUrl,
                  projectVideoCacheStatus: "saving",
                  overwriteCurrent: false,
                },
                items: ["查看生成视频", "正在缓存生成视频", [seconds, ratio, resolution].filter(Boolean).join(" / ")],
              },
            }),
          });
          scheduleAutoSave(get);

          let playbackUrl = fallbackUrl;
          let projectVideoAssetId = "";
          let cacheStatus = "failed";
          let cacheError = "";
          const generationSpec = node.data.config.generationSpec;
          const intentSummary =
            generationSpec && typeof generationSpec === "object" && "intent_summary" in generationSpec
              ? String((generationSpec as { intent_summary?: unknown }).intent_summary || "")
              : "";
          try {
            const cached = await cacheProjectVideoPlayback({
              taskId,
              flowId: get().flowId,
              nodeId,
              title: String(intentSummary || node.data.label || "项目生成视频"),
              ratio,
              resolution,
              seconds,
              metadata: {
                prompt: node.data.config.prompt,
                model: node.data.config.model,
                scope: "project",
              },
            });
            playbackUrl = cached.playbackUrl;
            projectVideoAssetId = cached.asset.id;
            cacheStatus = "saved";
          } catch (cacheErrorValue) {
            cacheError = cacheErrorValue instanceof Error ? cacheErrorValue.message : "生成视频缓存失败";
          }

          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: "done",
                metric: cacheStatus === "saved" ? "生成完成" : "生成完成，缓存失败",
                config: {
                  status: "completed",
                  error: "",
                  videoUrl: playbackUrl,
                  projectVideoAssetId,
                  projectVideoCacheStatus: cacheStatus,
                  projectVideoCacheError: cacheError,
                  overwriteCurrent: false,
                },
                items: [
                  "查看生成视频",
                  "加入制作资产",
                  [seconds, ratio, resolution].filter(Boolean).join(" / "),
                ],
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }

        if (status.status === "failed") {
          const message = typeof status.error === "string" && status.error.trim()
            ? status.error.trim()
            : "请调整提示词或参数后重试";
          set({
            nodes: patchNodes(get().nodes, {
              [nodeId]: {
                status: "error",
                metric: "生成失败",
                config: { status: "failed", error: message },
                items: ["生成失败", message.slice(0, 80), "请调整提示词或参数后重试"],
              },
            }),
          });
          scheduleAutoSave(get);
          return;
        }

        set({
          nodes: patchNodes(get().nodes, {
            [nodeId]: {
              status: "running",
              metric: status.status,
              config: { status: status.status, error: "" },
              items: ["生成任务处理中", `任务 ID：${taskId}`, [seconds, ratio, resolution].filter(Boolean).join(" / ")],
            },
          }),
        });
        scheduleAutoSave(get);
      }

      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "queued",
            metric: "等待生成完成",
            config: { status: "timeout" },
            items: ["恢复查询结果", `任务 ID：${taskId}`, "生成仍在进行，可稍后再查"],
          },
        }),
      });
      scheduleAutoSave(get);
    } finally {
      activeVideoRecoveryNodeIds.delete(nodeId);
    }
  },

  ensureProjectVideoCache: async (nodeId) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "videoGeneration") return;
    const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId.trim() : "";
    if (!taskId) return;
    if (typeof node.data.config.assetId === "string" && node.data.config.assetId) return;
    if (typeof node.data.config.projectVideoAssetId === "string" && node.data.config.projectVideoAssetId) return;
    if (node.data.config.projectVideoCacheStatus === "saving") return;

    const ratio = String(node.data.config.ratio || "");
    const resolution = String(node.data.config.resolution || "");
    const seconds = String(node.data.config.seconds || "");
    const metaLine = [seconds, ratio, resolution].filter(Boolean).join(" / ");

    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: {
          metric: "正在缓存生成视频",
          config: { projectVideoCacheStatus: "saving", projectVideoCacheError: "" },
          items: ["查看生成视频", "正在缓存生成视频", ...(node.data.items ?? []).filter((item) => item !== "查看生成视频")],
        },
      }),
    });
    scheduleAutoSave(get);

    try {
      const cached = await cacheProjectVideoPlayback({
        taskId,
        flowId: get().flowId,
        nodeId,
        title: String(node.data.label || "项目生成视频"),
        ratio,
        resolution,
        seconds,
        metadata: {
          prompt: node.data.config.prompt,
          model: node.data.config.model,
          scope: "project",
        },
      });
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            status: "done",
            metric: "生成完成",
            config: {
              status: "completed",
              error: "",
              videoUrl: cached.playbackUrl,
              projectVideoAssetId: cached.asset.id,
              projectVideoCacheStatus: "saved",
              projectVideoCacheError: "",
              overwriteCurrent: false,
            },
            items: ["查看生成视频", "加入制作资产", metaLine].filter(Boolean),
          },
        }),
      });
      scheduleAutoSave(get);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成视频缓存失败";
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            metric: "生成完成，缓存失败",
            config: { projectVideoCacheStatus: "failed", projectVideoCacheError: message, overwriteCurrent: false },
            items: ["查看生成视频", "加入制作资产", metaLine].filter(Boolean),
          },
        }),
      });
      scheduleAutoSave(get);
    }
  },

  addGeneratedVideoToAssets: async (nodeId) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "videoGeneration") return;
    if (node.data.config.addedToAssets === true) return;

    const taskId = typeof node.data.config.taskId === "string" ? node.data.config.taskId : "";
    if (!taskId) {
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            metric: "缺少生成任务 ID",
            items: ["无法保存到云存储", "请重新生成视频"],
          },
        }),
      });
      scheduleAutoSave(get);
      return;
    }

    set({
      nodes: patchNodes(get().nodes, {
        [nodeId]: {
          metric: "正在加入制作资产",
          config: { assetSaveStatus: "saving" },
          items: ["查看生成视频", "正在加入制作资产"],
        },
      }),
    });
    scheduleAutoSave(get);

    try {
      const asset = await createFinishedVideoAsset({
        taskId,
        flowId: get().flowId,
        nodeId,
        title: String(node.data.label || "生成成片"),
        ratio: String(node.data.config.ratio || ""),
        resolution: String(node.data.config.resolution || ""),
        seconds: String(node.data.config.seconds || ""),
        metadata: {
          prompt: node.data.config.prompt,
          model: node.data.config.model,
        },
      });
      const playbackUrl = resolveMediaUrl(asset.previewUrl || `/api/assets/${asset.id}/public-content`);
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            metric: "已加入制作资产",
            config: {
              addedToAssets: true,
              assetType: "finishedVideo",
              assetTitle: asset.title || node.data.label,
              assetId: asset.id,
              assetStorageKey: asset.storageKey,
              assetPublicUrl: asset.publicUrl,
              videoUrl: playbackUrl,
              assetSaveStatus: "saved",
              addedAt: new Date().toISOString(),
              overwriteCurrent: false,
            },
            items: ["查看生成视频", "已加入制作资产"],
          },
        }),
      });
      scheduleAutoSave(get);
    } catch (error) {
      const message = error instanceof Error ? error.message : "成片保存到资产库失败";
      set({
        nodes: patchNodes(get().nodes, {
          [nodeId]: {
            metric: "加入资产失败",
            config: { assetSaveStatus: "failed", assetSaveError: message },
            items: ["查看生成视频", "加入制作资产", message.slice(0, 28)],
          },
        }),
      });
      scheduleAutoSave(get);
    }
  },

  generateAssets: () => {
    set({
      nodes: patchNodes(get().nodes, {
        "character-asset": {
          status: "done",
          metric: "Maya_v02 locked",
          config: { model: "Seedream 2.0", locked: true },
          items: ["Maya_v02 已锁定", "表情包 6", "动作姿态 4"],
        },
        "scene-asset": {
          status: "done",
          metric: "Cafe_Night_v02 locked",
          config: { model: "Image-2", locked: true },
          items: ["Cafe_Night_v02", "Rain_Street_v02", "Neon_Window_v01"],
        },
        "prop-asset": {
          status: "done",
          metric: "12 assets locked",
          config: { model: "Seedream 2.0", locked: true },
          items: ["BlueCup_v03", "Logo plate", "Product pack", "Shoe hero"],
        },
        "video-generation": { status: "ready" },
      }),
    });
    scheduleAutoSave(get);
  },

  generateClip: () => {
    set({
      nodes: patchNodes(get().nodes, {
        "video-generation": {
          status: "done",
          metric: "8 / 8 clips generated",
          config: { model: "Seedance 2.0", generated: 8, total: 8 },
          items: ["S01-S08 complete", "角色一致性通过", "等待导出"],
        },
        timeline: {
          status: "done",
          metric: "8 / 8 clips",
          config: { clips: 8, total: 8 },
          items: ["S01 complete", "S02 complete", "S03 complete", "S08 complete"],
        },
      }),
    });
    scheduleAutoSave(get);
  },

  setFlowName: (name) => {
    set({ flowName: name });
    scheduleAutoSave(get);
  },

  loadFlow: async (id: string) => {
    const record = await getFlow(id);
    const nodes = record.nodes as Node<NodeData>[];
    set({
      flowId: record.id,
      flowName: record.name,
      nodes,
      edges: curvedEdges(record.edges as Edge[]),
    });
    queueVideoGenerationRecovery(get, pendingVideoGenerationNodeIds(nodes));
    queueProjectVideoCache(get, pendingProjectVideoCacheNodeIds(nodes));
  },

  loadLatest: async () => {
    try {
      const flows = await listFlows();
      if (flows.length > 0) {
        const record = await getFlow(flows[0].id);
        const nodes = record.nodes as Node<NodeData>[];
        set({
          flowId: record.id,
          flowName: record.name,
          nodes,
          edges: curvedEdges(record.edges as Edge[]),
        });
        queueVideoGenerationRecovery(get, pendingVideoGenerationNodeIds(nodes));
        queueProjectVideoCache(get, pendingProjectVideoCacheNodeIds(nodes));
      } else {
        get().ensureVideoMvp();
      }
    } catch {
      get().ensureVideoMvp();
    }
  },

  persistFlow: async () => {
    const { flowId, flowName, nodes, edges } = get();
    set({ saving: true, saveError: null });
    try {
      const payload = { name: flowName, nodes, edges: curvedEdges(edges) };
      if (flowId) {
        await saveFlow(flowId, payload);
      } else {
        const record = await createFlow(payload);
        set({ flowId: record.id });
      }
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Save failed" });
    } finally {
      set({ saving: false });
    }
  },
}));
