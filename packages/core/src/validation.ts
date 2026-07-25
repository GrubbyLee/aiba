import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  loadProtocolSchema,
  type CapabilityManifest,
  type CapabilityReceipt,
  type ProjectManifest,
} from "@aiba/spec";
import { ProtocolValidationError } from "./errors.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value)),
});

const capabilityValidator = ajv.compile<CapabilityManifest>(
  loadProtocolSchema("capability.schema.json"),
);
const projectValidator = ajv.compile<ProjectManifest>(
  loadProtocolSchema("project.schema.json"),
);
const receiptValidator = ajv.compile<CapabilityReceipt>(
  loadProtocolSchema("receipt.schema.json"),
);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "is invalid"}`;
  });
}

function assertValid<T>(
  validator: ValidateFunction<T>,
  value: unknown,
  documentType: string,
): asserts value is T {
  if (!validator(value)) {
    throw new ProtocolValidationError(documentType, formatErrors(validator.errors));
  }
}

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  assertValid(capabilityValidator, value, "capability manifest");
  return value as CapabilityManifest;
}

export function validateProjectManifest(value: unknown): ProjectManifest {
  assertValid(projectValidator, value, "project manifest");
  return value as ProjectManifest;
}

export function validateCapabilityReceipt(value: unknown): CapabilityReceipt {
  assertValid(receiptValidator, value, "capability receipt");
  return value as CapabilityReceipt;
}
