import { describe, expect, it } from "vitest";
import { createResourceQueryBoundary } from "./resource-query.js";

const secret = "0123456789abcdef0123456789abcdef";
const policy = {
  fields: {
    createdAt: ["eq", "gte", "lte"] as const,
    status: ["eq", "in"] as const,
    resourceId: ["eq"] as const,
  },
  stableSortField: "resourceId",
  maximumPageSize: 100,
};

describe("common resource query boundary", () => {
  it("allowlists structured filters and appends a stable tie-breaker", () => {
    const boundary = createResourceQueryBoundary(secret, policy);
    expect(boundary.normalize({
      pageSize: 50,
      filters: [{ field: "status", operator: "in", value: ["active", "pending"] }],
      sort: [{ field: "createdAt", direction: "desc" }],
    }).sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "resourceId", direction: "asc" },
    ]);
  });

  it("rejects unknown fields, raw operators, wrong values, and excessive pages", () => {
    const boundary = createResourceQueryBoundary(secret, policy);
    expect(() => boundary.normalize({
      pageSize: 101,
      filters: [],
      sort: [{ field: "resourceId", direction: "asc" }],
    })).toThrow("page-size-exceeded");
    expect(() => boundary.normalize({
      pageSize: 10,
      filters: [{ field: "tenantId", operator: "eq", value: "tenant-b" }],
      sort: [{ field: "resourceId", direction: "asc" }],
    })).toThrow("filter-not-allowed");
    expect(() => boundary.normalize({
      pageSize: 10,
      filters: [{ field: "status", operator: "eq", value: ["active"] }],
      sort: [{ field: "resourceId", direction: "asc" }],
    })).toThrow("invalid-filter-value");
  });

  it("binds opaque cursors to one query scope and rejects tampering", () => {
    const boundary = createResourceQueryBoundary(secret, policy);
    const cursor = boundary.issueCursor("resource-42", "tenant-a:status=active");
    expect(boundary.readCursor(cursor, "tenant-a:status=active")).toBe("resource-42");
    expect(() => boundary.readCursor(cursor, "tenant-b:status=active")).toThrow("invalid-cursor");
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    expect(() => boundary.readCursor(tampered, "tenant-a:status=active")).toThrow("invalid-cursor");
  });

  it("requires a strong cursor secret and an allowlisted stable sort", () => {
    expect(() => createResourceQueryBoundary("short", policy)).toThrow("cursor secret");
    expect(() => createResourceQueryBoundary(secret, {
      ...policy,
      stableSortField: "missing",
    })).toThrow("stable sort field");
  });
});
