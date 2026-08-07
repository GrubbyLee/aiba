import type { ApplicationBlueprint } from "aiba-spec";
import { AibaError } from "./errors.js";

function fail(message: string): never {
  throw new AibaError(message, "APPLICATION_BLUEPRINT_INVALID");
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`Application Blueprint contains duplicate ${label} ${value}`);
    seen.add(value);
  }
}

export function assertApplicationBlueprintSemantics(
  blueprint: ApplicationBlueprint,
): ApplicationBlueprint {
  assertUnique(blueprint.spec.resources.map((resource) => resource.id), "resource");
  assertUnique(blueprint.spec.operations.map((operation) => operation.id), "operation");
  assertUnique(blueprint.spec.events.map((event) => event.id), "event");
  const resources = new Map(blueprint.spec.resources.map((resource) => [resource.id, resource]));
  const operations = new Map(blueprint.spec.operations.map((operation) => [operation.id, operation]));
  const events = new Map(blueprint.spec.events.map((event) => [event.id, event]));

  assertUnique(blueprint.spec.requirements.map((item) => item.capability), "capability requirement");
  assertUnique(blueprint.spec.ui.surfaces.map((surface) => surface.id), "UI surface");
  assertUnique(blueprint.spec.acceptance.map((item) => item.id), "acceptance rule");

  for (const resource of resources.values()) {
    const fields = new Map(resource.fields.map((field) => [field.id, field]));
    assertUnique([...fields.keys()], `field in ${resource.id}`);
    assertUnique(resource.relationships.map((relationship) => relationship.id), `relationship in ${resource.id}`);

    for (const field of fields.values()) {
      if ((field.type === "enum") !== (field.dictionary !== undefined)) {
        fail(`Field ${resource.id}.${field.id} must use dictionary exactly when its type is enum`);
      }
      if ((field.type === "reference") !== (field.targetResource !== undefined)) {
        fail(`Field ${resource.id}.${field.id} must use targetResource exactly when its type is reference`);
      }
      if (field.targetResource !== undefined && !resources.has(field.targetResource)) {
        fail(`Field ${resource.id}.${field.id} targets unknown resource ${field.targetResource}`);
      }
      if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
        fail(`Field ${resource.id}.${field.id} minimum exceeds maximum`);
      }
      if (field.maxLength !== undefined && field.type !== "string" && field.type !== "text") {
        fail(`Field ${resource.id}.${field.id} uses maxLength with non-text type ${field.type}`);
      }
    }

    for (const relationship of resource.relationships) {
      if (!resources.has(relationship.targetResource)) {
        fail(`Relationship ${resource.id}.${relationship.id} targets unknown resource ${relationship.targetResource}`);
      }
    }

    if (resource.stateMachine) {
      const stateIds = resource.stateMachine.states.map((state) => state.id);
      assertUnique(stateIds, `state in ${resource.id}`);
      assertUnique(resource.stateMachine.transitions.map((transition) => transition.id), `transition in ${resource.id}`);
      const states = new Set(stateIds);
      if (!states.has(resource.stateMachine.initial)) {
        fail(`Resource ${resource.id} has unknown initial state ${resource.stateMachine.initial}`);
      }
      for (const transition of resource.stateMachine.transitions) {
        if (!states.has(transition.from) || !states.has(transition.to)) {
          fail(`Transition ${resource.id}.${transition.id} references an unknown state`);
        }
        const operation = operations.get(transition.operation);
        if (!operation || operation.resource !== resource.id || operation.kind !== "transition") {
          fail(`Transition ${resource.id}.${transition.id} requires a transition operation on the same resource`);
        }
      }
    }
  }

  for (const operation of operations.values()) {
    const resource = resources.get(operation.resource);
    if (!resource) fail(`Operation ${operation.id} references unknown resource ${operation.resource}`);
    const fields = new Set(resource.fields.map((field) => field.id));
    for (const field of [...operation.inputFields, ...operation.outputFields]) {
      if (!fields.has(field)) fail(`Operation ${operation.id} references unknown field ${field}`);
    }
    for (const eventId of operation.emits) {
      const event = events.get(eventId);
      if (!event || event.operation !== operation.id) {
        fail(`Operation ${operation.id} emits inconsistent event ${eventId}`);
      }
    }
  }

  for (const event of events.values()) {
    const operation = operations.get(event.operation);
    if (!operation || !operation.emits.includes(event.id)) {
      fail(`Event ${event.id} references an operation that does not emit it`);
    }
    const resource = resources.get(operation.resource)!;
    const fields = new Set(resource.fields.map((field) => field.id));
    for (const field of event.payloadFields) {
      if (!fields.has(field)) fail(`Event ${event.id} references unknown payload field ${field}`);
    }
    assertUnique(
      event.triggers.map((trigger) => `${trigger.capability}:${trigger.action}`),
      `trigger in ${event.id}`,
    );
  }

  for (const surface of blueprint.spec.ui.surfaces) {
    if (surface.kind !== "dashboard" && surface.resource === undefined) {
      fail(`UI surface ${surface.id} requires a resource`);
    }
    if (surface.resource === undefined) {
      if (surface.fields.length > 0) fail(`Dashboard ${surface.id} cannot reference resource fields`);
      continue;
    }
    const resource = resources.get(surface.resource);
    if (!resource) fail(`UI surface ${surface.id} references unknown resource ${surface.resource}`);
    const fields = new Set(resource.fields.map((field) => field.id));
    for (const field of surface.fields) {
      if (!fields.has(field)) fail(`UI surface ${surface.id} references unknown field ${field}`);
    }
    for (const operationId of surface.operations) {
      const operation = operations.get(operationId);
      if (!operation || operation.resource !== surface.resource) {
        fail(`UI surface ${surface.id} references an operation from another resource`);
      }
    }
  }

  return blueprint;
}
