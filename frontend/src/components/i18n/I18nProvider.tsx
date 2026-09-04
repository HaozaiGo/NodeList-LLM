"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";

import { recoverSourceText, translateUiText, type Locale } from "@/lib/i18n";


const STORAGE_KEY = "enepath_locale";
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);
const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);
const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const appliedAttributes = new WeakMap<Element, Map<string, string>>();

function isLocalizationDisabled(element: Element | null) {
  return !element || Boolean(element.closest("[data-no-i18n], [contenteditable='true']"));
}

function shouldSkipText(element: Element | null) {
  return isLocalizationDisabled(element) || Boolean(element && SKIP_TEXT_TAGS.has(element.tagName));
}

function localizeTextNode(node: Text, locale: Locale) {
  if (shouldSkipText(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  const previousApplied = appliedText.get(node);
  let source = originalText.get(node);
  if (!source || (previousApplied !== undefined && current !== previousApplied)) {
    source = recoverSourceText(current);
    originalText.set(node, source);
  }
  const trimmed = source.trim();
  const translated = trimmed ? translateUiText(trimmed, locale) : trimmed;
  const target = trimmed && translated !== trimmed ? source.replace(trimmed, translated) : source;
  appliedText.set(node, target);
  if (current !== target) node.nodeValue = target;
}

function localizeElementAttributes(element: Element, locale: Locale) {
  if (isLocalizationDisabled(element)) return;
  let originals = originalAttributes.get(element);
  let applied = appliedAttributes.get(element);
  if (!originals) {
    originals = new Map();
    originalAttributes.set(element, originals);
  }
  if (!applied) {
    applied = new Map();
    appliedAttributes.set(element, applied);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const previousApplied = applied.get(attribute);
    if (!originals.has(attribute) || (previousApplied !== undefined && current !== previousApplied)) {
      originals.set(attribute, recoverSourceText(current));
    }
    const source = originals.get(attribute) ?? current;
    const target = translateUiText(source, locale);
    applied.set(attribute, target);
    if (current !== target) element.setAttribute(attribute, target);
  }
}

function localizeTree(root: Node, locale: Locale) {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, locale);
    return;
  }
  if (!(root instanceof Element)) return;
  localizeElementAttributes(root, locale);
  if (shouldSkipText(root)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node as Text, locale);
    else localizeElementAttributes(node as Element, locale);
    node = walker.nextNode();
  }
}

function readSavedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside I18nProvider");
  return context;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const activeLocale = useRef<Locale>("en");
  const observer = useRef<MutationObserver | null>(null);

  const applyLocale = (nextLocale: Locale) => {
    activeLocale.current = nextLocale;
    document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
    localizeTree(document.body, nextLocale);
    document.documentElement.dataset.i18nReady = "true";
  };

  const setLocale = (nextLocale: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {}
    setLocaleState(nextLocale);
    applyLocale(nextLocale);
  };

  useLayoutEffect(() => {
    const savedLocale = readSavedLocale();
    applyLocale(savedLocale);
    queueMicrotask(() => setLocaleState(savedLocale));
    observer.current = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTextNode(mutation.target as Text, activeLocale.current);
        if (mutation.type === "attributes") localizeElementAttributes(mutation.target as Element, activeLocale.current);
        mutation.addedNodes.forEach((node) => localizeTree(node, activeLocale.current));
      }
    });
    observer.current.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES],
    });
    return () => observer.current?.disconnect();
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
      <div
        data-no-i18n
        className="fixed bottom-4 right-4 z-[120] flex h-10 items-center gap-1 rounded-lg border border-white/15 bg-[#17171d]/95 p-1 text-xs font-semibold text-zinc-300 shadow-2xl backdrop-blur-xl"
        role="group"
        aria-label={locale === "en" ? "Language" : "语言"}
      >
        <Languages className="mx-1 size-4 text-zinc-400" aria-hidden />
        <button
          type="button"
          onClick={() => setLocale("en")}
          className={`h-8 min-w-10 rounded-md px-2 transition ${locale === "en" ? "bg-white text-zinc-950" : "hover:bg-white/10"}`}
          aria-pressed={locale === "en"}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLocale("zh")}
          className={`h-8 min-w-10 rounded-md px-2 transition ${locale === "zh" ? "bg-white text-zinc-950" : "hover:bg-white/10"}`}
          aria-pressed={locale === "zh"}
        >
          中文
        </button>
      </div>
    </LocaleContext.Provider>
  );
}
