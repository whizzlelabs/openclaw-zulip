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
