import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { VehicleRecord } from "aiba-spec";
import { createVehicleRecordsHttpHandler } from "./vehicle-records-http.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

async function createFixture(authenticated = true) {
  const calls: Array<{ operation: string; context: unknown; input: unknown }> = [];
  const record: VehicleRecord = {
    vehicleId: "vehicle-000000000001",
    fleetNumber: "FLEET-001",
    plateNumber: "AB1234",
    make: "Example Motors",
    model: "Cargo One",
    year: 2025,
    status: "active",
    mileageKm: 1200,
    revision: 3,
    createdAt: "2026-08-04T00:00:00Z",
    updatedAt: "2026-08-04T00:00:00Z",
  };
  const handler = createVehicleRecordsHttpHandler({
    list: async (context, limit) => {
      calls.push({ operation: "list", context, input: limit });
      return [record];
    },
    update: async (context, input) => {
      calls.push({ operation: "update", context, input });
      return { ...record, ...(input as object), revision: 4 };
    },
  }, {
    resolveContext: async () => authenticated ? {
      principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
      correlationId: "http-vehicle-request-001",
    } : undefined,
  });
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { calls, endpoint: `http://127.0.0.1:${address.port}`, record };
}

describe("vehicle records HTTP surface", () => {
  it("derives tenant context from the authenticated transport", async () => {
    const fixture = await createFixture();
    const response = await fetch(`${fixture.endpoint}/api/vehicles?limit=25`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [fixture.record] });
    expect(fixture.calls[0]).toEqual({
      operation: "list",
      context: {
        principal: { type: "user", subject: "user-42", tenantId: "tenant-a" },
        correlationId: "http-vehicle-request-001",
      },
      input: 25,
    });
  });

  it("maps path identity and bounded mutation fields without client tenant claims", async () => {
    const fixture = await createFixture();
    const response = await fetch(`${fixture.endpoint}/api/vehicles/vehicle-000000000001`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 3, status: "inactive" }),
    });
    expect(response.status).toBe(200);
    expect(fixture.calls[0]?.input).toEqual({
      vehicleId: "vehicle-000000000001",
      expectedRevision: 3,
      status: "inactive",
    });
  });

  it("rejects tenant and authorization injection before the service", async () => {
    const fixture = await createFixture();
    const response = await fetch(`${fixture.endpoint}/api/vehicles/vehicle-000000000001`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 3,
        status: "inactive",
        tenantId: "tenant-b",
        role: "admin",
      }),
    });
    expect(response.status).toBe(400);
    expect(fixture.calls).toEqual([]);
  });

  it("rejects unauthenticated and unbounded list requests", async () => {
    const unauthenticated = await createFixture(false);
    expect((await fetch(`${unauthenticated.endpoint}/api/vehicles`)).status).toBe(401);
    const fixture = await createFixture();
    expect((await fetch(`${fixture.endpoint}/api/vehicles?limit=999`)).status).toBe(400);
    expect((await fetch(`${fixture.endpoint}/api/vehicles?tenantId=tenant-b`)).status).toBe(400);
    expect(fixture.calls).toEqual([]);
  });
});
