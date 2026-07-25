import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ReviewAccessApiError,
  type createReviewAccessApi,
} from "./reviewAccessApi.js";

type ReviewAccessApi = ReturnType<typeof createReviewAccessApi>;

export interface ReviewAccessHttpOptions {
  maximumBodyBytes?: number;
  resolveActorKey?: (request: IncomingMessage) => string;
}

function statusFor(error: ReviewAccessApiError): number {
  switch (error.code) {
    case "invalid-request": return 400;
    case "invalid-credential":
    case "release-mismatch":
    case "session-not-found": return 401;
    case "disabled":
    case "expired":
    case "revoked": return 403;
    case "rate-limited": return 429;
    case "invalid-policy": return 503;
  }
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

async function readJson(request: IncomingMessage, maximumBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBodyBytes) {
      throw new ReviewAccessApiError("Review request is too large", "invalid-request");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ReviewAccessApiError("Review request JSON is invalid", "invalid-request");
  }
}

export function createReviewAccessHttpHandler(
  api: ReviewAccessApi,
  options: ReviewAccessHttpOptions = {},
) {
  const maximumBodyBytes = options.maximumBodyBytes ?? 4096;
  const resolveActorKey = options.resolveActorKey
    ?? ((request: IncomingMessage) => `network:${request.socket.remoteAddress || "unknown"}`);

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== "POST") {
        respond(response, 405, { error: "method-not-allowed" });
        return;
      }
      const body = await readJson(request, maximumBodyBytes);
      if (request.url === "/review/session") {
        respond(response, 201, api.authenticate({ actorKey: resolveActorKey(request) }, body));
        return;
      }
      if (request.url === "/review/catalog") {
        respond(response, 200, api.getReviewCatalog(body));
        return;
      }
      respond(response, 404, { error: "not-found" });
    } catch (error) {
      if (error instanceof ReviewAccessApiError) {
        respond(response, statusFor(error), { error: "review-access-denied" });
        return;
      }
      respond(response, 500, { error: "internal-error" });
    }
  };
}
