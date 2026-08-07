import { describe, expect, it } from "vitest";
import { describeAgentProtocol } from "./agent-protocol.js";

describe("Agent protocol negotiation", () => {
  it("advertises every stable Agent workflow with JSON and mutation metadata", () => {
    const descriptor = describeAgentProtocol("0.1.2");
    expect(descriptor.protocolVersion).toBe("0.1.0");
    expect(descriptor.commands.map((item) => item.name)).toEqual(expect.arrayContaining([
      "inspect", "doctor", "add", "status", "continue", "verify",
      "test", "attest", "verify-behavior", "upgrade", "fetch",
      "create", "lint", "test-pack", "plan", "app-diff", "app-upgrade",
    ]));
    expect(descriptor.commands.every((item) => item.json)).toBe(true);
    expect(descriptor.commands.find((item) => item.name === "status")).toMatchObject({
      mutatesProject: false,
      resumable: true,
    });
    expect(descriptor.commands.find((item) => item.name === "plan")).toMatchObject({
      mutatesProject: false,
      resumable: false,
    });
    expect(descriptor.commands.find((item) => item.name === "app-upgrade")).toMatchObject({
      mutatesProject: false,
      resumable: false,
    });
    expect(descriptor.commands.find((item) => item.name === "continue")).toMatchObject({
      mutatesProject: true,
      resumable: true,
    });
  });
});
