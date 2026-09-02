"use client";

import { Sparkles } from "lucide-react";

import { useBranding } from "@/hooks/useBranding";
import { resolveMediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";


export function BrandMark({
  showName = true,
  logoClassName,
  nameClassName,
}: {
  showName?: boolean;
  logoClassName?: string;
  nameClassName?: string;
}) {
  const branding = useBranding();
  if (!branding || (!branding.logo_url && branding.name.trim() === "NodeList AI")) return null;

  const logoUrl = resolveMediaUrl(branding.logo_url);

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fuchsia-500 text-white shadow-[0_10px_28px_rgba(236,34,208,0.35)]",
          logoClassName
        )}
      >
        {logoUrl ? (
          <img src={logoUrl} alt={`${branding.name} Logo`} className="size-full object-contain" />
        ) : (
          <Sparkles className="size-5" />
        )}
      </span>
      {showName && (
        <span className={cn("truncate text-lg font-bold text-white", nameClassName)}>{branding.name}</span>
      )}
    </span>
  );
}
