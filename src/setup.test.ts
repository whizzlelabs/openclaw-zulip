import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zulipSetupContract } from "./setup.js";

const input = { url: " https://zulip.example.com/ ", userId: " bot@example.com ", token: " test-key " };
const context = { cfg: {}, accountId: "work", input };

describe("channel-owned Zulip setup", () => {
  it("preserves existing setup fields and account config", () => {
    expect(zulipSetupContract.validateInput!(context)).toBeNull();
    expect(zulipSetupContract.applyAccountConfig(context)).toMatchObject({
      channels: { zulip: { enabled: true, accounts: { work: {
        enabled: true, serverUrl: "https://zulip.example.com", email: "bot@example.com", apiKey: "test-key",
      } } } },
    });
  });

  it.each([
    ["url", "Server URL is required."],
    ["userId", "Bot email is required."],
    ["token", "API key is required."],
  ] as const)("rejects an empty %s before a config write", (key, error) => {
    expect(zulipSetupContract.validateInput!({ ...context, input: { ...input, [key]: " " } })).toBe(error);
  });

  it("publishes matching setup discovery metadata without loading runtime code", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.openclaw.channel.setup).toEqual(zulipSetupContract.metadata);
    expect(manifest.openclaw.channel.setup.fields.find((field: { key: string }) => field.key === "token").sensitive).toBe(true);
  });
});
