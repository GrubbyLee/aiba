import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SearchPage, SearchQuery, SearchResultItem } from "aiba-spec";

export interface SearchContext { tenantId: string; principalId: string }
export interface SearchDocument { tenantId: string; resourceType: string; resourceId: string; title: string; text: string }
export interface SearchDependencies {
  listCandidates: (tenantId: string, resourceTypes: string[]) => Promise<SearchDocument[]>;
  authorize: (context: SearchContext, document: SearchDocument) => Promise<boolean>;
  allowedResourceTypes: readonly string[];
  cursorSecret: string;
}

function sign(body: string, secret: string): string { return createHmac("sha256", secret).update(body).digest("base64url"); }
function scope(context: SearchContext, query: SearchQuery): string {
  return createHash("sha256").update(JSON.stringify([context.tenantId, context.principalId, query.term.trim().toLocaleLowerCase(), [...query.resourceTypes].sort()])).digest("hex");
}
function issueCursor(offset: number, expectedScope: string, secret: string): string {
  const body = Buffer.from(JSON.stringify({ version: 1, offset, scope: expectedScope })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}
function readCursor(cursor: string, expectedScope: string, secret: string): number {
  const [body, supplied, extra] = cursor.split(".");
  if (!body || !supplied || extra) throw new Error("invalid-cursor");
  const actual = Buffer.from(supplied, "base64url");
  const expected = Buffer.from(sign(body, secret), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid-cursor");
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { version?: unknown; offset?: unknown; scope?: unknown };
    if (value.version !== 1 || !Number.isInteger(value.offset) || (value.offset as number) < 0 || value.scope !== expectedScope) throw new Error("invalid-cursor");
    return value.offset as number;
  } catch { throw new Error("invalid-cursor"); }
}

export function createSearchService(dependencies: SearchDependencies) {
  if (Buffer.byteLength(dependencies.cursorSecret) < 32) throw new Error("cursor-secret-too-short");
  async function search(context: SearchContext, query: SearchQuery): Promise<SearchPage> {
    if (query.pageSize < 1 || query.pageSize > 50 || query.term.trim().length === 0
      || query.resourceTypes.some((type) => !dependencies.allowedResourceTypes.includes(type))) throw new Error("search-query-invalid");
    const queryScope = scope(context, query);
    const offset = query.cursor ? readCursor(query.cursor, queryScope, dependencies.cursorSecret) : 0;
    const candidates = await dependencies.listCandidates(context.tenantId, query.resourceTypes);
    const authorized: SearchDocument[] = [];
    for (const document of candidates) {
      if (document.tenantId === context.tenantId && query.resourceTypes.includes(document.resourceType)
        && await dependencies.authorize(context, document)) authorized.push(document);
    }
    const term = query.term.trim().toLocaleLowerCase();
    const matches = authorized.filter((document) => `${document.title}\n${document.text}`.toLocaleLowerCase().includes(term))
      .sort((left, right) => left.resourceType.localeCompare(right.resourceType) || left.resourceId.localeCompare(right.resourceId));
    const selected = matches.slice(offset, offset + query.pageSize);
    const items: SearchResultItem[] = selected.map((document) => ({ resourceType: document.resourceType, resourceId: document.resourceId, title: document.title.slice(0, 300), snippet: document.text.slice(0, 500) }));
    const hasMore = offset + selected.length < matches.length;
    return { items, hasMore, ...(hasMore ? { nextCursor: issueCursor(offset + selected.length, queryScope, dependencies.cursorSecret) } : {}) };
  }
  return { search };
}
