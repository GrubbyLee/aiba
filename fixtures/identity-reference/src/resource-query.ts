import { createHmac, timingSafeEqual } from "node:crypto";
import type { ResourceFilter, ResourceQuery } from "aiba-spec";

export interface QueryPolicy {
  fields: Readonly<Record<string, readonly ResourceFilter["operator"][]>>;
  stableSortField: string;
  maximumPageSize: number;
}

interface CursorPayload {
  version: 1;
  position: string;
  scope: string;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createResourceQueryBoundary(secret: string, policy: QueryPolicy) {
  if (Buffer.byteLength(secret) < 32) throw new Error("cursor secret must contain at least 32 bytes");
  if (!policy.fields[policy.stableSortField]) throw new Error("stable sort field must be allowlisted");

  function normalize(query: ResourceQuery): ResourceQuery {
    if (query.pageSize > policy.maximumPageSize) throw new Error("page-size-exceeded");
    for (const filter of query.filters) {
      if (!policy.fields[filter.field]?.includes(filter.operator)) throw new Error("filter-not-allowed");
      if (filter.operator === "in" && !Array.isArray(filter.value)) throw new Error("invalid-filter-value");
      if (filter.operator !== "in" && Array.isArray(filter.value)) throw new Error("invalid-filter-value");
    }
    for (const sort of query.sort) {
      if (!policy.fields[sort.field]) throw new Error("sort-not-allowed");
    }
    const sort = query.sort.some((item) => item.field === policy.stableSortField)
      ? query.sort
      : [...query.sort, { field: policy.stableSortField, direction: "asc" as const }];
    return { ...query, filters: [...query.filters], sort };
  }

  function issueCursor(position: string, scope: string): string {
    if (!position || !scope) throw new Error("cursor fields are required");
    const body = encode(JSON.stringify({ version: 1, position, scope } satisfies CursorPayload));
    return `${body}.${sign(body, secret)}`;
  }

  function readCursor(cursor: string, expectedScope: string): string {
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra) throw new Error("invalid-cursor");
    const actual = Buffer.from(signature, "base64url");
    const expected = Buffer.from(sign(body, secret), "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid-cursor");
    let payload: CursorPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
    } catch {
      throw new Error("invalid-cursor");
    }
    if (payload.version !== 1 || payload.scope !== expectedScope || !payload.position) {
      throw new Error("invalid-cursor");
    }
    return payload.position;
  }

  return { issueCursor, normalize, readCursor };
}
