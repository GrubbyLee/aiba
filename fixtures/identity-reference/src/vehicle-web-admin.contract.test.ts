import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("vehicle web admin client contract", () => {
  it("uses authenticated same-origin requests without tenant or authorization claims", async () => {
    const source = await readFile(join(process.cwd(), "web-admin", "vehicle-api.js"), "utf8");
    const requests: Array<{ url: string; options: Record<string, unknown> }> = [];
    const module = { exports: {} as { createVehicleApi: (fetchImpl: unknown) => {
      listVehicles(limit: number): Promise<unknown>;
      updateVehicle(id: string, revision: number, status: string): Promise<unknown>;
    } } };
    runInNewContext(source, { globalThis: {}, module });
    const api = module.exports.createVehicleApi(async (
      url: string,
      options: Record<string, unknown>,
    ) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ items: [] }) };
    });
    await api.listVehicles(50);
    await api.updateVehicle("vehicle-000000000001", 3, "inactive");
    expect(requests[0]).toEqual({
      url: "/api/vehicles?limit=50",
      options: { credentials: "same-origin", headers: { accept: "application/json" } },
    });
    const mutation = JSON.parse(String(requests[1]?.options.body)) as Record<string, unknown>;
    expect(mutation).toEqual({ expectedRevision: 3, status: "inactive" });
    expect(JSON.stringify(requests)).not.toContain("tenantId");
    expect(JSON.stringify(requests)).not.toContain("role");
    expect(JSON.stringify(requests)).not.toContain("permission");
  });

  it("renders an operational table without embedding capability rules in markup", async () => {
    const html = await readFile(join(process.cwd(), "web-admin", "index.html"), "utf8");
    expect(html).toContain("data-vehicle-rows");
    expect(html).toContain("Fleet records");
    expect(html).not.toContain("tenantId");
    expect(html).not.toContain("session_key");
  });
});
