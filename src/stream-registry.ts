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

/**
 * Both directions are indexed, and the pair is kept strictly one-to-one on the
 * normalized name.
 *
 * The queue subscribes to message events only, so the registry never sees a
 * rename — it only ever learns that some ID now reports some name. If a stream
 * is renamed away and its old name reused by another stream, a name would map
 * to two IDs, and any scan would be free to return the stale one. Enforcing
 * one-to-one on write, latest observation winning, keeps that impossible
 * rather than merely unlikely.
 */
type StreamRegistry = {
  namesById: Map<number, string>;
  idsByName: Map<string, number>;
};

const registryByAccount = new Map<string, StreamRegistry>();

function getStore(accountId: string): StreamRegistry {
  let store = registryByAccount.get(accountId);
  if (!store) {
    store = { namesById: new Map(), idsByName: new Map() };
    registryByAccount.set(accountId, store);
  }
  return store;
}

export function rememberStreamName(
  accountId: string,
  streamId: number,
  name: string,
): void {
  if (!name) return;

  const store = getStore(accountId);
  const key = normalizeName(name);
  if (key === "") return;

  // This stream had a different name: retire the old reverse entry, but only
  // if it still points here — another stream may already have claimed it.
  const previousName = store.namesById.get(streamId);
  if (previousName !== undefined) {
    const previousKey = normalizeName(previousName);
    if (previousKey !== key && store.idsByName.get(previousKey) === streamId) {
      store.idsByName.delete(previousKey);
    }
  }

  // Another stream held this name: it must have been renamed away without us
  // seeing it. We do not know its new name, so drop it entirely — keeping a
  // name we know to be wrong would mis-resolve config for that ID too.
  const previousHolder = store.idsByName.get(key);
  if (previousHolder !== undefined && previousHolder !== streamId) {
    store.namesById.delete(previousHolder);
  }

  store.namesById.set(streamId, name);
  store.idsByName.set(key, streamId);
}

export function lookupStreamName(
  accountId: string,
  streamId: number,
): string | undefined {
  return getStore(accountId).namesById.get(streamId);
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

  return getStore(accountId).idsByName.get(wanted);
}

/**
 * Fold a stream listing into the cache — used when hydrating from
 * `getStreams()`. Entries not mentioned in the batch are kept: a name seen on
 * an inbound message is as authoritative as one from the API, and dropping it
 * would reintroduce misses between hydrations.
 *
 * Goes through the same write path as rememberStreamName(), so a rename
 * observed here evicts the stale mapping identically.
 */
export function hydrateStreamNames(
  accountId: string,
  streams: Array<{ stream_id: number; name: string }>,
): void {
  for (const stream of streams) {
    rememberStreamName(accountId, stream.stream_id, stream.name);
  }
}

export function clearStreamRegistry(accountId: string): void {
  registryByAccount.delete(accountId);
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
