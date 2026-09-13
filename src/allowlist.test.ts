import { describe, expect, it } from "vitest";
import { zulipAllowlistAdapter } from "./allowlist.js";
import type { CoreConfig } from "./types.js";

describe("Zulip allowlist adapter", () => {
  const cfg = {
    channels: { zulip: {
      dm: { policy: "allowlist", allowFrom: [200] },
      groupAllowFrom: [300],
      accounts: { work: {} },
    } },
  } as CoreConfig;

  it("reports effective nested DM and group sender lists", async () => {
    expect(await zulipAllowlistAdapter.readConfig?.({ cfg, accountId: "work" })).toMatchObject({
      dmPolicy: "allowlist",
      dmAllowFrom: [200],
      groupAllowFrom: [300],
    });
  });

  it("preserves nested DM entries when editing the canonical flat list", async () => {
    const parsedConfig: Record<string, unknown> = { accounts: { work: {} } };
    const result = await zulipAllowlistAdapter.applyConfigEdit?.({
      cfg, parsedConfig, accountId: "work", scope: "dm", action: "add", entry: "201",
    });
    expect(result).toMatchObject({ kind: "ok", changed: true });
    expect(parsedConfig.accounts).toEqual({ work: { allowFrom: [200, "201"] } });
  });

  it("removes a numeric nested sender ID entered as text", async () => {
    const parsedConfig: Record<string, unknown> = { accounts: { work: {} } };
    const result = await zulipAllowlistAdapter.applyConfigEdit?.({
      cfg, parsedConfig, accountId: "work", scope: "dm", action: "remove", entry: "200",
    });
    expect(result).toMatchObject({ kind: "ok", changed: true });
    expect(parsedConfig.accounts).toEqual({ work: { allowFrom: [] } });
  });
});
