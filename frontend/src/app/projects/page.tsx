"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, FolderPlus, ImageIcon, LogOut, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { createFlow, deleteFlow, isAuthExpiredError, listFlows, resolveMediaUrl, saveFlow, type FlowRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function firstMediaFromArray(value: unknown) {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (isRecord(item)) {
      const url = firstString(item.url, item.previewUrl, item.publicUrl, item.public_url, item.videoUrl, item.imageUrl);
      if (url) return url;
    } else if (typeof item === "string" && item.trim()) {
      return item;
    }
  }
  return "";
}

function flowThumbnail(flow: FlowRecord) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const data = isRecord(node.data) ? node.data : {};
    const config = isRecord(data.config) ? data.config : {};
    const media = firstString(
      config.videoUrl,
      config.imageUrl,
      config.previewUrl,
      config.posterUrl,
      config.publicUrl,
      config.public_url,
      firstMediaFromArray(config.imageItems),
      firstMediaFromArray(config.images),
      firstMediaFromArray(config.generatedImages),
      firstMediaFromArray(config.assets)
    );
    if (media) return resolveMediaUrl(media);
  }
  return "";
}

function formatDate(value?: string | null) {
  if (!value) return "刚刚更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function flowStats(flow: FlowRecord) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow.edges) ? flow.edges : [];
  return `${nodes.length} 节点 / ${edges.length} 连线`;
}

function nextUntitledSpaceName(flows: FlowRecord[]) {
  const usedNumbers = flows
    .map((flow) => /^未命名空间-(\d+)$/.exec(flow.name || ""))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  return `未命名空间-${nextNumber}`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { hydrate, hydrated, token, email, logout } = useAuthStore();
  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FlowRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace("/?auth=login");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    listFlows()
      .then((records) => {
        if (!cancelled) setFlows(records);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isAuthExpiredError(err)) {
          logout();
          router.replace("/?auth=login");
          return;
        }
        setError(err instanceof Error ? err.message : "项目列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, router, token]);

  const sortedFlows = useMemo(
    () =>
      [...flows].sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      }),
    [flows]
  );

  const createProject = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const record = await createFlow({
        name: nextUntitledSpaceName(flows),
        nodes: [],
        edges: [],
      });
      router.push(`/?studio=1&flow=${record.id}`);
    } catch (err) {
      if (isAuthExpiredError(err)) {
        logout();
        router.replace("/?auth=login");
        return;
      }
      setError(err instanceof Error ? err.message : "项目创建失败");
      setCreating(false);
    }
  };

  const openProject = (flowId: string) => {
    router.push(`/?studio=1&flow=${flowId}`);
  };

  const openRename = (flow: FlowRecord) => {
    setActiveMenuId(null);
    setRenameTarget(flow);
    setRenameValue(flow.name || "未命名");
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget || savingName) return;
    const nextName = renameValue.trim() || "未命名";
    setSavingName(true);
    setError("");
    try {
      const record = await saveFlow(renameTarget.id, {
        name: nextName,
        nodes: renameTarget.nodes,
        edges: renameTarget.edges,
      });
      setFlows((items) => items.map((item) => (item.id === record.id ? record : item)));
      setRenameTarget(null);
      setRenameValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目重命名失败");
    } finally {
      setSavingName(false);
    }
  };

  const removeProject = async (flow: FlowRecord) => {
    setActiveMenuId(null);
    const confirmed = window.confirm(`确定删除「${flow.name || "未命名"}」吗？删除后无法恢复。`);
    if (!confirmed) return;
    setDeletingId(flow.id);
    setError("");
    try {
      await deleteFlow(flow.id);
      setFlows((items) => items.filter((item) => item.id !== flow.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const exit = () => {
    logout();
    router.replace("/");
  };

  if (!hydrated || (!token && hydrated)) return null;

  return (
    <main className="min-h-screen bg-[#111112] text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-white/8 bg-[#111112]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 text-sm font-semibold text-zinc-300 transition hover:text-white"
          >
            <ArrowLeft className="size-4" />
            返回官网
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 sm:inline-flex">
              {email}
            </span>
            <button
              type="button"
              onClick={exit}
              className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-300 transition hover:bg-white/10 hover:text-white"
              title="退出登录"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-fuchsia-500 text-white shadow-[0_12px_34px_rgba(217,35,238,0.28)]">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.32em] text-fuchsia-200">Project Workspace</p>
                <h1 className="mt-1 text-3xl font-bold tracking-normal text-white">全部项目</h1>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
              每个账号拥有独立项目空间。你可以创建多个视频项目画布，素材、生成记录和资产会按账号归属保存。
            </p>
          </div>
          <button
            type="button"
            onClick={createProject}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FolderPlus className="size-4" />
            {creating ? "创建中..." : "新建项目"}
          </button>
        </div>

        {error ? (
          <div className="mt-8 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <button
            type="button"
            onClick={createProject}
            disabled={creating}
            className="group flex h-[222px] flex-col overflow-hidden rounded-[14px] border border-white/18 bg-[#242426] text-left transition hover:border-fuchsia-300/70 hover:bg-[#2b2b2e] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <div className="grid flex-1 place-items-center">
              <div className="flex flex-col items-center gap-3 text-zinc-200">
                <span className="grid size-10 place-items-center rounded-full border border-white/12 bg-white/[0.06] transition group-hover:border-fuchsia-200/70 group-hover:text-fuchsia-100">
                  <Plus className="size-5" />
                </span>
                <span className="font-semibold">{creating ? "正在创建" : "开始创作"}</span>
              </div>
            </div>
            <div className="border-t border-white/8 px-4 py-3 text-sm text-zinc-400">创建新的视频项目</div>
          </button>

          {loading
            ? Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[222px] animate-pulse rounded-[14px] border border-white/8 bg-white/[0.04]" />
              ))
            : sortedFlows.map((flow) => {
                const thumbnail = flowThumbnail(flow);
                return (
                  <div
                    key={flow.id}
                    className={cn(
                      "group relative rounded-[14px] text-left transition hover:-translate-y-0.5",
                      deletingId === flow.id && "pointer-events-none opacity-55"
                    )}
                  >
                    <button type="button" onClick={() => openProject(flow.id)} className="block w-full text-left">
                      <div className="relative h-[155px] overflow-hidden rounded-[14px] border border-white/8 bg-[#242426]">
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={flow.name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-zinc-500">
                            <ImageIcon className="size-12" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
                      </div>
                      <div className="mt-3 px-1">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="truncate text-base font-bold text-white">{flow.name || "未命名"}</h2>
                          <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] text-zinc-400", "bg-white/[0.05]")}>
                            {flowStats(flow)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
                          <CalendarDays className="size-3.5" />
                          {formatDate(flow.updated_at || flow.created_at)}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveMenuId((id) => (id === flow.id ? null : flow.id));
                      }}
                      className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-black/50 text-zinc-100 backdrop-blur transition hover:bg-black/70"
                      title="项目操作"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {activeMenuId === flow.id ? (
                      <div className="absolute right-3 top-14 z-20 w-40 overflow-hidden rounded-2xl border border-white/10 bg-[#242427]/95 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                        <button
                          type="button"
                          onClick={() => openRename(flow)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/10"
                        >
                          <Pencil className="size-4 text-zinc-300" />
                          修改名称
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeProject(flow)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-200 transition hover:bg-red-500/12"
                        >
                          <Trash2 className="size-4" />
                          删除项目
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
        </div>

        {renameTarget ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm">
            <form
              onSubmit={submitRename}
              className="w-full max-w-[420px] rounded-[24px] border border-white/12 bg-[#18181d] p-5 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">Project Settings</p>
                  <h2 className="mt-1 text-xl font-bold">修改项目名称</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>
              <label className="mt-5 block text-xs font-medium text-zinc-400" htmlFor="project-name">
                项目名称
              </label>
              <input
                id="project-name"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                autoFocus
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-fuchsia-300/70"
                placeholder="输入项目名称"
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingName}
                  className="rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-bold text-white shadow-[0_14px_32px_rgba(217,35,238,0.28)] transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingName ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {!loading && sortedFlows.length === 0 ? (
          <p className="mt-10 text-center text-sm text-zinc-500">还没有项目，先创建一个新的画布。</p>
        ) : null}
      </section>
    </main>
  );
}
