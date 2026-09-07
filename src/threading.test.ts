import { describe, expect, it } from "vitest";
import { zulipThreadingAdapter } from "./threading.js";

describe("zulipThreadingAdapter.resolveFocusedBinding", () => {
  it("parses an explicit stream target", () => {
    const result = zulipThreadingAdapter.resolveFocusedBinding!({
      context: { To: "stream:42", MessageThreadId: "deployments" },
    } as any);

    expect(result).toEqual({
      conversationId: "42/deployments",
      parentConversationId: "42",
      placement: "current",
      labelNoun: "topic",
    });
  });

  it("preserves an empty stream topic", () => {
    const result = zulipThreadingAdapter.resolveFocusedBinding!({
      context: { To: "stream:42", MessageThreadId: "" },
    } as any);

    expect(result).toEqual({
      conversationId: "42/",
      parentConversationId: "42",
      placement: "current",
      labelNoun: "topic",
    });
  });

  it("does not create a binding for a DM", () => {
    const result = zulipThreadingAdapter.resolveFocusedBinding!({
      context: { To: "user:200" },
    } as any);

    expect(result).toBeNull();
  });
});
