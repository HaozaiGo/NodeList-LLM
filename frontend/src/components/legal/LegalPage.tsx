import Link from "next/link";
import { ArrowLeft } from "lucide-react";


export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-10 text-zinc-100 sm:px-8 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
        >
          <ArrowLeft className="size-4" />
          返回 enepath.ai
        </Link>

        <header className="mt-12 border-b border-white/10 pb-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-fuchsia-200">enepath.ai</p>
          <h1 className="mt-4 text-4xl font-bold text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">{description}</p>
          <p className="mt-5 text-xs text-zinc-500">更新日期：2026 年 9 月 1 日</p>
        </header>

        <article className="legal-copy py-9 text-[15px] leading-7 text-zinc-300">{children}</article>

        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 py-7 text-sm text-zinc-500">
          <Link href="/privacy" className="transition hover:text-white">隐私政策</Link>
          <Link href="/terms" className="transition hover:text-white">服务条款</Link>
          <Link href="/" className="transition hover:text-white">返回首页</Link>
        </footer>
      </div>
    </main>
  );
}
