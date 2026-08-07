import { gt } from "semver";
import {
  AIBA_API_VERSION,
  type ApplicationBlueprint,
  type ApplicationBlueprintChangeCategory,
  type ApplicationBlueprintUpgradePlan,
  type ApplicationPlan,
  type ApplicationTaskCustomization,
} from "aiba-spec";
import { AibaError } from "./errors.js";
import { canonicalDocument } from "./signing.js";
import { sha256Text } from "./hash.js";
import { assertApplicationBlueprintSemantics } from "./application-blueprint.js";
import {
  validateApplicationBlueprintUpgradePlan,
  validateApplicationPlan,
} from "./validation.js";

interface PendingChange {
  category: ApplicationBlueprintChangeCategory;
  targetType: ApplicationBlueprintUpgradePlan["changes"][number]["targetType"];
  target: string;
  summary: string;
  requiresResolution: boolean;
}

export interface PlanApplicationBlueprintUpgradeOptions {
  previousBlueprint: ApplicationBlueprint;
  previousBlueprintSha256: string;
  previousPlan: ApplicationPlan;
  nextBlueprint: ApplicationBlueprint;
  nextBlueprintSha256: string;
  nextPlan: ApplicationPlan;
  customizations?: ApplicationTaskCustomization[];
}

export interface ApplicationBlueprintUpgradeResolution {
  changeId: string;
  decision: "accept" | "adapt";
  note: string;
}

function fail(message: string, code: string): never {
  throw new AibaError(message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseApplicationTaskCustomization(
  value: unknown,
  context = "Blueprint customization",
): ApplicationTaskCustomization {
  if (!isRecord(value)) fail(`${context} must be an object`, "JSON_DOCUMENT_INVALID");
  const { taskId, ownership, note, evidencePaths } = value;
  if (typeof taskId !== "string"
    || ownership !== "project"
    || typeof note !== "string"
    || !isStringArray(evidencePaths)) {
    fail(`${context} must include taskId, ownership, note, and evidencePaths`, "JSON_DOCUMENT_INVALID");
  }
  return { taskId, ownership, note, evidencePaths };
}

export function parseApplicationBlueprintUpgradeResolution(
  value: unknown,
  context = "Blueprint upgrade resolution",
): ApplicationBlueprintUpgradeResolution {
  if (!isRecord(value)) fail(`${context} must be an object`, "JSON_DOCUMENT_INVALID");
  const { changeId, decision, note } = value;
  if (typeof changeId !== "string"
    || (decision !== "accept" && decision !== "adapt")
    || typeof note !== "string") {
    fail(`${context} must include changeId, decision, and note`, "JSON_DOCUMENT_INVALID");
  }
  return { changeId, decision, note };
}

function hashPlan(plan: ApplicationPlan): string {
  return sha256Text(canonicalDocument(validateApplicationPlan(plan)));
}

function same(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalDocument(left) === canonicalDocument(right);
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function change(
  changes: PendingChange[],
  category: ApplicationBlueprintChangeCategory,
  targetType: PendingChange["targetType"],
  target: string,
  summary: string,
): void {
  changes.push({
    category,
    targetType,
    target,
    summary,
    requiresResolution: category !== "additive",
  });
}

function compareBlueprints(
  previous: ApplicationBlueprint,
  next: ApplicationBlueprint,
): PendingChange[] {
  const changes: PendingChange[] = [];
  const previousRequirements = new Map(previous.spec.requirements.map((item) => [item.capability, item]));
  const nextRequirements = new Map(next.spec.requirements.map((item) => [item.capability, item]));
  for (const [id, requirement] of nextRequirements) {
    const before = previousRequirements.get(id);
    if (!before) change(changes, "additive", "capability", id, `Add capability requirement ${id}@${requirement.version}`);
    else if (before.version !== requirement.version) change(changes, "security-sensitive", "capability", id, `Change capability range ${before.version} -> ${requirement.version}`);
  }
  for (const id of previousRequirements.keys()) {
    if (!nextRequirements.has(id)) change(changes, "security-sensitive", "capability", id, `Remove capability requirement ${id}`);
  }

  const previousResources = byId(previous.spec.resources);
  const nextResources = byId(next.spec.resources);
  for (const [id, resource] of nextResources) {
    const before = previousResources.get(id);
    if (!before) {
      change(changes, "additive", "resource", id, `Add resource ${id}`);
      continue;
    }
    const previousFields = byId(before.fields);
    const nextFields = byId(resource.fields);
    for (const [fieldId, field] of nextFields) {
      const previousField = previousFields.get(fieldId);
      const target = `${id}.${fieldId}`;
      if (!previousField) {
        change(changes, "additive", "field", target, `Add field ${target}`);
        continue;
      }
      if (previousField.sensitive !== field.sensitive) {
        change(changes, "security-sensitive", "field", target, `Change sensitive classification for ${target}`);
      }
      const { sensitive: previousSensitive, ...previousShape } = previousField;
      const { sensitive: nextSensitive, ...nextShape } = field;
      void previousSensitive;
      void nextSensitive;
      if (!same(previousShape, nextShape)) {
        change(changes, "breaking", "field", target, `Change field contract ${target}`);
      }
    }
    for (const [fieldId, field] of previousFields) {
      if (!nextFields.has(fieldId)) {
        change(
          changes,
          field.sensitive ? "security-sensitive" : "breaking",
          "field",
          `${id}.${fieldId}`,
          `Remove field ${id}.${fieldId}`,
        );
      }
    }

    const previousRelationships = byId(before.relationships);
    const nextRelationships = byId(resource.relationships);
    for (const [relationshipId, relationship] of nextRelationships) {
      const prior = previousRelationships.get(relationshipId);
      const target = `${id}.${relationshipId}`;
      if (!prior) change(changes, "additive", "relationship", target, `Add relationship ${target}`);
      else if (!same(prior, relationship)) {
        change(
          changes,
          relationship.onDelete === "cascade" ? "security-sensitive" : "breaking",
          "relationship",
          target,
          `Change relationship ${target}`,
        );
      }
    }
    for (const relationshipId of previousRelationships.keys()) {
      if (!nextRelationships.has(relationshipId)) change(changes, "breaking", "relationship", `${id}.${relationshipId}`, `Remove relationship ${id}.${relationshipId}`);
    }
    if (!same(before.stateMachine, resource.stateMachine)) {
      change(changes, "breaking", "state-machine", id, `Change state machine for ${id}`);
    }
  }
  for (const id of previousResources.keys()) {
    if (!nextResources.has(id)) change(changes, "breaking", "resource", id, `Remove resource ${id}`);
  }

  const previousOperations = byId(previous.spec.operations);
  const nextOperations = byId(next.spec.operations);
  for (const [id, operation] of nextOperations) {
    const before = previousOperations.get(id);
    if (!before) {
      change(changes, "additive", "operation", id, `Add operation ${id}`);
      continue;
    }
    if (before.authorization.action !== operation.authorization.action) {
      change(changes, "security-sensitive", "operation", id, `Change authorization action for ${id}`);
    }
    const { authorization: previousAuthorization, ...previousShape } = before;
    const { authorization: nextAuthorization, ...nextShape } = operation;
    void previousAuthorization;
    void nextAuthorization;
    if (!same(previousShape, nextShape)) change(changes, "breaking", "operation", id, `Change operation contract ${id}`);
  }
  for (const id of previousOperations.keys()) {
    if (!nextOperations.has(id)) change(changes, "breaking", "operation", id, `Remove operation ${id}`);
  }

  const previousEvents = byId(previous.spec.events);
  const nextEvents = byId(next.spec.events);
  for (const [id, event] of nextEvents) {
    const before = previousEvents.get(id);
    if (!before) change(changes, "additive", "event", id, `Add event ${id}`);
    else {
      if (!same(before.triggers, event.triggers)) change(changes, "security-sensitive", "event", id, `Change triggers for ${id}`);
      const { triggers: previousTriggers, ...previousShape } = before;
      const { triggers: nextTriggers, ...nextShape } = event;
      void previousTriggers;
      void nextTriggers;
      if (!same(previousShape, nextShape)) change(changes, "breaking", "event", id, `Change event contract ${id}`);
    }
  }
  for (const id of previousEvents.keys()) {
    if (!nextEvents.has(id)) change(changes, "breaking", "event", id, `Remove event ${id}`);
  }

  const previousSurfaces = byId(previous.spec.ui.surfaces);
  const nextSurfaces = byId(next.spec.ui.surfaces);
  for (const [id, surface] of nextSurfaces) {
    const before = previousSurfaces.get(id);
    if (!before) change(changes, "additive", "ui", id, `Add UI surface ${id}`);
    else if (!same(before, surface)) change(changes, "breaking", "ui", id, `Change UI intent ${id}`);
  }
  for (const id of previousSurfaces.keys()) {
    if (!nextSurfaces.has(id)) change(changes, "breaking", "ui", id, `Remove UI surface ${id}`);
  }

  const previousAcceptance = byId(previous.spec.acceptance);
  const nextAcceptance = byId(next.spec.acceptance);
  for (const [id, acceptance] of nextAcceptance) {
    const before = previousAcceptance.get(id);
    if (!before) change(changes, "additive", "acceptance", id, `Add acceptance rule ${id}`);
    else if (!same(before, acceptance)) change(changes, "security-sensitive", "acceptance", id, `Change acceptance rule ${id}`);
  }
  for (const id of previousAcceptance.keys()) {
    if (!nextAcceptance.has(id)) change(changes, "security-sensitive", "acceptance", id, `Remove acceptance rule ${id}`);
  }
  if (!same(previous.spec.adaptation, next.spec.adaptation)) {
    change(changes, "security-sensitive", "adaptation", "write-scopes", "Change Agent write scopes");
  }
  return changes;
}

function customizationConflicts(
  customization: ApplicationTaskCustomization,
  previousPlan: ApplicationPlan,
  nextPlan: ApplicationPlan,
  changes: PendingChange[],
): boolean {
  const previousTask = previousPlan.tasks.find((task) => task.id === customization.taskId);
  if (!previousTask) fail(`Customization references unknown prior task ${customization.taskId}`, "BLUEPRINT_CUSTOMIZATION_INVALID");
  const nextTask = nextPlan.tasks.find((task) => task.id === customization.taskId);
  if (!nextTask) return true;
  if (previousTask.kind === "acceptance-verification") {
    return changes.some((item) => item.requiresResolution
      && (item.targetType === "acceptance" || item.targetType === "adaptation"));
  }
  const target = previousTask.target;
  if (!target) return false;
  return changes.some((item) => item.requiresResolution && (
    item.target === target
    || item.target.startsWith(`${target}.`)
    || (previousTask.kind === "resource-implementation"
      && ["operation", "event", "ui", "state-machine"].includes(item.targetType)
      && nextTask.intents.some((intent) => intent.includes(item.target)))
  ));
}

export function planApplicationBlueprintUpgrade(
  options: PlanApplicationBlueprintUpgradeOptions,
): ApplicationBlueprintUpgradePlan {
  const previous = assertApplicationBlueprintSemantics(options.previousBlueprint);
  const next = assertApplicationBlueprintSemantics(options.nextBlueprint);
  const previousPlan = validateApplicationPlan(options.previousPlan);
  const nextPlan = validateApplicationPlan(options.nextPlan);
  if (previous.metadata.id !== next.metadata.id) fail("Blueprint upgrade cannot change application ID", "BLUEPRINT_UPGRADE_ID_MISMATCH");
  if (!gt(next.metadata.version, previous.metadata.version)) fail("Blueprint target version must be greater", "BLUEPRINT_UPGRADE_VERSION_INVALID");
  if (previousPlan.metadata.blueprint.id !== previous.metadata.id
    || previousPlan.metadata.blueprint.version !== previous.metadata.version
    || nextPlan.metadata.blueprint.id !== next.metadata.id
    || nextPlan.metadata.blueprint.version !== next.metadata.version
    || previousPlan.metadata.blueprint.sha256 !== options.previousBlueprintSha256
    || nextPlan.metadata.blueprint.sha256 !== options.nextBlueprintSha256) {
    fail("Blueprint plan does not match exact source hash", "BLUEPRINT_UPGRADE_STALE_PLAN");
  }
  const customizations = (options.customizations ?? []).map((item, index) =>
    parseApplicationTaskCustomization(item, `Blueprint customization[${index + 1}]`));
  const taskIds = customizations.map((item) => item.taskId);
  if (new Set(taskIds).size !== taskIds.length) fail("Blueprint customizations contain duplicate task IDs", "BLUEPRINT_CUSTOMIZATION_INVALID");

  const pending = compareBlueprints(previous, next);
  const preserved: ApplicationTaskCustomization[] = [];
  for (const customization of customizations) {
    if (customization.ownership !== "project" || customization.note.length === 0
      || customization.note.length > 1000 || customization.evidencePaths.length > 100
      || customization.evidencePaths.some((path) => path.startsWith("/") || path.split("/").includes(".."))) {
      fail(`Customization ${customization.taskId} is invalid`, "BLUEPRINT_CUSTOMIZATION_INVALID");
    }
    if (customizationConflicts(customization, previousPlan, nextPlan, pending)) {
      change(
        pending,
        "conflict",
        "customization",
        customization.taskId,
        `Project customization for ${customization.taskId} requires explicit adaptation`,
      );
    } else {
      preserved.push(customization);
    }
  }

  pending.sort((left, right) =>
    left.targetType.localeCompare(right.targetType)
    || left.target.localeCompare(right.target)
    || left.category.localeCompare(right.category)
    || left.summary.localeCompare(right.summary));
  const changes = pending.map((item, index) => ({
    id: `change-${String(index + 1).padStart(3, "0")}`,
    ...item,
  }));
  return validateApplicationBlueprintUpgradePlan({
    apiVersion: AIBA_API_VERSION,
    kind: "ApplicationBlueprintUpgradePlan",
    metadata: {
      id: `${previous.metadata.id}-upgrade`,
      blueprintId: previous.metadata.id,
      from: {
        version: previous.metadata.version,
        sha256: options.previousBlueprintSha256,
        planSha256: hashPlan(previousPlan),
      },
      to: {
        version: next.metadata.version,
        sha256: options.nextBlueprintSha256,
        planSha256: hashPlan(nextPlan),
      },
    },
    changes,
    preservedCustomizations: preserved,
    requiredResolutions: changes.filter((item) => item.requiresResolution).map((item) => item.id),
  });
}

export function acceptApplicationBlueprintUpgrade(options: {
  plan: ApplicationBlueprintUpgradePlan;
  currentPreviousBlueprintSha256: string;
  currentNextBlueprintSha256: string;
  currentNextPlan: ApplicationPlan;
  resolutions: ApplicationBlueprintUpgradeResolution[];
}): {
  ok: true;
  blueprintId: string;
  version: string;
  preservedCustomizations: ApplicationTaskCustomization[];
  resolutions: ApplicationBlueprintUpgradeResolution[];
} {
  const plan = validateApplicationBlueprintUpgradePlan(options.plan);
  if (plan.metadata.from.sha256 !== options.currentPreviousBlueprintSha256
    || plan.metadata.to.sha256 !== options.currentNextBlueprintSha256
    || plan.metadata.to.planSha256 !== hashPlan(options.currentNextPlan)) {
    fail("Blueprint upgrade plan is stale", "BLUEPRINT_UPGRADE_STALE_PLAN");
  }
  const resolutions = options.resolutions.map((item, index) =>
    parseApplicationBlueprintUpgradeResolution(item, `Blueprint upgrade resolution[${index + 1}]`));
  const resolutionIds = resolutions.map((item) => item.changeId);
  if (new Set(resolutionIds).size !== resolutionIds.length
    || resolutions.some((item) => item.note.length === 0 || item.note.length > 1000)) {
    fail("Blueprint upgrade resolutions are invalid", "BLUEPRINT_UPGRADE_RESOLUTION_INVALID");
  }
  const supplied = new Set(resolutionIds);
  const missing = plan.requiredResolutions.filter((id) => !supplied.has(id));
  if (missing.length > 0) {
    fail(`Blueprint upgrade requires resolutions: ${missing.join(", ")}`, "BLUEPRINT_UPGRADE_RESOLUTION_REQUIRED");
  }
  const known = new Set(plan.requiredResolutions);
  if (resolutionIds.some((id) => !known.has(id))) {
    fail("Blueprint upgrade contains a resolution for an unknown or additive change", "BLUEPRINT_UPGRADE_RESOLUTION_INVALID");
  }
  return {
    ok: true,
    blueprintId: plan.metadata.blueprintId,
    version: plan.metadata.to.version,
    preservedCustomizations: plan.preservedCustomizations,
    resolutions,
  };
}
