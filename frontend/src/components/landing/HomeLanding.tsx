"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  Check,
  Clapperboard,
  Film,
  Image,
  Layers3,
  LockKeyhole,
  Mail,
  PackageCheck,
  Play,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

import { BrandMark } from "@/components/branding/BrandMark";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

const navItems = [
  { label: "视频创作", href: "#视频创作" },
  { label: "模型能力", href: "#模型能力" },
  { label: "资产库", href: "#资产库" },
  { label: "案例", href: "#案例" },
  { label: "价格", href: "#价格" },
];

const proofItems = [
  ["5类", "素材统一入库"],
  ["20+", "图片 / 模型"],
  ["100%", "可追踪"],
  ["N条", "分析到成片链路"],
];

const features = [
  {
    title: "视频理解",
    icon: BrainCircuit,
    color: "text-cyan-300",
    bg: "bg-cyan-400/10",
    bullets: ["整段视频分析", "节点级进度反馈", "结构化分镜报告"],
  },
  {
    title: "模型生成",
    icon: Sparkles,
    color: "text-violet-300",
    bg: "bg-violet-400/10",
    bullets: ["模型选择同步侧栏", "尺寸 / 清晰度 / 数量", "图生图与图生视频"],
  },
  {
    title: "账号资产库",
    icon: Boxes,
    color: "text-emerald-300",
    bg: "bg-emerald-400/10",
    bullets: ["独立账号资产", "手动加入更可控", "成片可回看复用"],
  },
];

const assetCards = [
  { label: "人物", value: "3", icon: UserRound, color: "text-fuchsia-300" },
  { label: "场景", value: "5", icon: Image, color: "text-cyan-300" },
  { label: "道具", value: "18", icon: PackageCheck, color: "text-amber-300" },
  { label: "片段", value: "7/8", icon: Clapperboard, color: "text-emerald-300" },
  { label: "成片", value: "1", icon: Film, color: "text-violet-300" },
];

function LandingButton({
  children,
  href,
  onClick,
  variant = "primary",
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  const className = cn(
    "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold transition",
    variant === "primary"
      ? "bg-fuchsia-500 text-white shadow-[0_16px_44px_rgba(236,34,208,0.42)] hover:bg-fuchsia-400"
      : "border border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.1]"
  );

  if (!href) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

type AuthMode = "login" | "register";

function getAuthErrorMessage(error: unknown, mode: AuthMode) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Incorrect email or password")) return "账号或密码错误，请重新输入。";
  if (message.includes("Email already registered")) return "该邮箱已注册，请切换到登录。";
  if (message.includes("Password must be at least 6 characters")) return "密码至少需要 6 位字符。";
  if (message.includes("Account disabled")) return "该账号已被禁用，请联系管理员。";
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "无法连接后端服务，请确认 API 已启动。";
  }
  return mode === "login" ? "登录失败，请检查账号密码后重试。" : "注册失败，请稍后重试。";
}

function AuthDialog({
  open,
  mode,
  required,
  onClose,
  onModeChange,
}: {
  open: boolean;
  mode: AuthMode;
  required: boolean;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
}) {
  const router = useRouter();
  const { login, register } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
  }, [mode, open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setError("");

    if (!normalizedEmail || !password) {
      setError("请输入邮箱和密码。");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(normalizedEmail, password);
      } else {
        await register(normalizedEmail, password);
      }
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(getAuthErrorMessage(err, mode));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-xl">
      <div className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] border border-white/12 bg-[#111119]/95 p-6 text-zinc-100 shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
        <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-fuchsia-500/25 blur-3xl" />
        <div className="absolute -bottom-24 left-6 h-48 w-48 rounded-full bg-cyan-400/15 blur-3xl" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-400 transition hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>

        <div className="relative">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-fuchsia-500 text-white shadow-[0_16px_36px_rgba(236,34,208,0.38)]">
            <Sparkles className="size-6" />
          </div>
          <p className="mt-5 font-mono text-xs uppercase tracking-[0.28em] text-fuchsia-200">
            {required ? "Session Required" : "Start Creating"}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">
            {mode === "login" ? "登录工作台" : "创建账号"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {required
              ? "当前没有有效登录状态，请重新登录后继续进入创作工作台。"
              : "登录或注册后即可进入 AI 视频制作工作台。"}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-full border border-white/10 bg-black/30 p-1">
            {[
              ["login", "登录"],
              ["register", "注册"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onModeChange(value as AuthMode)}
                className={cn(
                  "h-10 rounded-full text-sm font-bold transition",
                  mode === value
                    ? "bg-white text-zinc-950 shadow-lg"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-zinc-400">邮箱</span>
              <span className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-zinc-100 transition focus-within:border-fuchsia-300/50 focus-within:bg-white/[0.08]">
                <Mail className="size-4 text-zinc-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="auth-autofill min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-zinc-400">密码</span>
              <span className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-zinc-100 transition focus-within:border-fuchsia-300/50 focus-within:bg-white/[0.08]">
                <LockKeyhole className="size-4 text-zinc-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "register" ? "至少 6 位字符" : "输入密码"}
                  required
                  className="auth-autofill min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                />
              </span>
            </label>

            {error && (
              <p className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-fuchsia-500 text-sm font-bold text-white shadow-[0_16px_44px_rgba(236,34,208,0.42)] transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "处理中..." : mode === "login" ? "登录并进入工作台" : "注册并开始创作"}
              {!loading && <ArrowRight className="size-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MockNode({
  title,
  meta,
  status,
  accent,
  children,
  className,
}: {
  title: string;
  meta: string;
  status: "Done" | "Queued";
  accent: "cyan" | "violet";
  children: ReactNode;
  className?: string;
}) {
  const accentClass = accent === "cyan" ? "border-cyan-300/70" : "border-violet-400/70";

  return (
    <div className={cn("rounded-[18px] border bg-[#171720] p-5 shadow-2xl", accentClass, className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-[13px]",
              accent === "cyan" ? "bg-cyan-400/15 text-cyan-300" : "bg-violet-400/15 text-violet-300"
            )}
          >
            {accent === "cyan" ? <BrainCircuit className="size-5" /> : <Sparkles className="size-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-white">{title}</h3>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500">{meta}</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-semibold",
            status === "Done"
              ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
              : "border-amber-300/50 bg-amber-400/15 text-amber-100"
          )}
        >
          {status}
        </span>
      </div>
      {children}
    </div>
  );
}

function ProductMockup() {
  return (
    <div className="relative mx-auto mt-14 max-w-6xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0e0e16] shadow-[0_30px_90px_rgba(168,85,247,0.25)]">
      <div className="flex h-14 items-center justify-between border-b border-white/10 bg-[#12121c] px-7">
        <p className="text-sm font-bold text-white">AI 视频制作工作台</p>
        <p className="font-mono text-xs text-cyan-200">SAVED</p>
      </div>

      <div className="relative min-h-[520px] overflow-hidden p-6 sm:p-8 lg:p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(96,165,250,0.20)_1px,transparent_0)] bg-[length:26px_26px]" />
        <div className="absolute bottom-16 left-1/2 z-10 hidden w-[520px] -translate-x-1/2 rounded-[22px] border border-white/10 bg-[#202027]/95 p-5 backdrop-blur md:block">
          <p className="text-sm leading-6 text-zinc-400">
            上传参考视频，或输入：分析视频、拆解分镜、生成角色 / 场景 / 道具、生成片段
          </p>
          <div className="mt-5 flex items-center gap-3">
            {["视频", "视频分析", "分镜", "片段"].map((item, index) => (
              <span
                key={item}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold",
                  index === 1
                    ? "border-violet-300/40 bg-violet-400/20 text-violet-100"
                    : "border-white/10 bg-white/[0.06] text-zinc-300"
                )}
              >
                {item}
              </span>
            ))}
            <span className="ml-auto flex size-9 items-center justify-center rounded-full bg-fuchsia-500 text-white">
              <ArrowRight className="size-4" />
            </span>
          </div>
        </div>

        <div className="relative z-10 grid gap-6 lg:grid-cols-[220px_1fr_256px]">
          <MockNode title="源视频上传" meta="MP4 / READY" status="Done" accent="cyan">
            <div className="mt-5 h-20 rounded-xl bg-[linear-gradient(110deg,#334155,#f472b6_48%,#020617)]" />
            <div className="mt-4 space-y-2">
              {["重新上传视频", "视频分析", "查看源视频"].map((item, index) => (
                <div
                  key={item}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs text-zinc-200",
                    index === 1 ? "border-cyan-300/50 bg-cyan-400/10" : "border-white/10 bg-white/[0.05]"
                  )}
                >
                  {item}
                </div>
              ))}
            </div>
          </MockNode>

          <MockNode title="视频分析" meta="DOUBAO SEED 2.0 / DONE" status="Done" accent="cyan" className="min-h-[268px]">
            <div className="mt-5 grid gap-6 sm:grid-cols-[154px_1fr]">
              <div className="relative h-24 rounded-xl bg-[linear-gradient(145deg,#111827,#64748b_55%,#020617)]">
                <Play className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white" />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {[
                  ["叙事要素", "场景 / 角色 / 台词"],
                  ["时间", "10.8s · 单镜头"],
                  ["镜头语言", "近景 · 固定机位"],
                  ["声音", "对白清晰 · 无配乐"],
                ].map(([title, text]) => (
                  <div key={title}>
                    <p className="text-sm font-bold text-white">{title}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-fuchsia-500 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_34px_rgba(236,34,208,0.45)]">
                <WandSparkles className="size-4" />
                替换 & 定制
              </span>
            </div>
          </MockNode>

          <aside className="rounded-none border-l border-white/10 bg-[#13131b]/80 p-5 lg:-m-10 lg:ml-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fuchsia-200">Assets & Runs</p>
            <h3 className="mt-2 text-2xl font-bold text-white">制作资产</h3>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {assetCards.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="flex items-start justify-between">
                    <Icon className={cn("size-5", color)} />
                    <span className="text-xl font-bold text-white">{value}</span>
                  </div>
                  <p className="mt-4 text-sm text-zinc-300">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/35 p-4">
              <p className="text-sm font-bold text-white">模型选择</p>
              {[
                ["Doubao Seed 2.0", "视频分析", "bg-cyan-400/15"],
                ["Lovart / GPT Image", "图片生成", "bg-violet-400/15"],
                ["MiniMax h3", "图生视频", "bg-fuchsia-400/15"],
              ].map(([name, use, bg]) => (
                <div key={name} className={cn("mt-2 flex items-center justify-between rounded-full px-3 py-2 text-xs", bg)}>
                  <span className="font-semibold text-white">{name}</span>
                  <span className="text-zinc-300">{use}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function HomeLanding({
  isAuthenticated = false,
  authRequired = false,
  initialAuthMode,
}: {
  isAuthenticated?: boolean;
  authRequired?: boolean;
  initialAuthMode?: AuthMode | null;
}) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [authOpen, setAuthOpen] = useState(authRequired || Boolean(initialAuthMode));
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuthMode ?? (authRequired ? "login" : "register"));

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const startCreating = (mode: AuthMode = "login") => {
    if (isAuthenticated) {
      router.push("/projects");
      return;
    }
    openAuth(mode);
  };

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 24);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    if (!authRequired) return;
    setAuthMode("login");
    setAuthOpen(true);
  }, [authRequired]);

  useEffect(() => {
    if (!initialAuthMode) return;
    setAuthMode(initialAuthMode);
    setAuthOpen(true);
  }, [initialAuthMode]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07070b] text-zinc-100">
      <section id="视频创作" className="relative isolate overflow-hidden px-5 pb-24 pt-8 sm:px-8 lg:px-12">
        <div className="absolute left-1/2 top-0 -z-10 h-[360px] w-[940px] -translate-x-1/2 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute right-16 top-72 -z-10 h-[360px] w-[520px] rounded-full bg-cyan-400/25 blur-3xl" />

        <header
          className={cn(
            "fixed inset-x-0 top-0 z-50 flex h-20 items-center px-5 transition-all duration-300 sm:px-8 lg:px-12",
            scrolled
              ? "border-b border-white/10 bg-[#050508]/95 shadow-[0_18px_56px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              : "border-b border-transparent bg-transparent"
          )}
        >
          <nav className="mx-auto flex h-full w-full max-w-7xl items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <BrandMark />
            </Link>
            <div className="hidden items-center gap-8 text-sm font-medium text-zinc-400 md:flex">
              {navItems.map((item) => (
                <a key={item.label} href={item.href} className="transition hover:text-white">
                  {item.label}
                </a>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => startCreating("login")}
                  className="hidden rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 sm:inline-flex"
                >
                  进入工作台
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuth("login")}
                  className="hidden rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 sm:inline-flex"
                >
                  登录
                </button>
              )}
              <button
                type="button"
                onClick={() => startCreating("register")}
                className="rounded-full bg-fuchsia-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_34px_rgba(236,34,208,0.38)] transition hover:bg-fuchsia-400"
              >
                {isAuthenticated ? "打开工作台" : "免费开始"}
              </button>
            </div>
          </nav>
        </header>

        <div className="mx-auto mt-28 flex max-w-5xl flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 font-mono text-xs uppercase tracking-wider text-fuchsia-100">
            <Play className="size-3.5 text-cyan-200" />
            Video Product Workflow
          </div>
          <h1 className="mt-7 max-w-4xl text-balance text-5xl font-bold leading-[1.04] tracking-normal text-white sm:text-6xl lg:text-7xl">
            AI 视频制作，从参考素材到可用成片
          </h1>
          <p className="mt-6 max-w-3xl text-pretty text-lg leading-8 text-zinc-300 sm:text-xl">
            上传图片、视频或脚本，自动拆解镜头语言与叙事要素，绑定账号资产库与多模型生成，让短剧、广告、产品视频进入一条清晰流水线。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <LandingButton onClick={() => startCreating("login")}>
              开始创作
              <ArrowRight className="size-4" />
            </LandingButton>
            <LandingButton href="#案例" variant="secondary">
              <Play className="size-4" />
              查看案例
            </LandingButton>
          </div>
        </div>

        <ProductMockup />

        <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:grid-cols-4 sm:p-6">
          {proofItems.map(([value, label]) => (
            <div key={label} className="text-center">
              <p className="text-2xl font-bold text-white sm:text-3xl">{value}</p>
              <p className="mt-2 text-xs text-zinc-500 sm:text-sm">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="模型能力" className="px-5 pb-24 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-fuchsia-200">Creator Operating System</p>
          <h2 className="mt-4 text-balance text-4xl font-bold text-white sm:text-5xl">
            把模型能力包装成创作者能理解的生产流程
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-zinc-400">
            官网不展示裸模型参数，而是让用户从上传素材、视频分析、替换定制、生成片段到加入账号资产库，一步步完成可复用的创作资产。
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 lg:grid-cols-3">
          {features.map(({ title, icon: Icon, color, bg, bullets }) => (
            <article key={title} className="rounded-[18px] border border-white/10 bg-[#111119] p-6">
              <div className="flex items-center gap-3">
                <span className={cn("flex size-10 items-center justify-center rounded-xl", bg, color)}>
                  <Icon className="size-5" />
                </span>
                <h3 className="text-xl font-bold text-white">{title}</h3>
              </div>
              <div className="mt-6 space-y-3">
                {bullets.map((bullet) => (
                  <div key={bullet} className="flex items-center gap-3 text-sm text-zinc-200">
                    <Check className={cn("size-4", color)} />
                    {bullet}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="案例" className="px-5 pb-10 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-3">
          {[
            ["短剧投放", "上传竞品视频，拆解镜头语言和人物关系，再生成可替换角色与场景的测试片段。"],
            ["产品广告", "把产品图、卖点脚本和参考视频串成流程，沉淀账号级产品设定图与成片资产。"],
            ["内容矩阵", "同一套角色、场景、道具在多个项目中复用，减少每次从零搭素材的时间。"],
          ].map(([title, text]) => (
            <article key={title} className="rounded-[18px] border border-white/10 bg-white/[0.045] p-6">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200">Use Case</p>
              <h3 className="mt-4 text-xl font-bold text-white">{title}</h3>
              <p className="mt-4 text-sm leading-6 text-zinc-400">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="资产库" className="px-5 pb-10 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl border border-white/10 bg-[linear-gradient(100deg,#20102c,#0e0e16_50%,#082f49)] p-7 sm:p-9 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-white">从第一个素材开始，搭一条可复用的视频生产线</h2>
            <p className="mt-3 text-sm text-zinc-300">适合短剧、广告、产品展示和多账号内容团队。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <LandingButton onClick={() => startCreating("register")}>
              立即体验
              <ArrowRight className="size-4" />
            </LandingButton>
            <LandingButton href="#模型能力" variant="secondary">
              查看模型
            </LandingButton>
          </div>
        </div>
      </section>

      <section id="价格" className="px-5 pb-20 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-6xl rounded-3xl border border-white/10 bg-[#111119] p-7 text-center sm:p-9">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-fuchsia-200">Pricing</p>
          <h2 className="mt-3 text-3xl font-bold text-white">按团队模型用量灵活开始</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
            先从免费体验开始，后续可按账号资产库、生成队列和模型调用额度扩展。
          </p>
        </div>
      </section>
      <AuthDialog
        open={authOpen}
        mode={authMode}
        required={authRequired}
        onClose={() => setAuthOpen(false)}
        onModeChange={setAuthMode}
      />
    </main>
  );
}
