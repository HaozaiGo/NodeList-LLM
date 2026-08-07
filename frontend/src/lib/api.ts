const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function isAuthExpiredError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    /user not found|invalid token|expired/i.test(error.message)
  );
}

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("nodelist_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshAuthToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const token = localStorage.getItem("nodelist_token");
  if (!token) return false;

  const response = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return false;

  const data = (await response.json()) as AuthResponse;
  localStorage.setItem("nodelist_token", data.access_token);
  localStorage.setItem("nodelist_user_id", data.user_id);
  localStorage.setItem("nodelist_email", data.email);
  return true;
}

async function fetchWithAuthRetry(input: string, init: RequestInit = {}): Promise<Response> {
  const withAuth = (requestInit: RequestInit): RequestInit => ({
    ...requestInit,
    headers: { ...(requestInit.headers ?? {}), ...authHeaders() },
  });

  let response = await fetch(input, withAuth(init));
  if (response.status !== 401) return response;

  const refreshed = await refreshAuthToken();
  if (!refreshed) return response;

  response = await fetch(input, withAuth(init));
  return response;
}

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : fallbackMessage;
    throw new ApiError(detail, response.status);
  }

  return data as T;
}

export interface FlowPayload {
  name?: string;
  nodes: unknown[];
  edges: unknown[];
}

export interface FlowRecord extends FlowPayload {
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AuthResponse {
  access_token: string;
  user_id: string;
  email: string;
}

export interface VideoAnalysisResponse {
  model: string;
  file_uri: string;
  mime_type: string;
  content: string;
  duration: number;
  segments: unknown[];
  transcript: unknown;
  summary: string;
  shots: number;
  characters: number;
  props: number;
  scenes: string[];
  items: string[];
  storyboard: string[];
  raw: unknown;
}

export interface VideoGeneratePayload {
  prompt: string;
  user_prompt?: string;
  model: string;
  ratio: string;
  resolution: string;
  seconds: number;
  generate_audio: boolean;
  watermark: boolean;
  camerafixed: boolean;
  reference_images?: string[];
  generation_spec?: VideoGenerationSpec;
  overwrite_current?: boolean;
}

export interface VideoGenerateResponse {
  id: string;
  object?: string;
  model: string;
  status: string;
  request?: Record<string, unknown>;
}

export interface VideoGenerationStatus {
  id: string;
  object?: string;
  model?: string;
  status: string;
  content_path?: string;
  error?: unknown;
  usage?: unknown;
}

export interface VideoSpecParams {
  ratio: string;
  resolution: string;
  seconds: number;
  generate_audio: boolean;
  camerafixed: boolean;
}

export interface VideoSpecContextItem {
  label: string;
  text: string;
}

export interface VideoGenerationSpecPayload {
  user_prompt: string;
  model: string;
  params: VideoSpecParams;
  scripts: VideoSpecContextItem[];
  summaries: VideoSpecContextItem[];
  reference_image_count: number;
}

export interface VideoGenerationSpec {
  model: string;
  target_shots: number[];
  intent_summary: string;
  selected_script: string;
  generation_prompt: string;
  negative_prompt: string;
  items: string[];
  fallback?: boolean;
}

export interface VideoModelOption {
  model: string;
  label: string;
}

export interface VideoModelsResponse {
  models: VideoModelOption[];
  default: string;
}

export interface ImageModelOption {
  model: string;
  label: string;
}

export interface ImageModelsResponse {
  models: ImageModelOption[];
  default: string;
}

export interface ImageGeneratePayload {
  prompt: string;
  user_prompt?: string;
  setting_prompt?: string;
  setting_label?: string;
  asset_tag?: "reference" | "character" | "scene" | "prop";
  model: string;
  ratio: string;
  resolution: string;
  quality?: string;
  count?: number;
  reference_images: string[];
  flowId?: string | null;
  nodeId?: string | null;
}

export interface ImageGenerateResponse {
  id: string;
  model: string;
  status: string;
  projectId?: string | null;
}

export interface GeneratedImageAsset {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  storageKey: string;
}

export interface ImageGenerationStatus {
  id: string;
  model?: string | null;
  status: string;
  imageUrls: string[];
  assets: GeneratedImageAsset[];
  error?: string | null;
  raw?: unknown;
}

export interface TextGeneratePayload {
  prompt_text: string;
  doubao_instruction?: string;
  model?: string;
}

export interface AssetRecord {
  id: string;
  kind: string;
  title: string;
  mimeType: string;
  storageKey: string;
  publicUrl: string;
  url: string;
  downloadUrl: string;
  previewUrl: string;
  sizeBytes: number;
  provider: string;
  remoteId: string | null;
  flowId: string | null;
  nodeId: string | null;
  metadata: Record<string, unknown>;
}

export interface FinishedVideoAssetPayload {
  taskId: string;
  flowId?: string | null;
  nodeId?: string | null;
  title?: string;
  ratio?: string;
  resolution?: string;
  seconds?: string | number;
  metadata?: Record<string, unknown>;
}

export type ProjectVideoCachePayload = FinishedVideoAssetPayload;

export interface UploadAssetPayload {
  file: File;
  kind?: string;
  flowId?: string | null;
  nodeId?: string | null;
  title?: string;
  tag?: string;
}

export interface AdminSummary {
  users: number;
  active_users: number;
  disabled_users: number;
  total_credits: number;
  flows: number;
  assets: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin";
  credit_balance: number;
  disabled: boolean;
  created_at: string | null;
  flows: number;
  assets: number;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  user_email: string;
  admin_id: string | null;
  admin_email: string | null;
  amount: number;
  balance_after: number;
  transaction_type: string;
  note: string;
  created_at: string | null;
}

export interface CreditAdjustResponse {
  user: AdminUser;
  transaction: CreditTransaction;
}

export function resolveMediaUrl(url: string): string {
  if (!url) return "";
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  try {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail ?? "Register failed");
    return data;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("注册失败，请检查网络或稍后重试");
  }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail ?? "Login failed");
    return data;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("登录失败，请检查网络或稍后重试");
  }
}

export async function listFlows(): Promise<FlowRecord[]> {
  const r = await fetchWithAuthRetry(`${BASE}/api/flows`);
  return readJsonOrThrow<FlowRecord[]>(r, "Failed to list flows");
}

export async function createFlow(payload: FlowPayload): Promise<FlowRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<FlowRecord>(r, "Failed to create flow");
}

export async function saveFlow(id: string, payload: FlowPayload): Promise<FlowRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/flows/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<FlowRecord>(r, "Failed to save flow");
}

export async function getFlow(id: string): Promise<FlowRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/flows/${id}`);
  return readJsonOrThrow<FlowRecord>(r, "Flow not found");
}

export async function deleteFlow(id: string): Promise<void> {
  const r = await fetchWithAuthRetry(`${BASE}/api/flows/${id}`, {
    method: "DELETE",
  });
  if (!r.ok) await readJsonOrThrow(r, "Failed to delete flow");
}

export async function listAssets(params: { kind?: string; flowId?: string | null } = {}): Promise<AssetRecord[]> {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.flowId) query.set("flowId", params.flowId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const r = await fetchWithAuthRetry(`${BASE}/api/assets/${suffix}`);
  return readJsonOrThrow<AssetRecord[]>(r, "Failed to list assets");
}

export async function createFinishedVideoAsset(payload: FinishedVideoAssetPayload): Promise<AssetRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/assets/finished-video/from-tokenops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<AssetRecord>(r, "成片保存到资产库失败");
}

export async function createProjectVideoCache(payload: ProjectVideoCachePayload): Promise<AssetRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/assets/project-video/from-generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<AssetRecord>(r, "生成视频缓存失败");
}

export async function updateAsset(
  assetId: string,
  payload: { title?: string; metadata?: Record<string, unknown> }
): Promise<AssetRecord> {
  const r = await fetchWithAuthRetry(`${BASE}/api/assets/${assetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<AssetRecord>(r, "资产更新失败");
}

export async function uploadAsset(payload: UploadAssetPayload): Promise<AssetRecord> {
  const body = new FormData();
  body.append("file", payload.file);
  body.append("kind", payload.kind ?? "image");
  if (payload.flowId) body.append("flowId", payload.flowId);
  if (payload.nodeId) body.append("nodeId", payload.nodeId);
  if (payload.title) body.append("title", payload.title);
  if (payload.tag) body.append("tag", payload.tag);

  const r = await fetchWithAuthRetry(`${BASE}/api/assets/upload`, {
    method: "POST",
    body,
  });
  return readJsonOrThrow<AssetRecord>(r, "素材上传失败");
}

export async function analyzeVideo(file: File): Promise<VideoAnalysisResponse> {
  const body = new FormData();
  body.append("file", file);
  const r = await fetchWithAuthRetry(`${BASE}/api/video/analyze`, {
    method: "POST",
    body,
  });
  return readJsonOrThrow<VideoAnalysisResponse>(r, "视频分析失败");
}

export async function listVideoModels(): Promise<VideoModelsResponse> {
  const r = await fetchWithAuthRetry(`${BASE}/api/video/models`);
  return readJsonOrThrow<VideoModelsResponse>(r, "视频模型列表获取失败");
}

export async function createVideoGenerationSpec(
  payload: VideoGenerationSpecPayload
): Promise<VideoGenerationSpec> {
  const r = await fetchWithAuthRetry(`${BASE}/api/video/spec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<VideoGenerationSpec>(r, "视频生成意图解析失败");
}

export async function generateVideo(payload: VideoGeneratePayload): Promise<VideoGenerateResponse> {
  const requestPayload = { ...payload };
  delete requestPayload.generation_spec;
  delete requestPayload.user_prompt;
  delete requestPayload.overwrite_current;
  const r = await fetchWithAuthRetry(`${BASE}/api/video/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  return readJsonOrThrow<VideoGenerateResponse>(r, "视频生成任务创建失败");
}

export async function getVideoGenerationStatus(videoId: string): Promise<VideoGenerationStatus> {
  const r = await fetchWithAuthRetry(`${BASE}/api/video/generate/${videoId}`);
  return readJsonOrThrow<VideoGenerationStatus>(r, "视频生成状态查询失败");
}

export async function downloadGeneratedVideo(videoId: string): Promise<Blob> {
  const r = await fetchWithAuthRetry(`${BASE}/api/video/generate/${videoId}/content`);
  if (!r.ok) {
    await readJsonOrThrow<unknown>(r, "生成视频下载失败");
  }
  return r.blob();
}

export async function listImageModels(): Promise<ImageModelsResponse> {
  const r = await fetchWithAuthRetry(`${BASE}/api/image/models`);
  return readJsonOrThrow<ImageModelsResponse>(r, "图片模型列表获取失败");
}

export async function generateImage(payload: ImageGeneratePayload): Promise<ImageGenerateResponse> {
  const requestPayload = { ...payload };
  delete requestPayload.user_prompt;
  delete requestPayload.setting_prompt;
  delete requestPayload.setting_label;
  delete requestPayload.asset_tag;
  const r = await fetchWithAuthRetry(`${BASE}/api/image/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  return readJsonOrThrow<ImageGenerateResponse>(r, "图片生成任务创建失败");
}

export async function getImageGenerationStatus(
  taskId: string,
  params: { model?: string; flowId?: string | null; nodeId?: string | null } = {}
): Promise<ImageGenerationStatus> {
  const query = new URLSearchParams();
  if (params.model) query.set("model", params.model);
  if (params.flowId) query.set("flowId", params.flowId);
  if (params.nodeId) query.set("nodeId", params.nodeId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const r = await fetchWithAuthRetry(`${BASE}/api/image/generate/${taskId}${suffix}`);
  return readJsonOrThrow<ImageGenerationStatus>(r, "图片生成状态查询失败");
}

export async function streamTextGeneration(
  payload: TextGeneratePayload,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  return fetchWithAuthRetry(`${BASE}/api/text/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify(payload),
  });
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const r = await fetchWithAuthRetry(`${BASE}/api/admin/summary`);
  return readJsonOrThrow<AdminSummary>(r, "后台概览获取失败");
}

export async function listAdminUsers(params: { q?: string; limit?: number; offset?: number } = {}): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const r = await fetchWithAuthRetry(`${BASE}/api/admin/users${suffix}`);
  return readJsonOrThrow<AdminUser[]>(r, "后台用户列表获取失败");
}

export async function updateAdminUser(
  userId: string,
  payload: { role?: "user" | "admin"; disabled?: boolean }
): Promise<AdminUser> {
  const r = await fetchWithAuthRetry(`${BASE}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<AdminUser>(r, "用户更新失败");
}

export async function adjustUserCredits(
  userId: string,
  payload: { amount: number; note?: string; transaction_type?: string }
): Promise<CreditAdjustResponse> {
  const r = await fetchWithAuthRetry(`${BASE}/api/admin/users/${userId}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<CreditAdjustResponse>(r, "积分调整失败");
}

export async function listCreditTransactions(params: { userId?: string; limit?: number; offset?: number } = {}): Promise<CreditTransaction[]> {
  const query = new URLSearchParams();
  if (params.userId) query.set("user_id", params.userId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const r = await fetchWithAuthRetry(`${BASE}/api/admin/credit-transactions${suffix}`);
  return readJsonOrThrow<CreditTransaction[]>(r, "积分流水获取失败");
}

export function streamRun(
  flowId: string,
  message: string,
  onToken: (t: string) => void,
  onDone: () => void,
  onError: (e: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const r = await fetch(`${BASE}/api/playground/${flowId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) {
        onError(`HTTP ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { onDone(); return; }
          if (data.startsWith("[ERROR]")) { onError(data.slice(8)); return; }
          onToken(data);
        }
      }
      onDone();
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError(String(e));
    }
  })();

  return () => controller.abort();
}
