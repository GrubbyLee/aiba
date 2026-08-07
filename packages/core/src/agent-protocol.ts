import { AIBA_API_VERSION, type AgentProtocolDescriptor } from "aiba-spec";
import { validateAgentProtocolDescriptor } from "./validation.js";

const commands: AgentProtocolDescriptor["commands"] = [
  ["list", false, false], ["show", false, false], ["inspect", false, false],
  ["doctor", false, false], ["init", true, false], ["add", true, true],
  ["status", false, true], ["continue", true, true], ["verify", false, false],
  ["diff", false, false], ["upgrade", true, true], ["compose", false, false],
  ["test", true, true], ["attest", true, true], ["verify-behavior", false, false],
  ["policy-check", false, false], ["resolve", false, false], ["fetch", true, true],
  ["create", true, false], ["lint", false, false], ["test-pack", false, false],
  ["plan", false, false], ["app-diff", false, false], ["app-upgrade", false, false],
  ["solution-verify", true, true],
  ["registry-backup", true, true], ["registry-restore", true, true],
  ["registry-gc", true, true],
].map(([name, mutatesProject, resumable]) => ({
  name: name as string,
  mutatesProject: mutatesProject as boolean,
  resumable: resumable as boolean,
  json: true,
}));

export function describeAgentProtocol(cliVersion: string): AgentProtocolDescriptor {
  const descriptor: AgentProtocolDescriptor = {
    apiVersion: AIBA_API_VERSION,
    kind: "AgentProtocolDescriptor",
    cliVersion,
    protocolVersion: "0.1.0",
    capabilities: [
      "catalog-discovery", "project-inspection", "capability-install",
      "solution-workflow", "evidence-verification", "behavior-proof",
      "customization-upgrade", "registry", "governance",
      "application-blueprint", "application-planning",
    ],
    commands,
    envelopes: { success: "command-specific-json", error: "AibaErrorEnvelope" },
  };
  return validateAgentProtocolDescriptor(descriptor);
}
