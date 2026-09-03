"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { getGoogleAuthConfig, type GoogleAuthConfig } from "@/lib/api";
import { useLocale } from "@/components/i18n/I18nProvider";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

let googleScriptPromise: Promise<void> | null = null;
let googleConfigPromise: Promise<GoogleAuthConfig> | null = null;
const builtGoogleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";

function getGoogleConfig() {
  if (builtGoogleClientId) {
    return Promise.resolve({ enabled: true, client_id: builtGoogleClientId });
  }
  if (!googleConfigPromise) googleConfigPromise = getGoogleAuthConfig();
  return googleConfigPromise;
}

function loadGoogleIdentityScript() {
  if (window.google) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    const onLoad = () => resolve();
    const onError = () => {
      googleScriptPromise = null;
      reject(new Error("Google Identity Services 加载失败"));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return googleScriptPromise;
}

export function preloadGoogleSignIn() {
  if (typeof window === "undefined") return;
  void getGoogleConfig()
    .then((config) => {
      if (config.enabled && config.client_id) return loadGoogleIdentityScript();
    })
    .catch(() => {});
}

export function GoogleSignInButton({
  loading,
  onCredential,
  onError,
  onAvailabilityChange,
}: {
  loading: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  onAvailabilityChange: (available: boolean) => void;
}) {
  const { locale } = useLocale();
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  const [config, setConfig] = useState<GoogleAuthConfig | null>(
    builtGoogleClientId ? { enabled: true, client_id: builtGoogleClientId } : null
  );
  const [configResolved, setConfigResolved] = useState(Boolean(builtGoogleClientId));
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
    onAvailabilityChangeRef.current = onAvailabilityChange;
  }, [onAvailabilityChange, onCredential, onError]);

  useEffect(() => {
    if (builtGoogleClientId) {
      onAvailabilityChangeRef.current(true);
      return;
    }
    let cancelled = false;
    void getGoogleConfig()
      .then((nextConfig) => {
        if (cancelled) return;
        setConfig(nextConfig);
        setConfigResolved(true);
        onAvailabilityChangeRef.current(nextConfig.enabled && Boolean(nextConfig.client_id));
      })
      .catch(() => {
        if (cancelled) return;
        setConfigResolved(true);
        onAvailabilityChangeRef.current(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.enabled || !config.client_id || !buttonRef.current) return;
    const buttonElement = buttonRef.current;
    let cancelled = false;
    void loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google) return;
        buttonElement.replaceChildren();
        window.google.accounts.id.initialize({
          client_id: config.client_id,
          callback: (response) => {
            if (response.credential) onCredentialRef.current(response.credential);
            else onErrorRef.current("Google 未返回有效登录凭据");
          },
        });
        window.google.accounts.id.renderButton(buttonElement, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          locale: locale === "zh" ? "zh_CN" : "en_US",
          width: Math.max(280, Math.floor(buttonElement.clientWidth)),
        });
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        onErrorRef.current(error instanceof Error ? error.message : "Google 登录组件加载失败");
      });
    return () => {
      cancelled = true;
      buttonElement.replaceChildren();
    };
  }, [config, locale]);

  if (configResolved && (!config?.enabled || !config.client_id)) return null;

  return (
    <div className="relative h-11 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div ref={buttonRef} className="flex h-11 w-full justify-center" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-zinc-400" role="status">
          {status === "loading" && <LoaderCircle className="size-4 animate-spin" />}
          {status === "loading" ? "正在准备 Google 登录" : "Google 登录暂时无法加载"}
        </div>
      )}
      {loading && <span className="absolute inset-0 cursor-wait bg-black/45" aria-hidden />}
    </div>
  );
}
