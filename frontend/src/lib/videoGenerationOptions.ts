import type { VideoModelOption } from "@/lib/api";

export type VideoGenerationMode = "reference" | "edit" | "first-last";

export type VideoGenerationParams = {
  mode: VideoGenerationMode;
  ratio: string;
  resolution: "480p" | "720p" | "1080p" | "4k";
  seconds: 4 | 5 | 6 | 8 | 10 | 15;
  generate_audio: boolean;
  camerafixed: boolean;
};

export const defaultVideoModel = "seedance-2-0-fast";

export const hiddenVideoModels = new Set([
  "wan2.2-i2v-spicy",
  "wan2.7-i2v-spicy",
  "doubao-seedance-1-5-pro-251215",
]);

export const fallbackVideoModels: VideoModelOption[] = [
  { model: "veo-3.1-fast-generate-001", label: "Veo 3.1 Fast · Vertex AI" },
  { model: "bds-pro", label: "MiniMax h3" },
  { model: "seedance-2-0", label: "Seedance 2.0" },
  { model: "seedance-2-0-fast", label: "Seedance 2.0 Fast" },
  { model: "seedance-2-0-mini", label: "Seedance 2.0 Mini" },
  { model: "kling-3-0", label: "Kling 3.0" },
  { model: "kling-3-0-omni", label: "Kling 3.0 Omni" },
  { model: "veo-3-1", label: "Veo 3.1" },
  { model: "veo-3-1-fast", label: "Veo 3.1 Fast" },
  { model: "gemini-omni-flash", label: "Gemini Omni Flash" },
];

export const videoModelMeta: Record<string, { description: string; chip: string }> = {
  "veo-3.1-fast-generate-001": { description: "Google Vertex AI 官方图文生视频，支持首帧图片、原生音频、横竖画幅与 720p/1080p。", chip: "Vertex" },
  "bds-pro": { description: "MiniMax H3 多参图生视频，支持首帧、主体、脸部、背景、姿态、尾帧等多图参考。", chip: "60s" },
  "seedance-2-0": { description: "支持多图参考。适合人物/场景/道具多素材合成，运动和叙事均衡。", chip: "60s" },
  "seedance-2-0-fast": { description: "支持多图参考。更快出片，适合6图参考的快速预览和多轮试错。", chip: "35s" },
  "seedance-2-0-mini": { description: "支持多图参考。轻量低成本，适合草稿验证，不追求最高质感。", chip: "25s" },
  "kling-3-0": { description: "支持多图参考。强运动表现，适合人物动作、镜头推进和动态转场。", chip: "60s" },
  "kling-3-0-omni": { description: "支持多图参考。多模态素材适配强，适合复杂参考图和角色一致性尝试。", chip: "60s" },
  "veo-3-1": { description: "支持多图参考。电影感和复杂场景更强，适合高质量成片探索。", chip: "90s" },
  "veo-3-1-fast": { description: "支持多图参考。Veo 快速模式，适合批量方向测试。", chip: "50s" },
  "gemini-omni-flash": { description: "支持多图参考。快速多模态生成与理解，适合轻量创意预览。", chip: "35s" },
};

export const videoModes: Array<{ value: VideoGenerationMode; label: string }> = [
  { value: "reference", label: "参考图/视频" },
  { value: "edit", label: "视频编辑" },
  { value: "first-last", label: "首尾帧" },
];

export const videoRatios = ["Auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
export const videoResolutions: VideoGenerationParams["resolution"][] = ["480p", "720p", "1080p", "4k"];
export const videoSeconds: VideoGenerationParams["seconds"][] = [4, 5, 6, 8, 10, 15];

export function isVertexVeoModel(model: string) {
  return model === "veo-3.1-fast-generate-001";
}

export function videoReferenceImagesForModel(model: string, references: string[]) {
  if (!isVertexVeoModel(model)) return references;
  return references.filter((reference) => reference.trim()).slice(0, 1);
}

export function videoRatiosForModel(model: string) {
  return isVertexVeoModel(model) ? ["16:9", "9:16"] : videoRatios;
}

export function videoResolutionsForModel(model: string): VideoGenerationParams["resolution"][] {
  return isVertexVeoModel(model) ? ["720p", "1080p"] : videoResolutions;
}

export function videoSecondsForModel(model: string): VideoGenerationParams["seconds"][] {
  return isVertexVeoModel(model) ? [4, 6, 8] : videoSeconds;
}

export function modelLabel(options: Array<{ model: string; label: string }>, model: string, fallback: string) {
  if (model === "bds-pro") return "MiniMax h3";
  return options.find((option) => option.model === model)?.label ?? (model || fallback);
}

export function normalizeVideoModelOptions(options: VideoModelOption[]) {
  return options
    .filter((option) => !hiddenVideoModels.has(option.model))
    .map((option) => (option.model === "bds-pro" ? { ...option, label: "MiniMax h3" } : option));
}

export function resolveDefaultVideoModel(defaultModel: string | undefined, options: VideoModelOption[]) {
  const visible = normalizeVideoModelOptions(options);
  if (defaultModel && !hiddenVideoModels.has(defaultModel) && visible.some((option) => option.model === defaultModel)) {
    return defaultModel;
  }
  return visible[0]?.model || defaultVideoModel;
}

export function normalizeVideoParamsForModel(model: string, params: VideoGenerationParams): VideoGenerationParams {
  if (isVertexVeoModel(model)) {
    return {
      ...params,
      mode: "reference",
      ratio: params.ratio === "16:9" ? "16:9" : "9:16",
      resolution: params.resolution === "1080p" ? "1080p" : "720p",
      seconds: params.seconds === 4 || params.seconds === 6 ? params.seconds : 8,
    };
  }
  return {
    ...params,
    ratio: params.ratio === "Auto" ? "9:16" : params.ratio,
  };
}
