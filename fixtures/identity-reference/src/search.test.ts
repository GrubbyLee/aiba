import { describe, expect, it } from "vitest";
import { createSearchService, type SearchDocument } from "./search.js";

const documents: SearchDocument[] = [
  { tenantId: "tenant-a", resourceType: "task", resourceId: "task-1", title: "EV 01", text: "Electric fleet car" },
  { tenantId: "tenant-a", resourceType: "task", resourceId: "task-secret", title: "Secret EV", text: "Electric confidential" },
  { tenantId: "tenant-a", resourceType: "report", resourceId: "report-1", title: "Fleet", text: "Electric report" },
  { tenantId: "tenant-b", resourceType: "task", resourceId: "task-b", title: "Other", text: "Electric other tenant" },
];
function service() { return createSearchService({ listCandidates: async () => documents, authorize: async (_context, document) => document.resourceId !== "task-secret", allowedResourceTypes: ["task", "report"], cursorSecret: "search-cursor-secret-with-thirty-two-bytes" }); }
const context = { tenantId: "tenant-a", principalId: "user-1" };

describe("search reference boundary", () => {
  it("filters tenant and authorization before returning matches", async () => {
    const page = await service().search(context, { term: "electric", resourceTypes: ["task"], pageSize: 10 });
    expect(page.items.map((item) => item.resourceId)).toEqual(["task-1"]);
    expect(JSON.stringify(page)).not.toContain("task-secret");
    expect(JSON.stringify(page)).not.toContain("task-b");
  });
  it("paginates authorized results with an opaque bound cursor", async () => {
    const first = await service().search(context, { term: "electric", resourceTypes: ["task", "report"], pageSize: 1 });
    expect(first).toMatchObject({ hasMore: true });
    expect(first.nextCursor).toBeDefined();
    const second = await service().search(context, { term: "electric", resourceTypes: ["task", "report"], pageSize: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.resourceId).not.toBe(first.items[0]!.resourceId);
  });
  it("rejects tampered and cross-principal cursors", async () => {
    const first = await service().search(context, { term: "electric", resourceTypes: ["task", "report"], pageSize: 1 });
    expect(first.nextCursor).toBeDefined();
    await expect(service().search(context, { term: "electric", resourceTypes: ["task", "report"], pageSize: 1, cursor: `${first.nextCursor}x` })).rejects.toThrow("invalid-cursor");
    await expect(service().search({ ...context, principalId: "user-2" }, { term: "electric", resourceTypes: ["task", "report"], pageSize: 1, cursor: first.nextCursor! })).rejects.toThrow("invalid-cursor");
  });
  it("rejects unknown resource types and excessive pages", async () => {
    await expect(service().search(context, { term: "electric", resourceTypes: ["secret-index"], pageSize: 10 })).rejects.toThrow("search-query-invalid");
    await expect(service().search(context, { term: "electric", resourceTypes: ["task"], pageSize: 51 })).rejects.toThrow("search-query-invalid");
  });
});
