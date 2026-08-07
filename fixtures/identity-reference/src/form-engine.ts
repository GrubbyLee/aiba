import type {
  FormFieldDefinition,
  FormScalar,
  FormSchemaCommand,
  FormSchemaResult,
  FormSubmitCommand,
  FormSubmitResult,
  FormValidationError,
  FormValue,
} from "aiba-spec";

const FORM_CODE_PATTERN = /^[a-z][a-z0-9.-]{2,62}$/;
const FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const MAX_FIELDS = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_ARRAY_ITEMS = 200;

export interface FormSchemaDefinition {
  formCode: string;
  revision: number;
  title: string;
  description?: string;
  fields: FormFieldDefinition[];
  enabled: boolean;
}

export interface FormEngineContext {
  tenantId: string;
  principalId: string;
}

export interface FormEngineDependencies {
  loadSchema: (
    tenantId: string,
    formCode: string,
    revision?: number,
  ) => Promise<FormSchemaDefinition | undefined>;
  authorize: (
    context: FormEngineContext,
    action: "schema:read" | "submission:create",
    formCode: string,
  ) => Promise<boolean>;
  verifyFileReference: (input: {
    tenantId: string;
    formCode: string;
    fieldName: string;
    assetId: string;
  }) => Promise<boolean>;
  storeSubmission: (input: {
    tenantId: string;
    principalId: string;
    formCode: string;
    revision: number;
    data: Record<string, FormValue>;
  }) => Promise<string>;
  sanitizeText: (value: string) => string;
  now: () => Date;
}

function isSafePattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 200) return false;
  if (/\\[1-9]/.test(pattern) || pattern.includes("(?")) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function validateSchemaDefinition(schema: FormSchemaDefinition): void {
  if (!FORM_CODE_PATTERN.test(schema.formCode) || !Number.isInteger(schema.revision) || schema.revision < 1) {
    throw new Error("invalid-form-schema");
  }
  if (schema.title.length < 1 || schema.title.length > 200 || schema.fields.length < 1 || schema.fields.length > MAX_FIELDS) {
    throw new Error("invalid-form-schema");
  }
  const names = new Set<string>();
  for (const field of schema.fields) {
    if (!FIELD_NAME_PATTERN.test(field.name) || names.has(field.name) || field.label.length < 1 || field.label.length > 200) {
      throw new Error("invalid-form-schema");
    }
    names.add(field.name);
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      throw new Error("invalid-form-schema");
    }
    if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
      throw new Error("invalid-form-schema");
    }
    if (field.pattern !== undefined && !isSafePattern(field.pattern)) throw new Error("unsafe-field-pattern");
    if ((field.type === "select" || field.type === "multiselect") && (!field.options || field.options.length > 200)) {
      throw new Error("invalid-form-schema");
    }
    if (field.options) {
      const values = new Set<string>();
      for (const option of field.options) {
        const key = `${typeof option.value}:${String(option.value)}`;
        if (values.has(key) || option.label.length < 1 || option.label.length > 200) throw new Error("invalid-form-schema");
        values.add(key);
      }
    }
  }

  const graph = new Map<string, string[]>();
  for (const field of schema.fields) {
    const dependencies = [...(field.dependsOn ?? [])];
    if (field.visibleWhen) dependencies.push(field.visibleWhen.field);
    if (dependencies.some((dependency) => !names.has(dependency) || dependency === field.name)) {
      throw new Error("invalid-field-dependency");
    }
    graph.set(field.name, [...new Set(dependencies)]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visiting.has(name)) throw new Error("field-dependency-cycle");
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of names) visit(name);
}

function cloneValue(value: FormValue): FormValue {
  return Array.isArray(value) ? [...value] : value;
}

function canonicalData(data: Record<string, FormValue>): string {
  const sorted = Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]]));
  return JSON.stringify(sorted);
}

function isMissing(value: FormValue | undefined): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function optionContains(field: FormFieldDefinition, value: FormScalar): boolean {
  return field.options?.some((option) => !option.disabled && option.value === value) ?? false;
}

function addError(errors: FormValidationError[], field: string, code: string, message: string): void {
  errors.push({ field, code, message });
}

export function createFormEngineService(dependencies: FormEngineDependencies) {
  const idempotency = new Map<string, { fingerprint: string; result: FormSubmitResult }>();

  async function loadTrustedSchema(
    context: FormEngineContext,
    command: FormSchemaCommand,
    action: "schema:read" | "submission:create",
  ): Promise<FormSchemaDefinition> {
    if (!FORM_CODE_PATTERN.test(command.formCode)) throw new Error("invalid-form-code");
    if (!await dependencies.authorize(context, action, command.formCode)) throw new Error("form-unavailable");
    const schema = await dependencies.loadSchema(context.tenantId, command.formCode, command.revision);
    if (!schema?.enabled || schema.formCode !== command.formCode || (command.revision !== undefined && schema.revision !== command.revision)) {
      throw new Error("form-unavailable");
    }
    validateSchemaDefinition(schema);
    return schema;
  }

  async function schema(context: FormEngineContext, command: FormSchemaCommand): Promise<FormSchemaResult> {
    const definition = await loadTrustedSchema(context, command, "schema:read");
    return {
      formCode: definition.formCode,
      revision: definition.revision,
      title: dependencies.sanitizeText(definition.title),
      ...(definition.description === undefined ? {} : { description: dependencies.sanitizeText(definition.description) }),
      fields: definition.fields.map((field) => ({
        ...field,
        label: dependencies.sanitizeText(field.label),
        ...(field.placeholder === undefined ? {} : { placeholder: dependencies.sanitizeText(field.placeholder) }),
        ...(field.options === undefined ? {} : {
          options: field.options.map((option) => ({ ...option, label: dependencies.sanitizeText(option.label) })),
        }),
      })),
      loadedAt: dependencies.now().toISOString(),
    };
  }

  async function submit(context: FormEngineContext, command: FormSubmitCommand): Promise<FormSubmitResult> {
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) throw new Error("invalid-form-revision");
    if (command.idempotencyKey.length < 8 || command.idempotencyKey.length > 128) throw new Error("invalid-idempotency-key");
    let serialized: string;
    try {
      serialized = canonicalData(command.data);
    } catch {
      throw new Error("invalid-form-data");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("form-data-too-large");
    const fingerprint = `${command.formCode}:${command.expectedRevision}:${serialized}`;
    const idempotencyKey = `${context.tenantId}:${context.principalId}:${command.idempotencyKey}`;
    const prior = idempotency.get(idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("idempotency-conflict");
      return { ...prior.result, errors: [...prior.result.errors], ...(prior.result.data ? { data: { ...prior.result.data } } : {}) };
    }

    const definition = await loadTrustedSchema(
      context,
      { formCode: command.formCode, revision: command.expectedRevision },
      "submission:create",
    );
    const fields = new Map(definition.fields.map((field) => [field.name, field]));
    const errors: FormValidationError[] = [];
    const normalized: Record<string, FormValue> = {};

    for (const name of Object.keys(command.data)) {
      if (!fields.has(name)) addError(errors, name, "unknown-field", "Field is not declared by this form revision.");
    }
    for (const field of definition.fields) {
      const value = command.data[field.name];
      const visible = !field.visibleWhen || command.data[field.visibleWhen.field] === field.visibleWhen.equals;
      if (!visible) {
        if (value !== undefined) addError(errors, field.name, "hidden-field", "Hidden fields cannot be submitted.");
        continue;
      }
      if (field.readonly && value !== undefined) {
        addError(errors, field.name, "readonly-field", "Readonly fields cannot be submitted.");
        continue;
      }
      if (isMissing(value)) {
        if (field.required) addError(errors, field.name, "required", "A value is required.");
        continue;
      }
      if (value === undefined || value === null) continue;

      if (field.type === "multiselect") {
        if (!Array.isArray(value) || value.length > Math.min(field.maximumSelections ?? MAX_ARRAY_ITEMS, MAX_ARRAY_ITEMS)
          || value.some((item) => item === null || Array.isArray(item) || !optionContains(field, item))) {
          addError(errors, field.name, "invalid-selection", "Selections must be enabled declared options within the configured limit.");
        } else {
          normalized[field.name] = cloneValue(value);
        }
        continue;
      }
      if (Array.isArray(value)) {
        addError(errors, field.name, "invalid-type", "A scalar value is required.");
        continue;
      }
      if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value) || (field.minimum !== undefined && value < field.minimum)
          || (field.maximum !== undefined && value > field.maximum)) {
          addError(errors, field.name, "invalid-number", "Number is outside the declared bounds.");
        } else normalized[field.name] = value;
        continue;
      }
      if (field.type === "boolean") {
        if (typeof value !== "boolean") addError(errors, field.name, "invalid-boolean", "A boolean value is required.");
        else normalized[field.name] = value;
        continue;
      }
      if (typeof value !== "string") {
        addError(errors, field.name, "invalid-string", "A string value is required.");
        continue;
      }
      if ((field.minLength !== undefined && value.length < field.minLength)
        || value.length > Math.min(field.maxLength ?? 10_000, 10_000)) {
        addError(errors, field.name, "invalid-length", "String is outside the declared bounds.");
        continue;
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        addError(errors, field.name, "pattern-mismatch", "String does not match the declared format.");
        continue;
      }
      if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        addError(errors, field.name, "invalid-date", "Date must use YYYY-MM-DD format.");
        continue;
      }
      if (field.type === "select" && !optionContains(field, value)) {
        addError(errors, field.name, "invalid-selection", "Value must be an enabled declared option.");
        continue;
      }
      if (field.type === "file" && !await dependencies.verifyFileReference({
        tenantId: context.tenantId,
        formCode: command.formCode,
        fieldName: field.name,
        assetId: value,
      })) {
        addError(errors, field.name, "invalid-file-reference", "File reference is unavailable for this form.");
        continue;
      }
      normalized[field.name] = value;
    }

    const submittedAt = dependencies.now().toISOString();
    let result: FormSubmitResult;
    if (errors.length > 0) {
      result = { formCode: command.formCode, revision: definition.revision, valid: false, errors, submittedAt };
    } else {
      const submissionId = await dependencies.storeSubmission({
        tenantId: context.tenantId,
        principalId: context.principalId,
        formCode: command.formCode,
        revision: definition.revision,
        data: normalized,
      });
      result = { formCode: command.formCode, revision: definition.revision, submissionId, valid: true, errors: [], data: normalized, submittedAt };
    }
    idempotency.set(idempotencyKey, { fingerprint, result });
    return result;
  }

  return { schema, submit };
}
