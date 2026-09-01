export type NodeType =
  | "chatInput"
  | "chatOutput"
  | "textInput"
  | "textOutput"
  | "url"
  | "calculator"
  | "agent"
  | "toolset"
  | "videoUpload"
  | "imageUpload"
  | "doubaoAnalysis"
  | "storyboardScript"
  | "characterAsset"
  | "sceneAsset"
  | "propAsset"
  | "videoGeneration"
  | "videoStitcher"
  | "timeline";

export type StudioNodeStatus = "idle" | "ready" | "running" | "done" | "queued" | "error";

export type ImageAssetTag = "reference" | "character" | "scene" | "prop";

export interface ImageAssetItem {
  id: string;
  assetId?: string;
  name: string;
  url: string;
  storageKey?: string;
  tag: ImageAssetTag;
  uploadStatus?: "uploading" | "saved" | "failed";
  error?: string;
  lovartSubjectId?: string;
  lovartSubjectStatus?: string;
  lovartSubjectUrl?: string;
  lovartSubjectChannel?: string;
  lovartSubjectDisplayName?: string;
  lovartSubjectError?: string;
}

export interface NodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  config: Record<string, unknown>;
  status?: StudioNodeStatus;
  metric?: string;
  accent?: string;
  items?: string[];
}

export interface ComponentDef {
  type: NodeType;
  label: string;
  description: string;
  category: string;
  icon: string;
  defaultConfig: Record<string, unknown>;
}
