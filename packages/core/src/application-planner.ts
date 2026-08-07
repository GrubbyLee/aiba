import { join, resolve } from "node:path";
import { satisfies } from "semver";
import type {
  ApplicationBlueprint,
  ApplicationPlan,
  ApplicationPlanCapability,
  ApplicationPlanTask,
  CapabilityManifest,
} from "aiba-spec";
import { AIBA_API_VERSION } from "aiba-spec";
import { AibaError } from "./errors.js";
import { sha256File } from "./hash.js";
import { loadCapabilityCatalog, loadCapabilityManifest } from "./loaders.js";
import { assertApplicationBlueprintSemantics } from "./application-blueprint.js";
import { validateApplicationPlan } from "./validation.js";

export interface CompileApplicationBlueprintOptions {
  blueprint: ApplicationBlueprint;
  blueprintSha256: string;
  packsDirectory: string;
}

function plannerError(message: string, code = "APPLICATION_BLUEPRINT_PLAN_INVALID"): never {
  throw new AibaError(message, code);
}

function addReason(reasons: Map<string, Set<string>>, id: string, reason: string): void {
  const current = reasons.get(id) ?? new Set<string>();
  current.add(reason);
  reasons.set(id, current);
}

function inferredRequirements(blueprint: ApplicationBlueprint): Map<string, Set<string>> {
  const reasons = new Map<string, Set<string>>();
  for (const requirement of blueprint.spec.requirements) {
    addReason(reasons, requirement.capability, `Declared: ${requirement.reason}`);
  }
  if (blueprint.spec.operations.length > 0) {
    addReason(reasons, "authorization", "Operations declare authorization intent");
  }
  for (const resource of blueprint.spec.resources) {
    for (const field of resource.fields) {
      if (field.type === "enum") addReason(reasons, "data-dict", `Enum field ${resource.id}.${field.id}`);
      if (field.type === "asset") addReason(reasons, "file-assets", `Asset field ${resource.id}.${field.id}`);
      if (field.type === "tags") addReason(reasons, "tags", `Tag field ${resource.id}.${field.id}`);
    }
  }
  for (const surface of blueprint.spec.ui.surfaces) {
    if (surface.kind === "form") addReason(reasons, "form-engine", `Form surface ${surface.id}`);
    if (surface.features.includes("search")) addReason(reasons, "search", `Search UI on ${surface.id}`);
    if (surface.features.includes("tags")) addReason(reasons, "tags", `Tag UI on ${surface.id}`);
  }
  for (const event of blueprint.spec.events) {
    for (const trigger of event.triggers) {
      addReason(reasons, trigger.capability, `Event ${event.id} triggers ${trigger.action}`);
    }
  }
  return reasons;
}

function capabilityTask(
  capability: ApplicationPlanCapability,
  manifest: CapabilityManifest,
  writeScopes: string[],
): ApplicationPlanTask {
  return {
    id: `adapt-${capability.id}`,
    kind: "capability-adaptation",
    title: `Adapt ${manifest.metadata.title}`,
    target: capability.id,
    dependsOn: capability.dependencies.map((id) => `adapt-${id}`),
    writeScopes,
    requiredCapabilities: [`${capability.id}@${capability.version}`],
    intents: capability.reasons,
    invariants: manifest.spec.invariants.map((invariant) => invariant.id),
    evidence: manifest.spec.invariants.map((invariant) => ({
      invariant: invariant.id,
      requiredTypes: invariant.evidence.requiredTypes,
      minimum: invariant.evidence.minimum,
      pathPatterns: writeScopes,
    })),
  };
}

function directResourceCapabilities(
  blueprint: ApplicationBlueprint,
  resourceId: string,
  selected: Set<string>,
): string[] {
  const direct = new Set<string>(["authorization"]);
  const resource = blueprint.spec.resources.find((item) => item.id === resourceId)!;
  for (const field of resource.fields) {
    if (field.type === "enum") direct.add("data-dict");
    if (field.type === "asset") direct.add("file-assets");
    if (field.type === "tags") direct.add("tags");
  }
  for (const surface of blueprint.spec.ui.surfaces.filter((item) => item.resource === resourceId)) {
    if (surface.kind === "form") direct.add("form-engine");
    if (surface.features.includes("search")) direct.add("search");
    if (surface.features.includes("tags")) direct.add("tags");
  }
  const operationIds = new Set(
    blueprint.spec.operations.filter((item) => item.resource === resourceId).map((item) => item.id),
  );
  for (const event of blueprint.spec.events.filter((item) => operationIds.has(item.operation))) {
    for (const trigger of event.triggers) direct.add(trigger.capability);
  }
  return [...direct].filter((id) => selected.has(id)).sort();
}

function resourceTask(
  blueprint: ApplicationBlueprint,
  resourceId: string,
  versions: Map<string, string>,
): ApplicationPlanTask {
  const resource = blueprint.spec.resources.find((item) => item.id === resourceId)!;
  const capabilities = directResourceCapabilities(blueprint, resourceId, new Set(versions.keys()));
  const operations = blueprint.spec.operations
    .filter((operation) => operation.resource === resourceId)
    .map((operation) => operation.id);
  const intents = [
    `Implement resource ${resource.id}`,
    ...resource.fields.map((field) => `Field ${field.id}: ${field.type}`),
    ...operations.map((operation) => `Operation ${operation}`),
  ];
  intents.push(...resource.relationships.map((item) =>
    `Relationship ${item.id}: ${item.kind} -> ${item.targetResource} (${item.onDelete})`));
  if (resource.stateMachine) {
    intents.push(`Initial state ${resource.stateMachine.initial}`);
    intents.push(...resource.stateMachine.transitions.map((item) =>
      `Transition ${item.id}: ${item.from} -> ${item.to} via ${item.operation}`));
  }
  return {
    id: `implement-${resource.id}`,
    kind: "resource-implementation",
    title: `Implement ${resource.title}`,
    target: resource.id,
    dependsOn: capabilities.map((id) => `adapt-${id}`),
    writeScopes: blueprint.spec.adaptation.writeScopes,
    requiredCapabilities: capabilities.map((id) => `${id}@${versions.get(id)!}`),
    intents,
    invariants: [],
    evidence: [],
  };
}

export async function compileApplicationBlueprint(
  options: CompileApplicationBlueprintOptions,
): Promise<ApplicationPlan> {
  const blueprint = assertApplicationBlueprintSemantics(options.blueprint);
  if (!/^[a-f0-9]{64}$/.test(options.blueprintSha256)) {
    plannerError("Application Blueprint source hash must be SHA-256");
  }
  const packsDirectory = resolve(options.packsDirectory);
  const catalog = await loadCapabilityCatalog(packsDirectory);
  const catalogPositions = new Map(catalog.capabilities.map((entry, index) => [entry.id, index]));
  const manifests = new Map<string, CapabilityManifest>();
  await Promise.all(catalog.capabilities.map(async (entry) => {
    const manifest = await loadCapabilityManifest(packsDirectory, entry.id);
    if (manifest.metadata.version !== entry.version) {
      plannerError(`Catalog version for ${entry.id} does not match its manifest`, "BLUEPRINT_CATALOG_INVALID");
    }
    manifests.set(entry.id, manifest);
  }));

  const reasons = inferredRequirements(blueprint);
  const declared = new Map(blueprint.spec.requirements.map((item) => [item.capability, item.version]));
  for (const [id, range] of declared) {
    const manifest = manifests.get(id);
    if (!manifest) plannerError(`Blueprint requires unpublished capability ${id}`, "BLUEPRINT_CAPABILITY_NOT_FOUND");
    if (!satisfies(manifest.metadata.version, range)) {
      plannerError(
        `Blueprint requires ${id}@${range}, catalog provides ${manifest.metadata.version}`,
        "BLUEPRINT_CAPABILITY_VERSION_UNSATISFIED",
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string, ancestry: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      plannerError(`Capability dependency cycle: ${[...ancestry, id].join(" -> ")}`, "BLUEPRINT_CAPABILITY_CYCLE");
    }
    const manifest = manifests.get(id);
    if (!manifest) plannerError(`Blueprint infers unpublished capability ${id}`, "BLUEPRINT_CAPABILITY_NOT_FOUND");
    visiting.add(id);
    const dependencies = manifest.spec.dependencies
      .filter((dependency) => !dependency.optional)
      .sort((left, right) => (catalogPositions.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (catalogPositions.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    for (const dependency of dependencies) {
      const candidate = manifests.get(dependency.id);
      if (!candidate || !satisfies(candidate.metadata.version, dependency.version)) {
        plannerError(
          `${id}@${manifest.metadata.version} requires unavailable ${dependency.id}@${dependency.version}`,
          "BLUEPRINT_CAPABILITY_DEPENDENCY_UNSATISFIED",
        );
      }
      addReason(reasons, dependency.id, `Required by ${id}`);
      visit(dependency.id, [...ancestry, id]);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };

  const roots = [...reasons.keys()].sort((left, right) =>
    (catalogPositions.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (catalogPositions.get(right) ?? Number.MAX_SAFE_INTEGER));
  for (const id of roots) visit(id, []);

  const capabilities: ApplicationPlanCapability[] = await Promise.all(order.map(async (id) => {
    const manifest = manifests.get(id)!;
    return {
      id,
      version: manifest.metadata.version,
      manifestSha256: await sha256File(join(packsDirectory, id, "capability.yaml")),
      dependencies: manifest.spec.dependencies.filter((item) => !item.optional).map((item) => item.id),
      reasons: [...reasons.get(id)!].sort(),
      inferred: !declared.has(id),
    };
  }));
  const versions = new Map(capabilities.map((capability) => [capability.id, capability.version]));
  const tasks: ApplicationPlanTask[] = capabilities.map((capability) =>
    capabilityTask(capability, manifests.get(capability.id)!, blueprint.spec.adaptation.writeScopes));
  tasks.push(...blueprint.spec.resources.map((resource) => resourceTask(blueprint, resource.id, versions)));
  tasks.push({
    id: "verify-application",
    kind: "acceptance-verification",
    title: `Verify ${blueprint.metadata.title}`,
    dependsOn: blueprint.spec.resources.map((resource) => `implement-${resource.id}`),
    writeScopes: [],
    requiredCapabilities: capabilities.map((capability) => `${capability.id}@${capability.version}`),
    intents: ["Verify Blueprint acceptance evidence without executing pack-provided commands"],
    invariants: blueprint.spec.acceptance.map((item) => item.id),
    evidence: blueprint.spec.acceptance.map((item) => ({
      invariant: item.id,
      requiredTypes: item.evidence.requiredTypes,
      minimum: item.evidence.minimum,
      pathPatterns: item.evidence.pathPatterns,
    })),
  });

  return validateApplicationPlan({
    apiVersion: AIBA_API_VERSION,
    kind: "ApplicationPlan",
    metadata: {
      id: `${blueprint.metadata.id}-plan`,
      blueprint: {
        id: blueprint.metadata.id,
        version: blueprint.metadata.version,
        sha256: options.blueprintSha256,
      },
    },
    capabilities,
    tasks,
  });
}
