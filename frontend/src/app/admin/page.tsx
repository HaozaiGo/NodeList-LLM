"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Coins,
  Gauge,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";

import {
  adjustUserCredits,
  getAdminSummary,
  listAdminUsers,
  listCreditTransactions,
  updateAdminUser,
  type AdminSummary,
  type AdminUser,
  type CreditTransaction,
} from "@/lib/api";
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

export default function AdminPage() {
  const router = useRouter();
  const { hydrate, hydrated, token, email, logout } = useAuthStore();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creditUser, setCreditUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const loadAdminData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextUsers, nextTransactions] = await Promise.all([
        getAdminSummary(),
        listAdminUsers({ q: query, limit: 100 }),
        listCreditTransactions({ limit: 100 }),
      ]);
      setSummary(nextSummary);
      setUsers(nextUsers);
      setTransactions(nextTransactions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, token]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace("/?auth=login");
      return;
    }
    void loadAdminData();
  }, [hydrated, loadAdminData, router, token]);

  const selectedUserTransactions = useMemo(() => {
    if (!creditUser) return transactions;
    return transactions.filter((transaction) => transaction.user_id === creditUser.id);
  }, [creditUser, transactions]);

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
            <span className="flex size-10 items-center justify-center rounded-2xl bg-fuchsia-500 text-white">
              <Shield className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-white">后台管理端</h1>
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

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="用户总数" value={summary?.users ?? "-"} icon={UserRound} tone="cyan" />
            <StatCard label="可用积分池" value={summary?.total_credits ?? "-"} icon={Coins} tone="amber" />
            <StatCard label="画布流程" value={summary?.flows ?? "-"} icon={LayoutDashboard} tone="violet" />
            <StatCard label="制作资产" value={summary?.assets ?? "-"} icon={WalletCards} tone="emerald" />
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
                  refresh();
                }}
              >
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
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
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-[#111119]/86 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white">生成状态</h2>
                <p className="text-xs text-zinc-500">{summary?.active_users ?? "-"} active / {summary?.disabled_users ?? "-"} disabled</p>
              </div>
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
    </main>
  );
}
