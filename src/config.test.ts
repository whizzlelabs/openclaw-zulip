import { describe, it, expect } from "vitest";
import { resolveZulipAccount } from "./config.js";
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
