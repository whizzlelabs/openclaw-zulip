import { describe, it, expect, vi, afterEach } from "vitest";
import { zulipMessagingAdapter } from "./messaging.js";

vi.mock("./outbound.js", () => ({
  buildClient: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("zulipMessagingAdapter", () => {
  describe("resolveSessionConversation", () => {
    it("returns bare id for stream without topic", () => {
      const result = zulipMessagingAdapter.resolveSessionConversation!({
        kind: "group",
        rawId: "42",
      });
      expect(result).toEqual({ id: "42" });
    });

    it("splits stream_id/topic and returns parent candidates", () => {
      const result = zulipMessagingAdapter.resolveSessionConversation!({
        kind: "group",
        rawId: "42/greetings",
      });
      expect(result).toEqual({
        id: "42/greetings",
        threadId: "greetings",
        baseConversationId: "42",
        parentConversationCandidates: ["42"],
      });
    });

    it("handles topic with slashes", () => {
      const result = zulipMessagingAdapter.resolveSessionConversation!({
        kind: "group",
        rawId: "10/path/to/topic",
      });
      expect(result).toEqual({
        id: "10/path/to/topic",
        threadId: "path/to/topic",
        baseConversationId: "10",
        parentConversationCandidates: ["10"],
      });
    });

    it("handles channel kind same as group", () => {
      const result = zulipMessagingAdapter.resolveSessionConversation!({
        kind: "channel",
        rawId: "5",
      });
      expect(result).toEqual({ id: "5" });
    });
  });

  describe("resolveSessionTarget", () => {
    it("returns id when no threadId", () => {
      const result = zulipMessagingAdapter.resolveSessionTarget!({
        kind: "group",
        id: "42",
      });
      expect(result).toBe("42");
    });

    it("returns id when threadId is present", () => {
      const result = zulipMessagingAdapter.resolveSessionTarget!({
        kind: "group",
        id: "42/greetings",
        threadId: "greetings",
      });
      expect(result).toBe("42/greetings");
    });
  });

  describe("parseExplicitTarget", () => {
    it("parses dm: prefix", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "dm:123" });
      expect(result).toEqual({ to: "123", chatType: "direct" });
    });

    it("parses stream: prefix without topic", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "stream:42" });
      expect(result).toEqual({ to: "42", chatType: "group" });
    });

    it("parses stream: prefix with topic (slash separator)", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "stream:42/hello" });
      expect(result).toEqual({ to: "42", threadId: "hello", chatType: "group" });
    });

    it("parses stream: prefix with topic (colon separator)", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "stream:Jeeves:agent-output" });
      expect(result).toEqual({ to: "Jeeves", threadId: "agent-output", chatType: "group" });
    });

    it("prefers slash over colon when both present", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "stream:42/topic:with:colons" });
      expect(result).toEqual({ to: "42", threadId: "topic:with:colons", chatType: "group" });
    });

    it("parses user: prefix with numeric ID", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "user:8" });
      expect(result).toEqual({ to: "8", chatType: "direct" });
    });

    it("parses user: prefix with email address", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "user:alice@example.com" });
      expect(result).toEqual({ to: "alice@example.com", chatType: "direct" });
    });

    it("returns null for unknown prefix", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "unknown:123" });
      expect(result).toBeNull();
    });
  });

  describe("targetResolver", () => {
    const resolver = zulipMessagingAdapter.targetResolver!;
    const baseCfg = {} as any;

    describe("looksLikeId", () => {
      it("recognizes stream: prefix", () => {
        expect(resolver.looksLikeId!("stream:42/topic")).toBe(true);
      });
      it("recognizes dm: prefix", () => {
        expect(resolver.looksLikeId!("dm:8")).toBe(true);
      });
      it("recognizes user: prefix", () => {
        expect(resolver.looksLikeId!("user:alice@example.com")).toBe(true);
      });
      it("rejects unknown prefix", () => {
        expect(resolver.looksLikeId!("foo:bar")).toBe(false);
      });
      it("recognizes a bare numeric conversation id", () => {
        expect(resolver.looksLikeId!("7")).toBe(true);
      });
      it("recognizes a bare numeric stream id with topic", () => {
        expect(resolver.looksLikeId!("7/general chat")).toBe(true);
      });
      it("rejects a bare non-numeric token", () => {
        expect(resolver.looksLikeId!("general")).toBe(false);
      });
    });

    describe("resolveTarget", () => {
      it("resolves dm: target", async () => {
        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "dm:42", normalized: "dm:42",
        });
        expect(result).toEqual({ to: "42", kind: "user", source: "normalized" });
      });

      it("resolves user: target with email", async () => {
        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "user:alice@example.com", normalized: "user:alice@example.com",
        });
        expect(result).toEqual({ to: "alice@example.com", kind: "user", source: "normalized" });
      });

      it("resolves numeric stream ID with topic via API", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => ({ stream_id: 42, name: "general", description: "", invite_only: false }),
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "stream:42/hello", normalized: "stream:42/hello",
        });
        expect(result).toEqual({
          to: "general/hello",
          kind: "channel",
          display: "#general > hello",
          source: "directory",
        });
      });

      it("falls back to numeric ID when API lookup fails", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => { throw new Error("not found"); },
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "stream:42/hello", normalized: "stream:42/hello",
        });
        expect(result).toEqual({ to: "42/hello", kind: "channel", source: "normalized" });
      });

      it("resolves stream name via API", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreams: async () => [
            { stream_id: 7, name: "Jeeves", description: "", invite_only: false },
          ],
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "stream:Jeeves:agent-output", normalized: "stream:Jeeves:agent-output",
        });
        expect(result).toEqual({
          to: "Jeeves/agent-output",
          kind: "channel",
          display: "#Jeeves > agent-output",
          source: "directory",
        });
      });

      it("returns null for stream name not found", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreams: async () => [],
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "stream:NonExistent/topic", normalized: "stream:NonExistent/topic",
        });
        expect(result).toBeNull();
      });

      it("returns null for unknown prefix", async () => {
        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "unknown:123", normalized: "unknown:123",
        });
        expect(result).toBeNull();
      });

      // Bare conversation ids (no scheme prefix) — the format the plugin's own
      // session/conversation ids use, which the agent passes back as a target.
      it("resolves a bare numeric stream id (preferredKind group) via API", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => ({ stream_id: 7, name: "Jeeves", description: "", invite_only: false }),
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "7", normalized: "7", preferredKind: "group",
        } as any);
        expect(result).toEqual({
          to: "Jeeves", kind: "channel", display: "#Jeeves", source: "directory",
        });
      });

      // Collision case: a bare numeric with no preferredKind hint is ambiguous
      // (a stream id and a user id can share a value). The resolver deliberately
      // treats it as a stream id — pin that so the behavior can't drift silently.
      it("resolves an unhinted bare numeric id as a stream (no preferredKind)", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => ({ stream_id: 9, name: "general", description: "", invite_only: false }),
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "9", normalized: "9",
        });
        expect(result).toEqual({
          to: "general", kind: "channel", display: "#general", source: "directory",
        });
      });

      it("resolves a bare numeric stream id with topic", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => ({ stream_id: 3, name: "general", description: "", invite_only: false }),
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "3/daily", normalized: "3/daily",
        });
        expect(result).toEqual({
          to: "general/daily", kind: "channel", display: "#general > daily", source: "directory",
        });
      });

      it("resolves a bare user id as a DM when preferredKind is user", async () => {
        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "9", normalized: "9", preferredKind: "user",
        } as any);
        expect(result).toEqual({ to: "9", kind: "user", source: "normalized" });
      });

      it("falls back to a DM for an unknown bare id when preferredKind is user", async () => {
        const { buildClient } = await import("./outbound.js");
        vi.mocked(buildClient).mockReturnValue({
          getStreamById: async () => { throw new Error("not found"); },
        } as any);

        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "999", normalized: "999", preferredKind: "user",
        } as any);
        expect(result).toEqual({ to: "999", kind: "user", source: "normalized" });
      });

      it("returns null for a bare non-numeric token", async () => {
        const result = await resolver.resolveTarget!({
          cfg: baseCfg, input: "general", normalized: "general",
        });
        expect(result).toBeNull();
      });
    });
  });
});
