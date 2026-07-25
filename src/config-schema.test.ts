import { describe, it, expect } from "vitest";
import { zulipConfigSchema } from "./config-schema.js";

// The adapters read config off the raw account object (see security.ts and
// allowlist.ts), so a field missing from this schema still works at runtime but
// gets stripped during validation and stays absent from the generated JSON
// Schema the config UI renders. These tests pin the account-level fields the
// adapters depend on.

type Section = Record<string, unknown>;

function parseSection(section: Section): Section {
  const result = zulipConfigSchema.runtime.safeParse(section);
  if (!result.success) {
    throw new Error(`schema rejected config: ${JSON.stringify(result.issues)}`);
  }
  return result.data as Section;
}

describe("zulipConfigSchema", () => {
  it("preserves account-level dmPolicy and allowFrom", () => {
    const parsed = parseSection({
      serverUrl: "https://zulip.example.com",
      email: "bot@example.com",
      apiKey: "secret",
      dmPolicy: "allowlist",
      allowFrom: ["someone@example.com", 42],
    });

    expect(parsed.dmPolicy).toBe("allowlist");
    expect(parsed.allowFrom).toEqual(["someone@example.com", 42]);
  });

  it("preserves dmPolicy and allowFrom on named sub-accounts", () => {
    const parsed = parseSection({
      accounts: {
        work: {
          serverUrl: "https://work.example.com",
          dmPolicy: "open",
          allowFrom: ["*"],
        },
      },
    });

    const accounts = parsed.accounts as Record<string, Section>;
    expect(accounts.work.dmPolicy).toBe("open");
    expect(accounts.work.allowFrom).toEqual(["*"]);
  });

  it("accepts every dmPolicy value the config resolver can hand to the adapters", () => {
    for (const policy of ["pairing", "allowlist", "open", "disabled"]) {
      expect(parseSection({ dmPolicy: policy }).dmPolicy).toBe(policy);
    }
  });

  it("rejects an unknown dmPolicy", () => {
    expect(zulipConfigSchema.runtime.safeParse({ dmPolicy: "nonsense" }).success).toBe(false);
  });

  // Validation-only: the adapters never read `dm`, so this pins that the shape
  // is accepted, NOT that setting it has any effect. See issue #44.
  it("accepts the nested dm form without erroring (inert — not read by adapters)", () => {
    const parsed = parseSection({
      dm: { policy: "allowlist", allowFrom: ["someone@example.com"] },
    });

    expect(parsed.dm).toEqual({ policy: "allowlist", allowFrom: ["someone@example.com"] });
  });

  it("preserves replyToMode and per-stream config", () => {
    const parsed = parseSection({
      replyToMode: "first",
      streams: { general: { requireMention: true }, ops: { enabled: false } },
    });

    expect(parsed.replyToMode).toBe("first");
    expect(parsed.streams).toEqual({
      general: { requireMention: true },
      ops: { enabled: false },
    });
  });

  it("preserves section-level ack reactions", () => {
    const parsed = parseSection({
      reactions: {
        enabled: true,
        onStart: "working_on_it",
        onSuccess: "check",
        onError: "cross_mark",
      },
    });

    expect(parsed.reactions).toEqual({
      enabled: true,
      onStart: "working_on_it",
      onSuccess: "check",
      onError: "cross_mark",
    });
  });

  it("accepts a multi-account section of the shape the live gateway runs", () => {
    const parsed = parseSection({
      enabled: true,
      defaultAccount: "bot",
      reactions: { enabled: true, onStart: "working_on_it" },
      accounts: {
        bot: {
          mode: "bot",
          serverUrl: "https://zulip.example.com",
          email: "bot@example.com",
          apiKey: "secret",
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["someone@example.com"],
          streams: { sandbox: { requireMention: true } },
        },
        second: { mode: "user", dmPolicy: "pairing" },
      },
    });

    expect(parsed.defaultAccount).toBe("bot");
    const accounts = parsed.accounts as Record<string, Section>;
    expect(Object.keys(accounts)).toEqual(["bot", "second"]);
    expect(accounts.bot.dmPolicy).toBe("allowlist");
  });

  it("exposes dmPolicy and allowFrom in the generated JSON Schema", () => {
    const properties = (zulipConfigSchema.schema as { properties?: Record<string, unknown> })
      .properties;

    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("dmPolicy");
    expect(properties).toHaveProperty("allowFrom");
  });
});
