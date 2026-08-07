import type { DataDictItemRecord, DataDictQueryCommand, DataDictQueryResult } from "aiba-spec";

const MAX_PAGE_SIZE = 200;
const MAX_PAGE = 10_000;

export type DictValueType = "string" | "number" | "boolean";

export interface DataDictItem {
  itemId: string;
  dictCode: string;
  parentId?: string;
  value: string | number | boolean;
  valueType: DictValueType;
  label: string;
  sortOrder: number;
  status: "enabled" | "disabled";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataDictContext {
  tenantId: string;
  canViewDisabled: boolean;
}

export interface DataDictDependencies {
  loadItems: (tenantId: string, dictCode: string) => Promise<DataDictItem[]>;
  getDictRevision: (tenantId: string, dictCode: string) => Promise<number>;
  sanitizeLabel: (label: string) => string;
  now: () => Date;
}

const DICT_CODE_PATTERN = /^[a-z][a-z0-9.-]{2,62}$/;
const ITEM_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

function validateValue(value: string | number | boolean, type: DictValueType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string" && value.length <= 255;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createDataDictService(deps: DataDictDependencies) {
  async function query(
    context: DataDictContext,
    command: DataDictQueryCommand,
  ): Promise<DataDictQueryResult> {
    if (!DICT_CODE_PATTERN.test(command.dictCode)) throw new Error("invalid-dict-code");
    if (command.parentId && !ITEM_ID_PATTERN.test(command.parentId)) throw new Error("invalid-parent-id");
    if (command.keyword && command.keyword.length > 100) throw new Error("keyword-too-long");
    const page = Math.min(Math.max(1, command.page ?? 1), MAX_PAGE);
    const pageSize = Math.min(Math.max(1, command.pageSize ?? 20), MAX_PAGE_SIZE);

    const revision = await deps.getDictRevision(context.tenantId, command.dictCode);
    if (command.expectedRevision !== undefined && command.expectedRevision !== revision) {
      throw new Error("dictionary-revision-conflict");
    }

    let items = await deps.loadItems(context.tenantId, command.dictCode);

    // Tenant isolation: each item must match the dictCode being queried
    items = items.filter((item) => item.dictCode === command.dictCode);

    // Type validation: every stored value must match its declared type
    for (const item of items) {
      if (!validateValue(item.value, item.valueType)) {
        throw new Error("dictionary-value-type-mismatch");
      }
    }

    // Filter by parent
    if (command.parentId) {
      items = items.filter((item) => item.parentId === command.parentId);
    }

    // Filter by status
    if (!context.canViewDisabled && !command.includeDisabled) {
      items = items.filter((item) => item.status === "enabled");
    } else if (!context.canViewDisabled && command.includeDisabled) {
      throw new Error("permission-denied");
    }

    // Keyword search on label
    if (command.keyword) {
      const kw = command.keyword.toLowerCase();
      items = items.filter((item) => item.label.toLowerCase().includes(kw));
    }

    // Sort
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.itemId.localeCompare(b.itemId));

    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    // Sanitize labels for output
    const sanitized: DataDictItemRecord[] = paged.map((item) => ({
      itemId: item.itemId,
      dictCode: item.dictCode,
      ...(item.parentId === undefined ? {} : { parentId: item.parentId }),
      value: item.value,
      valueType: item.valueType,
      label: deps.sanitizeLabel(item.label),
      sortOrder: item.sortOrder,
      status: item.status,
      revision: item.revision,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return {
      dictCode: command.dictCode,
      revision,
      items: sanitized,
      page,
      pageSize,
      total,
      queriedAt: deps.now().toISOString(),
    };
  }

  // Validate a value against its dictionary (used by mutation / write paths)
  function validate(dictCode: string, value: string | number | boolean, items: DataDictItem[]): boolean {
    return items.some((item) => item.dictCode === dictCode && item.value === value && item.status === "enabled");
  }

  function detectCycle(items: DataDictItem[]): boolean {
    const byId = new Map(items.map((i) => [i.itemId, i]));
    const visited = new Set<string>();
    for (const item of items) {
      let current: DataDictItem | undefined = item;
      const path = new Set<string>();
      while (current) {
        if (path.has(current.itemId)) return true;
        if (visited.has(current.itemId)) break;
        path.add(current.itemId);
        visited.add(current.itemId);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return false;
  }

  return { query, validate, detectCycle, escapeHtml };
}

export { escapeHtml as defaultLabelSanitizer };
