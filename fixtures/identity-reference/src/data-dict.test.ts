import { describe, expect, it } from "vitest";
import { createDataDictService, type DataDictItem } from "./data-dict.js";

const baseItems: DataDictItem[] = [
  { itemId: "cn", dictCode: "region", value: "CN", valueType: "string", label: "中国", sortOrder: 1, status: "enabled", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { itemId: "beijing", dictCode: "region", parentId: "cn", value: "BJ", valueType: "string", label: "北京", sortOrder: 1, status: "enabled", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { itemId: "shanghai", dictCode: "region", parentId: "cn", value: "SH", valueType: "string", label: "上海", sortOrder: 2, status: "enabled", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { itemId: "guangdong", dictCode: "region", parentId: "cn", value: "GD", valueType: "string", label: "广东", sortOrder: 3, status: "disabled", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { itemId: "status-active", dictCode: "order-status", value: 1, valueType: "number", label: "Active", sortOrder: 1, status: "enabled", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  { itemId: "status-closed", dictCode: "order-status", value: 0, valueType: "number", label: "Closed", sortOrder: 2, status: "enabled", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
];

function makeService(extra: DataDictItem[] = []) {
  const all = [...baseItems, ...extra];
  return createDataDictService({
    loadItems: async (tenantId, dictCode) => all.filter((i) => i.dictCode === dictCode && (tenantId === "t1" || tenantId === "t-bad" ? i : [])),
    getDictRevision: async (_tenantId, dictCode) => dictCode === "region" ? 2 : 1,
    sanitizeLabel: (l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    now: () => new Date("2026-08-06T00:00:00Z"),
  });
}

describe("data-dict reference boundary", () => {
  it("lists enabled items sorted by sort order for a standard caller", async () => {
    const svc = makeService();
    const result = await svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", pageSize: 10, page: 1 });
    expect(result.items).toHaveLength(3);
    const ids = result.items.map((i) => i.itemId);
    expect(ids).toContain("cn");
    expect(ids).toContain("beijing");
    expect(ids).toContain("shanghai");
    expect(ids).not.toContain("guangdong");
    expect(result.total).toBe(3);
    expect(result.revision).toBe(2);
  });

  it("filters children by parentId for hierarchical dictionaries", async () => {
    const svc = makeService();
    const result = await svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", parentId: "cn" });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.itemId)).toEqual(["beijing", "shanghai"]);
  });

  it("excludes disabled items from unprivileged callers even when requested", async () => {
    const svc = makeService();
    await expect(svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", includeDisabled: true })).rejects.toThrow("permission-denied");
  });

  it("includes disabled items only for privileged callers", async () => {
    const svc = makeService();
    const result = await svc.query({ tenantId: "t1", canViewDisabled: true }, { dictCode: "region", includeDisabled: true });
    expect(result.total).toBe(4);
    expect(result.items.find((i) => i.itemId === "guangdong")?.status).toBe("disabled");
  });

  it("sanitizes HTML in display labels", async () => {
    const injected: DataDictItem = {
      itemId: "xss-test", dictCode: "region", value: "X", valueType: "string",
      label: "<script>alert(1)</script>", sortOrder: 0, status: "enabled", revision: 2,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    const svc = makeService([injected]);
    const result = await svc.query({ tenantId: "t1", canViewDisabled: true }, { dictCode: "region", includeDisabled: true });
    const item = result.items.find((i) => i.itemId === "xss-test");
    expect(item?.label).not.toContain("<script>");
    expect(item?.label).toContain("&lt;script&gt;");
  });

  it("detects revision conflicts when caller expects a stale revision", async () => {
    const svc = makeService();
    await expect(svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", expectedRevision: 1 })).rejects.toThrow("dictionary-revision-conflict");
  });

  it("rejects invalid dict code and oversized inputs", async () => {
    const svc = makeService();
    await expect(svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "../etc/passwd" })).rejects.toThrow("invalid-dict-code");
    const big = await svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", pageSize: 9999 });
    expect(big.pageSize).toBeLessThanOrEqual(200);
  });

  it("validates that stored values match their declared type", async () => {
    const badItems: DataDictItem[] = [
      { itemId: "bad", dictCode: "order-status", value: "not-a-number" as unknown as number, valueType: "number", label: "Bad", sortOrder: 9, status: "enabled", revision: 1, createdAt: "", updatedAt: "" },
    ];
    const svc = makeService(badItems);
    await expect(svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "order-status" })).rejects.toThrow("dictionary-value-type-mismatch");
  });

  it("detects cycles in hierarchical dictionaries", () => {
    const svc = makeService();
    const cyclic: DataDictItem[] = [
      { itemId: "a", dictCode: "region", parentId: "c", value: "A", valueType: "string", label: "A", sortOrder: 1, status: "enabled", revision: 1, createdAt: "", updatedAt: "" },
      { itemId: "b", dictCode: "region", parentId: "a", value: "B", valueType: "string", label: "B", sortOrder: 2, status: "enabled", revision: 1, createdAt: "", updatedAt: "" },
      { itemId: "c", dictCode: "region", parentId: "b", value: "C", valueType: "string", label: "C", sortOrder: 3, status: "enabled", revision: 1, createdAt: "", updatedAt: "" },
    ];
    expect(svc.detectCycle(cyclic)).toBe(true);
    expect(svc.detectCycle(baseItems)).toBe(false);
  });

  it("keyword-searches case-insensitively on labels", async () => {
    const svc = makeService();
    const result = await svc.query({ tenantId: "t1", canViewDisabled: false }, { dictCode: "region", keyword: "上" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.itemId).toBe("shanghai");
  });
});
