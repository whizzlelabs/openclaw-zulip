import type { ZulipResolvedAccount, ZulipStreamConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Stream registry — stream_id → name
//
// Per-stream config (`account.streams`) is keyed by stream *name*, but the
// gateway works in stream *IDs*: peerId is "<stream_id>/<topic>" and the
// groupId handed to the groups adapter is the bare stream ID. Without a way
// back from ID to name, every per-stream lookup misses.
//
// Inbound stream messages carry the name in `display_recipient`, so the poll
// loop can seed the map for free. Callers that only hold an ID (the groups
// adapter) read what the gateway has already seen; a miss falls back to a
// lazy hydrate from the API.
// ---------------------------------------------------------------------------

// Per-account store: stream_id → stream name
const namesByAccount = new Map<string, Map<number, string>>();

function getStore(accountId: string): Map<number, string> {
  let store = namesByAccount.get(accountId);
  if (!store) {
    store = new Map();
    namesByAccount.set(accountId, store);
  }
  return store;
}

export function rememberStreamName(
  accountId: string,
  streamId: number,
  name: string,
): void {
  if (!name) return;
  getStore(accountId).set(streamId, name);
}

export function lookupStreamName(
  accountId: string,
  streamId: number,
): string | undefined {
  return getStore(accountId).get(streamId);
}

/**
 * Reverse lookup: name → stream ID.
 *
 * Needed because callers frequently hold only a name — the groups adapter gets
 * the stream name via `groupChannel` and never a usable ID — while config may
 * be keyed by ID. Without this, ID-keyed entries are unreachable for those
 * callers. Matching is case- and whitespace-insensitive, like config keys.
 */
export function lookupStreamId(
  accountId: string,
  name: string,
): number | undefined {
  const wanted = normalizeName(name);
  if (wanted === "") return undefined;

  for (const [streamId, streamName] of getStore(accountId)) {
    if (normalizeName(streamName) === wanted) return streamId;
  }
  return undefined;
}

/**
 * Replace the cached names for an account in one pass — used when hydrating
 * from `getStreams()`. Existing entries are kept: a name seen on an inbound
 * message is as authoritative as one from the API, and dropping it would
 * reintroduce misses between hydrations.
 */
export function hydrateStreamNames(
  accountId: string,
  streams: Array<{ stream_id: number; name: string }>,
): void {
  const store = getStore(accountId);
  for (const stream of streams) {
    store.set(stream.stream_id, stream.name);
  }
}

export function clearStreamRegistry(accountId: string): void {
  namesByAccount.delete(accountId);
}

// ---------------------------------------------------------------------------
// Per-stream config resolution
// ---------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * An entirely numeric config key selects a stream by ID, so it must never also
 * match by name — otherwise a stream literally *named* "42" would pick up the
 * config meant for stream ID 42. The cost is that a numerically-named stream
 * can only be configured by its ID; that is the documented tradeoff.
 */
function isIdKey(key: string): boolean {
  return /^\d+$/.test(key.trim());
}

/**
 * Resolve the per-stream config block for a stream, given whatever identity
 * the caller happens to hold.
 *
 * Config keys are matched in this order:
 *   1. exact name match
 *   2. case-insensitive / whitespace-trimmed name match — Zulip stream names
 *      are display strings, and operators do not reproduce them byte-exactly
 *   3. entirely numeric key matched against the stream ID, so a config can pin
 *      a stream that gets renamed
 *
 * Numeric keys participate only in step 3 — see isIdKey().
 */
export function resolveStreamConfig(
  account: Pick<ZulipResolvedAccount, "streams">,
  ref: { streamId?: number; streamName?: string },
): ZulipStreamConfig | undefined {
  const { streams } = account;
  if (!streams) return undefined;

  if (ref.streamName !== undefined && !isIdKey(ref.streamName)) {
    const direct = streams[ref.streamName];
    if (direct) return direct;

    const wanted = normalizeName(ref.streamName);
    for (const [key, value] of Object.entries(streams)) {
      if (isIdKey(key)) continue;
      if (normalizeName(key) === wanted) return value;
    }
  }

  if (ref.streamId !== undefined) {
    const byId = streams[String(ref.streamId)];
    if (byId) return byId;

    // isIdKey() trims, so a padded key like " 42 " counts as an ID selector —
    // match it here too rather than leaving it unusable in both passes.
    for (const [key, value] of Object.entries(streams)) {
      if (isIdKey(key) && Number(key.trim()) === ref.streamId) return value;
    }
  }

  return undefined;
}
