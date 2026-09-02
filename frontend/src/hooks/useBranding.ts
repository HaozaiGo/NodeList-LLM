"use client";

import { useEffect, useState } from "react";

import { getBrandingConfig, type BrandingConfig } from "@/lib/api";


export function useBranding() {
  const [branding, setBranding] = useState<BrandingConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getBrandingConfig()
        .then((nextBranding) => {
          if (cancelled) return;
          setBranding(nextBranding);
          document.title = `${nextBranding.name} 视频制作工作台`;
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("nodelist:branding-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("nodelist:branding-updated", refresh);
    };
  }, []);

  return branding;
}
