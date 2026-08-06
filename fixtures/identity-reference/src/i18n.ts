import { createHash } from "node:crypto";
import type { I18nTranslateCommand, I18nTranslateResult, I18nTranslateKeyResult } from "aiba-spec";

const MAX_FALLBACK_DEPTH = 4;

export const CLDR_PLURAL_CATEGORIES: Record<string, Array<"zero" | "one" | "two" | "few" | "many" | "other">> = {
  en: ["one", "other"],
  zh: ["other"],
  fr: ["one", "other"],
  de: ["one", "other"],
  es: ["one", "other"],
  ja: ["other"],
  ko: ["other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
  ru: ["one", "few", "many", "other"],
};

export interface I18nNamespace {
  messages: Record<string, string>;
  plurals: Record<string, Record<string, string>>;
}

export interface I18nLocaleBundle {
  locale: string;
  namespaces: Record<string, I18nNamespace>;
}

export interface I18nContext {
  tenantId: string;
  preferredLocale?: string;
  acceptLanguage?: string;
  tenantDefaultLocale: string;
  sourceLocale: string;
}

export interface I18nDependencies {
  loadBundle: (tenantId: string, locale: string) => Promise<I18nLocaleBundle | undefined>;
  computeRevision: (bundle: I18nLocaleBundle) => string;
  sanitizeValue: (value: string) => string;
  now: () => Date;
}

const KEY_PATTERN = /^[a-z][a-z0-9.-]{2,119}(:[a-z][a-z0-9.-]{0,119})*$/;

function parseKey(key: string): { namespace: string; path: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { namespace: "common", path: key };
  return { namespace: key.slice(0, idx), path: key.slice(idx + 1) };
}

type PluralForm = "zero" | "one" | "two" | "few" | "many" | "other";

function selectPluralForm(locale: string, count: number): PluralForm {
  const base = locale.split("-")[0];
  const cats: PluralForm[] = (CLDR_PLURAL_CATEGORIES[locale] ?? (base ? CLDR_PLURAL_CATEGORIES[base] : undefined) ?? ["other"]) as PluralForm[];
  if (count === 0 && cats.includes("zero")) return "zero";
  if (count === 1 && cats.includes("one")) return "one";
  if (count === 2 && cats.includes("two")) return "two";
  if (cats.includes("other")) return "other";
  return "other";
}

function resolveLocale(context: I18nContext): string {
  const preferred = context.preferredLocale;
  if (preferred && /^[a-z]{2,3}(-[A-Za-z0-9-]+)*$/.test(preferred)) return preferred;
  if (context.acceptLanguage) {
    const first = context.acceptLanguage.split(",")[0]?.trim().split(";")[0]?.toLowerCase();
    if (first && /^[a-z]{2,3}(-[a-z0-9-]+)*$/i.test(first)) return first;
  }
  return context.tenantDefaultLocale;
}

function interpolate(template: string, params: Record<string, string | number | boolean | null> | undefined, sanitize: (v: string) => string): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (!(name in params)) return match;
    const raw = params[name];
    if (raw === null || raw === undefined) return "";
    return sanitize(String(raw));
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function computeBundleRevision(bundle: I18nLocaleBundle): string {
  return createHash("sha256").update(JSON.stringify(bundle)).digest("hex").slice(0, 32);
}

export function createI18nService(deps: I18nDependencies) {
  const cache = new Map<string, { bundle: I18nLocaleBundle; revision: string }>();

  async function getBundle(tenantId: string, locale: string): Promise<{ bundle: I18nLocaleBundle; revision: string }> {
    const key = `${tenantId}:${locale}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const bundle = await deps.loadBundle(tenantId, locale);
    if (!bundle) throw new Error("locale-unavailable");
    const revision = deps.computeRevision(bundle);
    cache.set(key, { bundle, revision });
    return { bundle, revision };
  }

  function lookup(
    bundle: I18nLocaleBundle,
    key: string,
    count: number | undefined,
  ): { value: string; source: I18nTranslateKeyResult["source"]; pluralForm?: I18nTranslateKeyResult["pluralForm"] } | undefined {
    const { namespace, path } = parseKey(key);
    const ns = bundle.namespaces[namespace];
    if (!ns) return undefined;

    if (count !== undefined) {
      const pluralEntry = ns.plurals[path];
      if (pluralEntry) {
        const form = selectPluralForm(bundle.locale, count);
        if (pluralEntry[form]) {
          return { value: pluralEntry[form], source: "exact", pluralForm: form };
        }
        if (pluralEntry.other) {
          return { value: pluralEntry.other, source: "fallback-namespace", pluralForm: "other" };
        }
      }
    }

    if (ns.messages[path] !== undefined) {
      return { value: ns.messages[path], source: "exact" };
    }

    const common = bundle.namespaces["common"];
    if (common && common.messages[path] !== undefined) {
      return { value: common.messages[path], source: "fallback-namespace" };
    }

    return undefined;
  }

  async function translate(context: I18nContext, command: I18nTranslateCommand): Promise<I18nTranslateResult> {
    if (command.keys.length > 100) throw new Error("too-many-keys");
    const locale = resolveLocale(context);
    if (!/^[a-z]{2,3}(-[A-Za-z0-9-]+)*$/.test(locale)) throw new Error("invalid-locale");

    const { bundle, revision } = await getBundle(context.tenantId, locale);
    const sourceBundle = locale !== context.sourceLocale ? await getBundle(context.tenantId, context.sourceLocale).catch(() => undefined) : undefined;

    if (command.expectedRevision && command.expectedRevision !== revision) {
      throw new Error("catalog-revision-conflict");
    }

    const translations: I18nTranslateKeyResult[] = [];
    let depth = 0;

    for (const item of command.keys) {
      if (!KEY_PATTERN.test(item.key)) throw new Error("invalid-key");
      if (item.params && Object.keys(item.params).length > 32) throw new Error("too-many-params");

      let result = lookup(bundle, item.key, item.count);

      if (!result && sourceBundle) {
        depth++;
        if (depth > MAX_FALLBACK_DEPTH) throw new Error("fallback-depth-exceeded");
        const sourceResult = lookup(sourceBundle.bundle, item.key, item.count);
        if (sourceResult) {
          result = { ...sourceResult, source: "fallback-locale" };
        }
      }

      if (!result) {
        translations.push({
          key: item.key,
          value: item.fallback ?? item.key,
          source: "default",
        });
        continue;
      }

      const params = item.count !== undefined ? { ...item.params, count: item.count } : item.params;
      const value = interpolate(result.value, params, deps.sanitizeValue);
      const entry: I18nTranslateKeyResult = { key: item.key, value, source: result.source };
      if (result.pluralForm !== undefined) entry.pluralForm = result.pluralForm;
      translations.push(entry);
    }

    return {
      locale,
      catalogRevision: revision,
      translations,
      resolvedAt: deps.now().toISOString(),
    };
  }

  return { translate, resolveLocale, escapeHtml, computeBundleRevision };
}

export { escapeHtml as defaultSanitizer, computeBundleRevision as defaultRevision };
