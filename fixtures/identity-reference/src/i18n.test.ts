import { describe, expect, it } from "vitest";
import { createI18nService, type I18nLocaleBundle, defaultSanitizer, defaultRevision } from "./i18n.js";

const enBundle: I18nLocaleBundle = {
  locale: "en",
  namespaces: {
    common: {
      messages: { "cancel": "Cancel", "save": "Save" },
      plurals: {},
    },
    vehicle: {
      messages: { "title": "Vehicles", "greeting": "Hello, {{name}}!" },
      plurals: {
        "car-count": { one: "{{count}} car", other: "{{count}} cars" },
      },
    },
  },
};

const zhBundle: I18nLocaleBundle = {
  locale: "zh",
  namespaces: {
    common: { messages: { "cancel": "取消", "save": "保存" }, plurals: {} },
    vehicle: {
      messages: { "title": "车辆管理" },
      plurals: {
        "car-count": { other: "{{count}} 辆车" },
      },
    },
  },
};

function makeService() {
  const bundles = new Map<string, I18nLocaleBundle>();
  bundles.set("en", enBundle);
  bundles.set("zh", zhBundle);
  return createI18nService({
    loadBundle: async (_tenantId, locale) => bundles.get(locale),
    computeRevision: defaultRevision,
    sanitizeValue: defaultSanitizer,
    now: () => new Date("2026-08-06T00:00:00Z"),
  });
}

describe("i18n reference boundary", () => {
  it("resolves locale from authenticated preference first", () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "zh", acceptLanguage: "en-US,en;q=0.9", tenantDefaultLocale: "en", sourceLocale: "en" };
    expect(svc.resolveLocale(ctx)).toBe("zh");
  });

  it("falls back to accept-language and then tenant default when no preference", () => {
    const svc = makeService();
    const ctx1 = { tenantId: "t1", acceptLanguage: "fr-FR,fr;q=0.9", tenantDefaultLocale: "en", sourceLocale: "en" };
    expect(svc.resolveLocale(ctx1)).toBe("fr-fr");
    const ctx2 = { tenantId: "t1", acceptLanguage: "", tenantDefaultLocale: "en", sourceLocale: "en" };
    expect(svc.resolveLocale(ctx2)).toBe("en");
  });

  it("translates namespace keys with exact match", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    const result = await svc.translate(ctx, { keys: [{ key: "vehicle:title" }] });
    expect(result.locale).toBe("en");
    expect(result.translations[0]).toMatchObject({ key: "vehicle:title", value: "Vehicles", source: "exact" });
  });

  it("falls back to common namespace then source locale then default", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "zh", tenantDefaultLocale: "en", sourceLocale: "en" };
    const result = await svc.translate(ctx, {
      keys: [
        { key: "vehicle:cancel" },
        { key: "vehicle:greeting", params: { name: "World" } },
        { key: "nonexistent:key", fallback: "Fallback" },
      ],
    });
    expect(result.translations[0]!.source).toBe("fallback-namespace");
    expect(result.translations[0]!.value).toBe("取消");
    expect(result.translations[1]!.source).toBe("fallback-locale");
    expect(result.translations[1]!.value).toContain("Hello");
    expect(result.translations[2]!.source).toBe("default");
    expect(result.translations[2]!.value).toBe("Fallback");
  });

  it("selects correct plural forms per locale", async () => {
    const svc = makeService();
    const enCtx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    const zhCtx = { tenantId: "t1", preferredLocale: "zh", tenantDefaultLocale: "en", sourceLocale: "en" };
    const en1 = await svc.translate(enCtx, { keys: [{ key: "vehicle:car-count", count: 1 }] });
    const enN = await svc.translate(enCtx, { keys: [{ key: "vehicle:car-count", count: 5 }] });
    const zhN = await svc.translate(zhCtx, { keys: [{ key: "vehicle:car-count", count: 3 }] });
    expect(en1.translations[0]!.value).toBe("1 car");
    expect(en1.translations[0]!.pluralForm).toBe("one");
    expect(enN.translations[0]!.value).toBe("5 cars");
    expect(enN.translations[0]!.pluralForm).toBe("other");
    expect(zhN.translations[0]!.value).toBe("3 辆车");
    expect(zhN.translations[0]!.pluralForm).toBe("other");
  });

  it("sanitizes HTML in interpolation values", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    const result = await svc.translate(ctx, {
      keys: [{ key: "vehicle:greeting", params: { name: "<script>alert(1)</script>" } }],
    });
    expect(result.translations[0]!.value).not.toContain("<script>");
    expect(result.translations[0]!.value).toContain("&lt;script&gt;");
  });

  it("rejects invalid key patterns with traversal attempts", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    await expect(svc.translate(ctx, { keys: [{ key: "../secret" }] })).rejects.toThrow("invalid-key");
    await expect(svc.translate(ctx, { keys: [{ key: "a%00b" }] })).rejects.toThrow("invalid-key");
    await expect(svc.translate(ctx, { keys: [{ key: "/etc/passwd" }] })).rejects.toThrow("invalid-key");
  });

  it("detects catalog revision conflicts", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    await expect(svc.translate(ctx, { keys: [{ key: "common:save" }], expectedRevision: "deadbeefdeadbeefdeadbeefdeadbeef" })).rejects.toThrow("catalog-revision-conflict");
  });

  it("bounds batch size and param count", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ key: `common:k${i}` }));
    await expect(svc.translate(ctx, { keys: tooMany })).rejects.toThrow("too-many-keys");
  });

  it("returns a consistent content hash as the catalog revision", async () => {
    const svc = makeService();
    const ctx = { tenantId: "t1", preferredLocale: "en", tenantDefaultLocale: "en", sourceLocale: "en" };
    const r1 = await svc.translate(ctx, { keys: [{ key: "common:save" }] });
    const r2 = await svc.translate(ctx, { keys: [{ key: "common:cancel" }] });
    expect(r1.catalogRevision).toHaveLength(32);
    expect(r1.catalogRevision).toBe(r2.catalogRevision);
    expect(r1.catalogRevision).toMatch(/^[a-f0-9]+$/);
  });
});
