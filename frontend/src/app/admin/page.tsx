"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  ImageIcon,
  ImageUp,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  WalletCards,
  X,
} from "lucide-react";

import {
  adjustUserCredits,
  getBrandingConfig,
  getAdminBillingConfig,
  getAdminSummary,
  listAdminModelRuns,
  listAdminUserFlows,
  listAdminUsersPage,
  listCreditTransactions,
  resolveMediaUrl,
  updateAdminBranding,
  updateAdminBillingConfig,
  updateAdminUser,
  type AdminFlowSummary,
  type AdminSummary,
  type AdminModelRun,
  type AdminUser,
  type BillingConfig,
  type BrandingConfig,
  type CreditTransaction,
} from "@/lib/api";
import { BrandMark } from "@/components/branding/BrandMark";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: string | null) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function shortTaskId(value: string) {
  if (!value) return "-";
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  submitting: "提交中",
  submitted: "已提交",
  pending: "等待中",
  queued: "排队中",
  in_queue: "排队中",
  running: "运行中",
  processing: "处理中",
  generating: "生成中",
  streaming: "输出中",
  polling_retry: "查询重试",
  timeout: "等待恢复",
};

const RUN_KIND_LABELS = { text: "文本", image: "图片", video: "视频" } as const;
const USERS_PER_PAGE = 30;

function RunKindIcon({ kind }: { kind: AdminModelRun["kind"] }) {
  const Icon = kind === "video" ? Video : kind === "image" ? ImageIcon : FileText;
  return <Icon className="size-4" />;
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  value: string | number;
  icon: typeof Gauge;
  tone?: "cyan" | "violet" | "amber" | "emerald";
}) {
  const tones = {
    cyan: "bg-cyan-400/10 text-cyan-200",
    violet: "bg-violet-400/10 text-violet-200",
    amber: "bg-amber-400/10 text-amber-200",
    emerald: "bg-emerald-400/10 text-emerald-200",
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <div className="flex items-center justify-between">
        <span className={cn("flex size-10 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="size-5" />
        </span>
        <p className="text-2xl font-bold text-white">{value}</p>
      </div>
      <p className="mt-4 text-sm text-zinc-400">{label}</p>
    </div>
  );
}

function CreditDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  onClose: () => void;
  onSubmit: (userId: string, amount: number, note: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("100");
  const [note, setNote] = useState("后台手动调整");
  const [saving, setSaving] = useState(false);
  const parsedAmount = Number(amount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-xl">
      <form
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111119] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.6)]"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await onSubmit(user.id, parsedAmount, note);
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">Credit Adjust</p>
        <h2 className="mt-2 text-2xl font-bold text-white">调整积分</h2>
        <p className="mt-2 truncate text-sm text-zinc-400">{user.email}</p>

        <label className="mt-6 block">
          <span className="mb-2 block text-xs font-semibold text-zinc-400">变动数量</span>
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none focus:border-fuchsia-300/50"
            required
          />
        </label>
        <p className="mt-2 text-xs text-zinc-500">正数为充值，负数为扣减；当前余额 {user.credit_balance}。</p>

        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold text-zinc-400">备注</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none focus:border-fuchsia-300/50"
          />
        </label>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-full border border-white/10 bg-white/[0.06] text-sm font-bold text-zinc-200 transition hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving || !Number.isFinite(parsedAmount) || parsedAmount === 0}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-fuchsia-500 text-sm font-bold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            确认调整
          </button>
        </div>
      </form>
    </div>
  );
}

function UserProjectsDialog({
  user,
  flows,
  loading,
  error,
  onClose,
  onOpenFlow,
}: {
  user: AdminUser;
  flows: AdminFlowSummary[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onOpenFlow: (flow: AdminFlowSummary) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-xl">
      <div className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111119] shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-5">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200">User Projects</p>
            <h2 className="mt-2 text-2xl font-bold text-white">用户项目</h2>
            <p className="mt-1 truncate text-sm text-zinc-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            title="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-48 overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-zinc-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
          ) : flows.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-zinc-500">
              <FolderOpen className="mb-3 size-7" />
              <p className="text-sm">该用户还没有创建项目</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">项目</th>
                    <th className="px-4 py-2">画布内容</th>
                    <th className="px-4 py-2">最后更新</th>
                    <th className="px-4 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {flows.map((flow) => (
                    <tr key={flow.id} className="bg-white/[0.045]">
                      <td className="max-w-64 rounded-l-2xl px-4 py-4">
                        <p className="truncate font-semibold text-white" title={flow.name}>{flow.name || "未命名项目"}</p>
                        <p className="mt-1 font-mono text-[11px] text-zinc-600">{flow.id.slice(0, 8)}</p>
                      </td>
                      <td className="px-4 py-4 text-zinc-300">{flow.node_count} 节点 / {flow.edge_count} 连线</td>
                      <td className="px-4 py-4 text-zinc-400">{formatDate(flow.updated_at || flow.created_at)}</td>
                      <td className="rounded-r-2xl px-4 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenFlow(flow)}
                          className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-3 py-2 text-xs font-bold text-[#061014] transition hover:bg-cyan-300"
                        >
                          进入画布
                          <ArrowUpRight className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BillingConfigPanel({
  config,
  imageCost,
  videoCost,
  saving,
  error,
  onImageCostChange,
  onVideoCostChange,
  onSave,
}: {
  config: BillingConfig | null;
  imageCost: string;
  videoCost: string;
  saving: boolean;
  error: string;
  onImageCostChange: (value: string) => void;
  onVideoCostChange: (value: string) => void;
  onSave: () => void;
}) {
  const imageValue = Number(imageCost);
  const videoValue = Number(videoCost);
  const invalid =
    !Number.isInteger(imageValue) ||
    !Number.isInteger(videoValue) ||
    imageValue < 0 ||
    videoValue < 0;

  return (
    <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-amber-200">Billing Rules</p>
          <h2 className="mt-2 text-xl font-bold text-white">积分计费配置</h2>
        </div>
        <Coins className="mt-1 size-5 text-amber-300" />
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-400">
            <ImageIcon className="size-3.5 text-cyan-300" />
            每生成一张图片
          </span>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="1"
              value={imageCost}
              onChange={(event) => onImageCostChange(event.target.value)}
              className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 pr-14 text-sm font-bold text-white outline-none focus:border-amber-300/50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500">积分</span>
          </div>
        </label>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-400">
            <Video className="size-3.5 text-violet-300" />
            每生成一个视频
          </span>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="1"
              value={videoCost}
              onChange={(event) => onVideoCostChange(event.target.value)}
              className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 pr-14 text-sm font-bold text-white outline-none focus:border-amber-300/50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500">积分</span>
          </div>
        </label>
      </div>

      {error && <p className="mt-3 text-xs text-red-200">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-600">{config?.updated_at ? `${formatDate(config.updated_at)} 更新` : "尚未设置"}</p>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || invalid}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-amber-400 px-4 text-xs font-bold text-[#171006] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          保存计费
        </button>
      </div>
    </div>
  );
}

function BrandingConfigPanel({
  config,
  name,
  logoPreview,
  saving,
  error,
  onNameChange,
  onLogoChange,
  onRemoveLogo,
  onSave,
}: {
  config: BrandingConfig | null;
  name: string;
  logoPreview: string;
  saving: boolean;
  error: string;
  onNameChange: (value: string) => void;
  onLogoChange: (file: File) => void;
  onRemoveLogo: () => void;
  onSave: () => void;
}) {
  const normalizedName = name.trim();

  return (
    <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">Brand Identity</p>
          <h2 className="mt-2 text-xl font-bold text-white">品牌设置</h2>
        </div>
        <Sparkles className="mt-1 size-5 text-fuchsia-300" />
      </div>

      <div className="mt-5 flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-fuchsia-500 text-white">
          {logoPreview ? (
            <img src={logoPreview} alt={`${normalizedName || "品牌"} Logo 预览`} className="size-full object-contain" />
          ) : (
            <Sparkles className="size-7" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{normalizedName || "未命名品牌"}</p>
          <p className="mt-1 text-xs text-zinc-500">PNG / JPG / WebP，最大 2MB</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/12">
              <ImageUp className="size-3.5" />
              上传 Logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onLogoChange(file);
                  event.target.value = "";
                }}
              />
            </label>
            {logoPreview && (
              <button
                type="button"
                onClick={onRemoveLogo}
                className="inline-flex size-9 items-center justify-center rounded-full border border-red-300/20 bg-red-500/10 text-red-200 transition hover:bg-red-500/20"
                title="移除 Logo"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="mb-2 block text-xs font-semibold text-zinc-400">品牌名称</span>
        <input
          value={name}
          maxLength={60}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-bold text-white outline-none focus:border-fuchsia-300/50"
          placeholder="NodeList AI"
        />
      </label>

      {error && <p className="mt-3 text-xs text-red-200">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-600">
          {config?.updated_at ? `${formatDate(config.updated_at)} 更新` : "使用默认品牌"}
        </p>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !normalizedName}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-fuchsia-500 px-4 text-xs font-bold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          保存品牌
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { hydrate, hydrated, token, email, logout } = useAuthStore();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [modelRuns, setModelRuns] = useState<AdminModelRun[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creditUser, setCreditUser] = useState<AdminUser | null>(null);
  const [projectsUser, setProjectsUser] = useState<AdminUser | null>(null);
  const [userFlows, setUserFlows] = useState<AdminFlowSummary[]>([]);
  const [userFlowsLoading, setUserFlowsLoading] = useState(false);
  const [userFlowsError, setUserFlowsError] = useState("");
  const [billingConfig, setBillingConfig] = useState<BillingConfig | null>(null);
  const [imageCost, setImageCost] = useState("0");
  const [videoCost, setVideoCost] = useState("0");
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig | null>(null);
  const [brandName, setBrandName] = useState("");
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null);
  const [brandLogoPreview, setBrandLogoPreview] = useState("");
  const [removeBrandLogo, setRemoveBrandLogo] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const loadAdminData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextBillingConfig, nextModelRuns, nextUsersPage, nextTransactions] = await Promise.all([
        getAdminSummary(),
        getAdminBillingConfig(),
        listAdminModelRuns(),
        listAdminUsersPage({ q: query, page: userPage, pageSize: USERS_PER_PAGE }),
        listCreditTransactions({ limit: 100 }),
      ]);
      setSummary(nextSummary);
      setBillingConfig(nextBillingConfig);
      setImageCost(String(nextBillingConfig.image_cost));
      setVideoCost(String(nextBillingConfig.video_cost));
      setModelRuns(nextModelRuns);
      setUsers(nextUsersPage.items);
      setUserTotal(nextUsersPage.total);
      setUserTotalPages(nextUsersPage.total_pages);
      if (nextUsersPage.page !== userPage) setUserPage(nextUsersPage.page);
      setTransactions(nextTransactions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, token, userPage]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace("/?auth=login");
      return;
    }
    const timer = window.setTimeout(() => void loadAdminData(), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, loadAdminData, router, token]);

  useEffect(() => {
    if (!hydrated || !token) return;
    const timer = window.setInterval(() => {
      void listAdminModelRuns().then(setModelRuns).catch(() => {});
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hydrated, token]);

  useEffect(() => {
    if (!hydrated || !token) return;
    let cancelled = false;
    void getBrandingConfig()
      .then((nextConfig) => {
        if (cancelled) return;
        setBrandingConfig(nextConfig);
        setBrandName(nextConfig.name);
        setBrandLogoPreview(resolveMediaUrl(nextConfig.logo_url));
      })
      .catch((err) => {
        if (!cancelled) setBrandingError(err instanceof Error ? err.message : "品牌配置加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, token]);

  useEffect(() => {
    return () => {
      if (brandLogoPreview.startsWith("blob:")) URL.revokeObjectURL(brandLogoPreview);
    };
  }, [brandLogoPreview]);

  const selectedUserTransactions = useMemo(() => {
    if (!creditUser) return transactions;
    return transactions.filter((transaction) => transaction.user_id === creditUser.id);
  }, [creditUser, transactions]);

  const liveModelRuns = useMemo(() => modelRuns.filter((run) => !run.stale), [modelRuns]);
  const staleModelRuns = modelRuns.length - liveModelRuns.length;
  const providerBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    liveModelRuns.forEach((run) => counts.set(run.provider, (counts.get(run.provider) ?? 0) + 1));
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [liveModelRuns]);

  const refresh = () => void loadAdminData();

  const handleCreditSubmit = async (userId: string, amount: number, note: string) => {
    const result = await adjustUserCredits(userId, { amount, note });
    setUsers((current) => current.map((user) => (user.id === userId ? result.user : user)));
    setTransactions((current) => [result.transaction, ...current]);
    setCreditUser(null);
    void getAdminSummary().then(setSummary).catch(() => {});
  };

  const patchUser = async (userId: string, payload: { role?: "user" | "admin"; disabled?: boolean }) => {
    const nextUser = await updateAdminUser(userId, payload);
    setUsers((current) => current.map((user) => (user.id === userId ? nextUser : user)));
    void getAdminSummary().then(setSummary).catch(() => {});
  };

  const openUserProjects = async (user: AdminUser) => {
    setProjectsUser(user);
    setUserFlows([]);
    setUserFlowsError("");
    setUserFlowsLoading(true);
    try {
      setUserFlows(await listAdminUserFlows(user.id));
    } catch (err) {
      setUserFlowsError(err instanceof Error ? err.message : "用户项目列表加载失败");
    } finally {
      setUserFlowsLoading(false);
    }
  };

  const openManagedFlow = (flow: AdminFlowSummary) => {
    if (!projectsUser) return;
    const params = new URLSearchParams({
      studio: "1",
      flow: flow.id,
      admin_user: projectsUser.id,
      admin_email: projectsUser.email,
    });
    router.push(`/?${params.toString()}`);
  };

  const saveBillingConfig = async () => {
    const nextImageCost = Number(imageCost);
    const nextVideoCost = Number(videoCost);
    if (!Number.isInteger(nextImageCost) || !Number.isInteger(nextVideoCost) || nextImageCost < 0 || nextVideoCost < 0) {
      setBillingError("计费积分必须是大于或等于 0 的整数");
      return;
    }
    setBillingSaving(true);
    setBillingError("");
    try {
      const nextConfig = await updateAdminBillingConfig({
        image_cost: nextImageCost,
        video_cost: nextVideoCost,
      });
      setBillingConfig(nextConfig);
      setImageCost(String(nextConfig.image_cost));
      setVideoCost(String(nextConfig.video_cost));
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "计费配置保存失败");
    } finally {
      setBillingSaving(false);
    }
  };

  const selectBrandLogo = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setBrandingError("Logo 仅支持 PNG、JPG 或 WebP");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setBrandingError("Logo 文件不能超过 2MB");
      return;
    }
    setBrandingError("");
    setBrandLogoFile(file);
    setRemoveBrandLogo(false);
    setBrandLogoPreview(URL.createObjectURL(file));
  };

  const clearBrandLogo = () => {
    setBrandLogoFile(null);
    setRemoveBrandLogo(true);
    setBrandLogoPreview("");
    setBrandingError("");
  };

  const saveBrandingConfig = async () => {
    const normalizedName = brandName.trim();
    if (!normalizedName) {
      setBrandingError("品牌名称不能为空");
      return;
    }
    setBrandingSaving(true);
    setBrandingError("");
    try {
      const nextConfig = await updateAdminBranding({
        name: normalizedName,
        logo: brandLogoFile ?? undefined,
        removeLogo: removeBrandLogo,
      });
      setBrandingConfig(nextConfig);
      setBrandName(nextConfig.name);
      setBrandLogoFile(null);
      setRemoveBrandLogo(false);
      setBrandLogoPreview(resolveMediaUrl(nextConfig.logo_url));
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : "品牌配置保存失败");
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  if (!hydrated) return null;

  return (
    <main className="min-h-screen bg-[#07070b] text-zinc-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_25%_10%,rgba(168,85,247,0.24),transparent_32%),radial-gradient(circle_at_85%_20%,rgba(6,182,212,0.18),transparent_34%)]" />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07070b]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandMark showName={false} logoClassName="size-10 rounded-2xl" />
            <div>
              <h1 className="text-lg font-bold text-white">
                {brandName.trim() ? `${brandName.trim()} 管理后台` : "管理后台"}
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Admin Console</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-zinc-300 sm:inline-flex">
              {email}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              title="刷新"
            >
              <RefreshCw className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              title="退出"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-200">
              {error.includes("Admin access required") ? "当前账号不是管理员，无法访问后台。" : error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="用户总数" value={summary?.users ?? "-"} icon={UserRound} tone="cyan" />
            <StatCard label="可用积分池" value={summary?.total_credits ?? "-"} icon={Coins} tone="amber" />
            <StatCard label="画布流程" value={summary?.flows ?? "-"} icon={LayoutDashboard} tone="violet" />
            <StatCard label="制作资产" value={summary?.assets ?? "-"} icon={WalletCards} tone="emerald" />
            <StatCard label="运行任务" value={liveModelRuns.length} icon={Activity} tone="cyan" />
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200">Live Model Runs</p>
                <h2 className="mt-2 text-2xl font-bold text-white">模型运行情况</h2>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-2 text-emerald-200">
                  <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                  {liveModelRuns.length} 运行中
                </span>
                {staleModelRuns > 0 && (
                  <span className="inline-flex items-center gap-2 text-amber-200">
                    <span className="size-2 rounded-full bg-amber-400" />
                    {staleModelRuns} 失联
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[940px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">状态</th>
                    <th className="px-4 py-2">用户</th>
                    <th className="px-4 py-2">类型</th>
                    <th className="px-4 py-2">模型</th>
                    <th className="px-4 py-2">画布</th>
                    <th className="px-4 py-2">时长</th>
                    <th className="px-4 py-2">任务 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                        <Loader2 className="mx-auto size-5 animate-spin" />
                      </td>
                    </tr>
                  ) : modelRuns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">当前没有模型任务运行</td>
                    </tr>
                  ) : (
                    modelRuns.map((run) => (
                      <tr key={`${run.flow_id}:${run.node_id}:${run.task_id}`} className="bg-white/[0.045]">
                        <td className="rounded-l-2xl px-4 py-4">
                          <span className={cn("inline-flex items-center gap-2 font-semibold", run.stale ? "text-amber-200" : "text-emerald-200")}>
                            <span className={cn("size-2 rounded-full", run.stale ? "bg-amber-400" : "bg-emerald-400 animate-pulse")} />
                            {run.stale ? "失联" : RUN_STATUS_LABELS[run.status] || run.status}
                          </span>
                        </td>
                        <td className="max-w-52 px-4 py-4">
                          <p className="truncate font-semibold text-white" title={run.user_email}>{run.user_email}</p>
                          <p className="mt-1 text-xs text-zinc-500">{run.node_label}</p>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-2 text-zinc-300">
                            <RunKindIcon kind={run.kind} />
                            {RUN_KIND_LABELS[run.kind]}
                          </span>
                        </td>
                        <td className="max-w-56 px-4 py-4">
                          <p className="truncate font-semibold text-white" title={run.model}>{run.model}</p>
                          <p className="mt-1 text-xs text-cyan-200">{run.provider}</p>
                        </td>
                        <td className="max-w-44 px-4 py-4">
                          <p className="truncate text-zinc-300" title={run.flow_name}>{run.flow_name}</p>
                          <p className="mt-1 font-mono text-[11px] text-zinc-600">{run.flow_id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-4 font-mono text-zinc-300">
                          <span className="inline-flex items-center gap-2"><Clock3 className="size-3.5 text-zinc-500" />{formatDuration(run.started_at)}</span>
                        </td>
                        <td className="rounded-r-2xl px-4 py-4 font-mono text-xs text-zinc-500" title={run.task_id}>
                          {shortTaskId(run.task_id)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">Users</p>
                <h2 className="mt-2 text-2xl font-bold text-white">用户与积分</h2>
              </div>
              <form
                className="relative w-full sm:w-72"
                onSubmit={(event) => {
                  event.preventDefault();
                  const nextQuery = searchDraft.trim();
                  if (nextQuery === query && userPage === 1) {
                    refresh();
                    return;
                  }
                  setUserPage(1);
                  setQuery(nextQuery);
                }}
              >
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="搜索邮箱"
                  className="h-11 w-full rounded-full border border-white/10 bg-white/[0.06] pl-10 pr-4 text-sm text-white outline-none focus:border-fuchsia-300/50"
                />
              </form>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[860px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">用户</th>
                    <th className="px-4 py-2">角色</th>
                    <th className="px-4 py-2">余额</th>
                    <th className="px-4 py-2">资源</th>
                    <th className="px-4 py-2">状态</th>
                    <th className="px-4 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                        <Loader2 className="mx-auto mb-3 size-5 animate-spin" />
                        加载后台数据中
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="bg-white/[0.045]">
                        <td className="rounded-l-2xl px-4 py-4">
                          <p className="font-semibold text-white">{user.email}</p>
                          <p className="mt-1 font-mono text-xs text-zinc-500">{formatDate(user.created_at)}</p>
                        </td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "user" : "admin" })}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs font-bold",
                              user.role === "admin"
                                ? "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100"
                                : "border-white/10 bg-white/[0.06] text-zinc-300"
                            )}
                          >
                            {user.role}
                          </button>
                        </td>
                        <td className="px-4 py-4 text-lg font-bold text-white">{user.credit_balance}</td>
                        <td className="px-4 py-4 text-zinc-300">
                          {user.flows} 流程 / {user.assets} 资产
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={cn(
                              "rounded-full px-3 py-1 text-xs font-bold",
                              user.disabled ? "bg-red-500/15 text-red-200" : "bg-emerald-400/15 text-emerald-200"
                            )}
                          >
                            {user.disabled ? "已禁用" : "正常"}
                          </span>
                        </td>
                        <td className="rounded-r-2xl px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void openUserProjects(user)}
                              className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                              <Eye className="size-3.5" />
                              查看
                            </button>
                            <button
                              type="button"
                              onClick={() => setCreditUser(user)}
                              className="rounded-full bg-fuchsia-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-400"
                            >
                              调积分
                            </button>
                            <button
                              type="button"
                              onClick={() => void patchUser(user.id, { disabled: !user.disabled })}
                              className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-zinc-200 transition hover:bg-white/10"
                            >
                              <Ban className="mr-1 inline size-3" />
                              {user.disabled ? "启用" : "禁用"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-white/8 pt-4 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
              <p>每页 {USERS_PER_PAGE} 条 · 共 {userTotal} 位用户</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUserPage((page) => Math.max(1, page - 1))}
                  disabled={loading || userPage <= 1}
                  className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                  title="上一页"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="min-w-24 text-center font-mono text-xs text-zinc-300">
                  {userPage} / {userTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setUserPage((page) => Math.min(userTotalPages, page + 1))}
                  disabled={loading || userPage >= userTotalPages}
                  className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                  title="下一页"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <BrandingConfigPanel
            config={brandingConfig}
            name={brandName}
            logoPreview={brandLogoPreview}
            saving={brandingSaving}
            error={brandingError}
            onNameChange={setBrandName}
            onLogoChange={selectBrandLogo}
            onRemoveLogo={clearBrandLogo}
            onSave={() => void saveBrandingConfig()}
          />

          <BillingConfigPanel
            config={billingConfig}
            imageCost={imageCost}
            videoCost={videoCost}
            saving={billingSaving}
            error={billingError}
            onImageCostChange={setImageCost}
            onVideoCostChange={setVideoCost}
            onSave={() => void saveBillingConfig()}
          />

          <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white">生成状态</h2>
                <p className="text-xs text-zinc-500">{liveModelRuns.length} running / {staleModelRuns} stale</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {providerBreakdown.length === 0 ? (
                <p className="text-sm text-zinc-500">暂无运行中的模型</p>
              ) : (
                providerBreakdown.map(([provider, count]) => (
                  <div key={provider} className="flex items-center justify-between border-b border-white/8 pb-3 text-sm last:border-0 last:pb-0">
                    <span className="text-zinc-300">{provider}</span>
                    <span className="font-mono font-bold text-cyan-200">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">Credit Ledger</p>
            <h2 className="mt-2 text-xl font-bold text-white">积分流水</h2>
            <div className="mt-5 max-h-[620px] space-y-3 overflow-y-auto pr-1">
              {selectedUserTransactions.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-500">
                  暂无积分流水
                </p>
              ) : (
                selectedUserTransactions.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-white">{item.user_email}</p>
                      <span className={cn("text-sm font-bold", item.amount > 0 ? "text-emerald-300" : "text-red-300")}>
                        {item.amount > 0 ? "+" : ""}{item.amount}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">余额 {item.balance_after} · {formatDate(item.created_at)}</p>
                    {item.note && <p className="mt-2 text-xs text-zinc-400">{item.note}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {creditUser && (
        <CreditDialog user={creditUser} onClose={() => setCreditUser(null)} onSubmit={handleCreditSubmit} />
      )}
      {projectsUser && (
        <UserProjectsDialog
          user={projectsUser}
          flows={userFlows}
          loading={userFlowsLoading}
          error={userFlowsError}
          onClose={() => setProjectsUser(null)}
          onOpenFlow={openManagedFlow}
        />
      )}
    </main>
  );
}
