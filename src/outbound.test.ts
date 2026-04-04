import { describe, it, expect } from "vitest";
import { resolveOutboundTarget } from "./outbound.js";

describe("resolveOutboundTarget", () => {
  it("treats numeric string as DM when no threadId", () => {
    const result = resolveOutboundTarget("8", undefined);
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("treats numeric string with threadId as stream message", () => {
    const result = resolveOutboundTarget("42", "general");
    expect(result).toEqual({ type: "stream", to: "42", topic: "general" });
  });

  it("handles user: prefix with numeric ID", () => {
    const result = resolveOutboundTarget("user:8", "some-topic");
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("handles user: prefix with email address", () => {
    const result = resolveOutboundTarget("user:alice@example.com", "some-topic");
    expect(result).toEqual({ type: "direct", to: ["alice@example.com"] });
  });

  it("handles dm: prefix with numeric ID", () => {
    const result = resolveOutboundTarget("dm:8", undefined);
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("handles dm: prefix with email address", () => {
    const result = resolveOutboundTarget("dm:bob@example.com", undefined);
    expect(result).toEqual({ type: "direct", to: ["bob@example.com"] });
  });

  it("user: prefix overrides threadId (always DM)", () => {
    const result = resolveOutboundTarget("user:42", "topic");
    expect(result).toEqual({ type: "direct", to: [42] });
  });

  it("handles stream: prefix with slash separator", () => {
    const result = resolveOutboundTarget("stream:42/general", undefined);
    expect(result).toEqual({ type: "stream", to: "42", topic: "general" });
  });

  it("handles stream: prefix with colon separator", () => {
    const result = resolveOutboundTarget("stream:Jeeves:agent-output", undefined);
    expect(result).toEqual({ type: "stream", to: "Jeeves", topic: "agent-output" });
  });

  it("handles stream: prefix without topic uses threadId", () => {
    const result = resolveOutboundTarget("stream:42", "fallback-topic");
    expect(result).toEqual({ type: "stream", to: "42", topic: "fallback-topic" });
  });

  it("handles stream: prefix with topic containing colons (slash separator)", () => {
    const result = resolveOutboundTarget("stream:42/topic:with:colons", undefined);
    expect(result).toEqual({ type: "stream", to: "42", topic: "topic:with:colons" });
  });

  it("handles empty threadId as DM", () => {
    const result = resolveOutboundTarget("8", "");
    expect(result).toEqual({ type: "direct", to: [8] });
  });

  it("handles null threadId as DM", () => {
    const result = resolveOutboundTarget("8", null);
    expect(result).toEqual({ type: "direct", to: [8] });
  });
});
