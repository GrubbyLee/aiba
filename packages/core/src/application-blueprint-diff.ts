import { resolve } from "node:path";
import type {
  ApplicationBlueprint,
  ApplicationBlueprintUpgradePlan,
  ApplicationPlan,
  ApplicationTaskCustomization,
} from "aiba-spec";
import { acceptApplicationBlueprintUpgrade, planApplicationBlueprintUpgrade } from "./application-blueprint-upgrade.js";
import { compileApplicationBlueprint } from "./application-planner.js";
import { sha256File } from "./hash.js";
import { loadApplicationBlueprint } from "./loaders.js";

export interface CompiledApplicationBlueprintPair {
  previousBlueprint: ApplicationBlueprint;
  previousBlueprintSha256: string;
  previousPlan: ApplicationPlan;
  nextBlueprint: ApplicationBlueprint;
  nextBlueprintSha256: string;
  nextPlan: ApplicationPlan;
}

export interface ApplicationBlueprintFilesOptions {
  previousPath: string;
  nextPath: string;
  packsDirectory: string;
  customizations?: ApplicationTaskCustomization[];
}

export async function compileApplicationBlueprintPair(
  options: Omit<ApplicationBlueprintFilesOptions, "customizations">,
): Promise<CompiledApplicationBlueprintPair> {
  const previousPath = resolve(options.previousPath);
  const nextPath = resolve(options.nextPath);
  const [previousBlueprint, nextBlueprint, previousBlueprintSha256, nextBlueprintSha256] = await Promise.all([
    loadApplicationBlueprint(previousPath),
    loadApplicationBlueprint(nextPath),
    sha256File(previousPath),
    sha256File(nextPath),
  ]);
  const [previousPlan, nextPlan] = await Promise.all([
    compileApplicationBlueprint({
      blueprint: previousBlueprint,
      blueprintSha256: previousBlueprintSha256,
      packsDirectory: resolve(options.packsDirectory),
    }),
    compileApplicationBlueprint({
      blueprint: nextBlueprint,
      blueprintSha256: nextBlueprintSha256,
      packsDirectory: resolve(options.packsDirectory),
    }),
  ]);
  return {
    previousBlueprint,
    previousBlueprintSha256,
    previousPlan,
    nextBlueprint,
    nextBlueprintSha256,
    nextPlan,
  };
}

export async function diffApplicationBlueprintFiles(
  options: ApplicationBlueprintFilesOptions,
): Promise<ApplicationBlueprintUpgradePlan> {
  const pair = await compileApplicationBlueprintPair(options);
  return planApplicationBlueprintUpgrade({
    ...pair,
    ...(options.customizations ? { customizations: options.customizations } : {}),
  });
}

export function acceptCompiledApplicationBlueprintUpgrade(options: {
  pair: CompiledApplicationBlueprintPair;
  plan: ApplicationBlueprintUpgradePlan;
  resolutions: Parameters<typeof acceptApplicationBlueprintUpgrade>[0]["resolutions"];
}) {
  return acceptApplicationBlueprintUpgrade({
    plan: options.plan,
    currentPreviousBlueprintSha256: options.pair.previousBlueprintSha256,
    currentNextBlueprintSha256: options.pair.nextBlueprintSha256,
    currentNextPlan: options.pair.nextPlan,
    resolutions: options.resolutions,
  });
}
