import type { IncomingMessage, ServerResponse } from "node:http";
import type { VehicleRecord } from "aiba-spec";
import type { VehicleContext, createVehicleRecordsService } from "./vehicle-records.js";

type VehicleService = Pick<ReturnType<typeof createVehicleRecordsService>, "list" | "update">;

export interface VehicleHttpOptions {
  resolveContext(request: IncomingMessage): Promise<VehicleContext | undefined>;
  maximumBodyBytes?: number;
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(json),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(json);
}

async function readJson(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error("body-too-large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function updateBody(value: unknown, vehicleId: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid-update-body");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["expectedRevision", "status", "mileageKm"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("invalid-update-field");
  }
  return { vehicleId, ...input };
}

export function createVehicleRecordsHttpHandler(
  service: VehicleService,
  options: VehicleHttpOptions,
) {
  const maximumBodyBytes = options.maximumBodyBytes ?? 4096;
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const context = await options.resolveContext(request);
      if (!context) {
        respond(response, 401, { error: "authentication-required" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://aiba.invalid");
      if (request.method === "GET" && url.pathname === "/api/vehicles") {
        if ([...url.searchParams.keys()].some((key) => key !== "limit")) {
          respond(response, 400, { error: "invalid-request" });
          return;
        }
        const limitText = url.searchParams.get("limit") ?? "50";
        if (!/^[1-9][0-9]{0,2}$/.test(limitText)) {
          respond(response, 400, { error: "invalid-request" });
          return;
        }
        const limit = Number(limitText);
        if (limit > 200) {
          respond(response, 400, { error: "invalid-request" });
          return;
        }
        const items = await service.list(context, limit);
        respond(response, 200, { items });
        return;
      }
      const match = /^\/api\/vehicles\/([A-Za-z0-9_-]{16,255})$/.exec(url.pathname);
      if (request.method === "PATCH" && match && !url.search) {
        const body = updateBody(await readJson(request, maximumBodyBytes), match[1]!);
        const record: VehicleRecord = await service.update(context, body);
        respond(response, 200, record);
        return;
      }
      respond(response, 404, { error: "not-found" });
    } catch {
      respond(response, 400, { error: "vehicle-request-rejected" });
    }
  };
}
