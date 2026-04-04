import { describe, it, expect } from "vitest";
import { getZulipSection } from "./types.js";

describe("getZulipSection", () => {
  it("returns undefined when no channels config", () => {
    const cfg = {} as any;
    expect(getZulipSection(cfg)).toBeUndefined();
  });

  it("returns undefined when no zulip section", () => {
    const cfg = { channels: {} } as any;
    expect(getZulipSection(cfg)).toBeUndefined();
  });

  it("returns the zulip section", () => {
    const zulip = { serverUrl: "https://example.com", email: "bot@ex.com" };
    const cfg = { channels: { zulip } } as any;
    expect(getZulipSection(cfg)).toBe(zulip);
  });
});
