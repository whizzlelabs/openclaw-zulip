import { describe, it, expect } from "vitest";
import { resolveZulipAccount, listZulipAccountIds } from "./config.js";
import type { CoreConfig } from "./types.js";

function makeConfig(overrides: Record<string, unknown> = {}): CoreConfig {
  return {
    channels: {
      zulip: {
        accounts: {
          default: {
            serverUrl: "https://zulip.example.com",
            email: "bot@example.com",
            apiKey: "secret-key",
            ...overrides,
          },
        },
      },
    },
  } as CoreConfig;
}

describe("resolveZulipAccount", () => {
  it("resolves a fully configured account", () => {
    const account = resolveZulipAccount(makeConfig());

    expect(account.accountId).toBe("default");
    expect(account.serverUrl).toBe("https://zulip.example.com");
    expect(account.email).toBe("bot@example.com");
    expect(account.apiKey).toBe("secret-key");
    expect(account.configured).toBe(true);
    expect(account.enabled).toBe(true);
    expect(account.mode).toBe("bot");
  });

  it("marks unconfigured when missing apiKey", () => {
    const account = resolveZulipAccount(makeConfig({ apiKey: undefined }));
    expect(account.configured).toBe(false);
  });

  it("marks unconfigured when missing serverUrl", () => {
    const account = resolveZulipAccount(makeConfig({ serverUrl: undefined }));
    expect(account.configured).toBe(false);
  });

  it("marks disabled when enabled is false", () => {
    const account = resolveZulipAccount(makeConfig({ enabled: false }));
    expect(account.enabled).toBe(false);
  });

  it("defaults dmPolicy to pairing", () => {
    const account = resolveZulipAccount(makeConfig());
    expect(account.dmPolicy).toBe("pairing");
  });

  it("resolves nested DM policy and allowlist", () => {
    const account = resolveZulipAccount(makeConfig({
      dm: { policy: "allowlist", allowFrom: [200] },
    }));
    expect(account.dmPolicy).toBe("allowlist");
    expect(account.allowFrom).toEqual([200]);
  });

  it("prefers flat DM fields within the same account", () => {
    const account = resolveZulipAccount(makeConfig({
      dmPolicy: "open",
      allowFrom: [201],
      dm: { policy: "allowlist", allowFrom: [200] },
    }));
    expect(account.dmPolicy).toBe("open");
    expect(account.allowFrom).toEqual([201]);
  });

  it("prefers a named account's nested DM fields over root flat defaults", () => {
    const cfg = {
      channels: { zulip: {
        dmPolicy: "open",
        allowFrom: [201],
        accounts: { work: { dm: { policy: "allowlist", allowFrom: [200] } } },
      } },
    } as CoreConfig;
    const account = resolveZulipAccount(cfg, "work");
    expect(account.dmPolicy).toBe("allowlist");
    expect(account.allowFrom).toEqual([200]);
  });

  it("inherits root nested DM fields when the account does not override them", () => {
    const cfg = {
      channels: { zulip: {
        dm: { policy: "allowlist", allowFrom: [200] },
        accounts: { work: { mode: "user" } },
      } },
    } as CoreConfig;
    const account = resolveZulipAccount(cfg, "work");
    expect(account.dmPolicy).toBe("allowlist");
    expect(account.allowFrom).toEqual([200]);
  });

  it("resolves group sender allowlists per account without a DM fallback", () => {
    const cfg = {
      channels: { zulip: {
        allowFrom: [201],
        groupAllowFrom: [200],
        accounts: { work: { groupAllowFrom: [300] }, other: {} },
      } },
    } as CoreConfig;
    expect(resolveZulipAccount(cfg, "work").groupAllowFrom).toEqual([300]);
    expect(resolveZulipAccount(cfg, "other").groupAllowFrom).toEqual([200]);
    expect(resolveZulipAccount(makeConfig({ allowFrom: [201] })).groupAllowFrom).toEqual([]);
  });

  it("inherits a restricted root group list through an empty account override", () => {
    const cfg = {
      channels: { zulip: {
        groupAllowFrom: [200],
        accounts: {
          inherited: { groupAllowFrom: [] },
          open: { groupAllowFrom: ["*"] },
        },
      } },
    } as CoreConfig;
    expect(resolveZulipAccount(cfg, "inherited").groupAllowFrom).toEqual([200]);
    expect(resolveZulipAccount(cfg, "open").groupAllowFrom).toEqual(["*"]);
  });

  it("defaults mode to bot", () => {
    const account = resolveZulipAccount(makeConfig());
    expect(account.mode).toBe("bot");
  });

  it("respects user mode", () => {
    const account = resolveZulipAccount(makeConfig({ mode: "user" }));
    expect(account.mode).toBe("user");
  });

  it("defaults replyToMode to all", () => {
    const account = resolveZulipAccount(makeConfig());
    expect(account.replyToMode).toBe("all");
  });

  it("returns empty streams by default", () => {
    const account = resolveZulipAccount(makeConfig());
    expect(account.streams).toEqual({});
  });

  it("resolves a named account", () => {
    const cfg: CoreConfig = {
      channels: {
        zulip: {
          accounts: {
            "my-bot": {
              serverUrl: "https://z.example.com",
              email: "mybot@example.com",
              apiKey: "key123",
            },
          },
        },
      },
    } as CoreConfig;

    const account = resolveZulipAccount(cfg, "my-bot");
    expect(account.accountId).toBe("my-bot");
    expect(account.email).toBe("mybot@example.com");
  });

  it("returns unconfigured account for empty config", () => {
    const cfg = {} as CoreConfig;
    const account = resolveZulipAccount(cfg);
    expect(account.configured).toBe(false);
    expect(account.serverUrl).toBe("");
    expect(account.email).toBe("");
    expect(account.apiKey).toBe("");
  });
});

describe("listZulipAccountIds", () => {
  it("returns default when no accounts map exists but base credentials are set", () => {
    const cfg = {
      channels: {
        zulip: {
          email: "bot@example.com",
          apiKey: "key",
        },
      },
    } as CoreConfig;

    expect(listZulipAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns default when accounts map is empty and base credentials are set", () => {
    const cfg = {
      channels: {
        zulip: {
          email: "bot@example.com",
          apiKey: "key",
          accounts: {},
        },
      },
    } as CoreConfig;

    expect(listZulipAccountIds(cfg)).toEqual(["default"]);
  });

  it("includes default alongside named accounts when base credentials exist", () => {
    const cfg = {
      channels: {
        zulip: {
          email: "bot@example.com",
          apiKey: "key",
          accounts: {
            bot1: { apiKey: "k1" },
            bot2: { apiKey: "k2" },
          },
        },
      },
    } as CoreConfig;

    const ids = listZulipAccountIds(cfg);
    expect(ids).toContain("default");
    expect(ids).toContain("bot1");
    expect(ids).toContain("bot2");
    expect(ids).toHaveLength(3);
  });

  it("does not include default when no base credentials exist", () => {
    const cfg = {
      channels: {
        zulip: {
          accounts: {
            bot1: { email: "b1@example.com", apiKey: "k1" },
          },
        },
      },
    } as CoreConfig;

    expect(listZulipAccountIds(cfg)).toEqual(["bot1"]);
  });

  it("returns empty list when config has no section at all", () => {
    const cfg = {} as CoreConfig;
    expect(listZulipAccountIds(cfg)).toEqual([]);
  });
});
