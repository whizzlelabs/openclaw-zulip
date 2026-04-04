import { describe, it, expect } from "vitest";
import { zulipMessagingAdapter } from "./messaging.js";

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

    it("parses stream: prefix with topic", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "stream:42/hello" });
      expect(result).toEqual({ to: "42", threadId: "hello", chatType: "group" });
    });

    it("returns null for unknown prefix", () => {
      const result = zulipMessagingAdapter.parseExplicitTarget!({ raw: "unknown:123" });
      expect(result).toBeNull();
    });
  });
});
