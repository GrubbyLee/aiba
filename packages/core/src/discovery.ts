import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CapabilityLayer } from "aiba-spec";
import { AibaError } from "./errors.js";
import {
  loadCapabilityCatalog,
  loadCapabilityManifest,
  loadCapabilitySolution,
} from "./loaders.js";
import { resolveSolution } from "./solution.js";

export interface CapabilitySummary {
  kind: "capability";
  id: string;
  version: string;
  title: string;
  description: string;
  layer: CapabilityLayer;
  dependencies: string[];
  invariants: number;
}

export interface SolutionSummary {
  kind: "solution";
  id: string;
  version: string;
  title: string;
  description: string;
  layer: "application-solution" | "industry-solution";
  capabilities: string[];
}

export interface CatalogDiscovery {
  capabilities: CapabilitySummary[];
  solutions: SolutionSummary[];
}

export interface CapabilityDetails extends CapabilitySummary {
  interfaces: string[];
  dependencyDetails: Array<{
    id: string;
    version: string;
    optional: boolean;
  }>;
  invariantDetails: Array<{
    id: string;
    title: string;
    description: string;
    severity: "critical" | "error" | "warning";
  }>;
}

export interface SolutionDetails extends SolutionSummary {
  capabilityDetails: Array<{
    id: string;
    version: string;
    manifestSha256: string;
    purpose: string;
  }>;
}

export type CatalogItemDetails = CapabilityDetails | SolutionDetails;

export interface DiscoverCatalogOptions {
  packsDirectory: string;
  solutionsDirectory: string;
}

export async function discoverCatalog(
  options: DiscoverCatalogOptions,
): Promise<CatalogDiscovery> {
  const packsDirectory = resolve(options.packsDirectory);
  const solutionsDirectory = resolve(options.solutionsDirectory);
  const catalog = await loadCapabilityCatalog(packsDirectory);
  const capabilities: CapabilitySummary[] = [];

  for (const entry of catalog.capabilities) {
    const manifest = await loadCapabilityManifest(packsDirectory, entry.id);
    if (manifest.metadata.version !== entry.version) {
      throw new AibaError(
        `Catalog requires ${entry.id}@${entry.version}, pack provides ${manifest.metadata.version}`,
        "CATALOG_CAPABILITY_VERSION_MISMATCH",
      );
    }
    if (manifest.metadata.layer && manifest.metadata.layer !== entry.layer) {
      throw new AibaError(
        `Catalog classifies ${entry.id} as ${entry.layer}, manifest declares ${manifest.metadata.layer}`,
        "CATALOG_CAPABILITY_LAYER_MISMATCH",
      );
    }
    capabilities.push({
      kind: "capability",
      id: entry.id,
      version: entry.version,
      title: manifest.metadata.title,
      description: manifest.metadata.description,
      layer: entry.layer,
      dependencies: manifest.spec.dependencies
        .filter(({ optional }) => !optional)
        .map(({ id, version }) => `${id}@${version}`),
      invariants: manifest.spec.invariants.length,
    });
  }

  let entries;
  try {
    entries = await readdir(solutionsDirectory, { withFileTypes: true });
  } catch (error) {
    throw new AibaError(
      `Cannot read Solution directory ${solutionsDirectory}`,
      "SOLUTION_DIRECTORY_NOT_FOUND",
      { cause: error },
    );
  }
  const solutionIds = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map(({ name }) => name)
    .sort();
  const solutions: SolutionSummary[] = [];
  for (const solutionId of solutionIds) {
    const solution = await loadCapabilitySolution(solutionsDirectory, solutionId);
    const resolvedCapabilities = await resolveSolution(solution, packsDirectory);
    solutions.push({
      kind: "solution",
      id: solution.metadata.id,
      version: solution.metadata.version,
      title: solution.metadata.title,
      description: solution.metadata.description,
      layer: solution.metadata.layer,
      capabilities: resolvedCapabilities.map(({ entry }) => `${entry.id}@${entry.version}`),
    });
  }
  return { capabilities, solutions };
}

export async function describeCatalogItem(
  options: DiscoverCatalogOptions & { id: string },
): Promise<CatalogItemDetails> {
  const discovery = await discoverCatalog(options);
  const capability = discovery.capabilities.find(({ id }) => id === options.id);
  const solutionSummary = discovery.solutions.find(({ id }) => id === options.id);
  if (capability && solutionSummary) {
    throw new AibaError(
      `Catalog ID ${options.id} is ambiguous between a capability and a Solution`,
      "AMBIGUOUS_CATALOG_ITEM",
    );
  }
  if (capability) {
    const manifest = await loadCapabilityManifest(resolve(options.packsDirectory), capability.id);
    return {
      ...capability,
      interfaces: [...manifest.spec.interfaces],
      dependencyDetails: manifest.spec.dependencies.map((dependency) => ({ ...dependency })),
      invariantDetails: manifest.spec.invariants.map((invariant) => ({
        id: invariant.id,
        title: invariant.title,
        description: invariant.description,
        severity: invariant.severity,
      })),
    };
  }
  if (solutionSummary) {
    const solution = await loadCapabilitySolution(
      resolve(options.solutionsDirectory),
      solutionSummary.id,
    );
    return {
      ...solutionSummary,
      capabilityDetails: solution.spec.capabilities.map((entry) => ({ ...entry })),
    };
  }
  throw new AibaError(`Catalog item ${options.id} was not found`, "CATALOG_ITEM_NOT_FOUND");
}
