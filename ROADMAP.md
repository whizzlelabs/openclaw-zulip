# Roadmap

Target: **feature complete + hardened for low-touch maintenance**, tracked in the
[1.0 milestone](https://github.com/whizzlelabs/openclaw-zulip/milestone/1). After 1.0 the plugin
enters maintenance mode: dependency bumps are automated, CI watches for openclaw drift, and new work
happens only when a major openclaw update requires it.

Issues are the source of truth — this file is the map, not the detail.

## Phase 0 — Foundation

| Item | Issue |
|---|---|
| Bump openclaw to 2026.7.1 | [#45](https://github.com/whizzlelabs/openclaw-zulip/issues/45) |
| CI: PR checks + scheduled compat build against latest openclaw | [#46](https://github.com/whizzlelabs/openclaw-zulip/issues/46) |
| Automated dependency bumps (exact openclaw pin) | [#47](https://github.com/whizzlelabs/openclaw-zulip/issues/47) |
| Release automation | [#24](https://github.com/whizzlelabs/openclaw-zulip/issues/24) |
| Zulip 12 API audit of `zulip-client.ts` | [#48](https://github.com/whizzlelabs/openclaw-zulip/issues/48) |

## Phase 1 — Correctness & security

| Item | Issue |
|---|---|
| `groupAllowFrom` configured but never read | [#44](https://github.com/whizzlelabs/openclaw-zulip/issues/44) |
| Deliberate working-state signalling (fixes improper acks) | [#36](https://github.com/whizzlelabs/openclaw-zulip/issues/36) |
| Verify DM pairing flow end-to-end | [#49](https://github.com/whizzlelabs/openclaw-zulip/issues/49) |
| Verify mention handling (wildcards, group mentions) | [#50](https://github.com/whizzlelabs/openclaw-zulip/issues/50) |
| Persist ACP topic bindings across restarts | [#51](https://github.com/whizzlelabs/openclaw-zulip/issues/51) |

## Phase 2 — Features

| Item | Issue |
|---|---|
| Block streaming | [#52](https://github.com/whizzlelabs/openclaw-zulip/issues/52) |
| Thinking stream + tool outputs as Zulip spoiler blocks (opt-in) | [#53](https://github.com/whizzlelabs/openclaw-zulip/issues/53) |
| Reaction-based exec approvals | [#54](https://github.com/whizzlelabs/openclaw-zulip/issues/54) |
| Topic lifecycle integration (resolve state ↔ sessions) | [#55](https://github.com/whizzlelabs/openclaw-zulip/issues/55) |
| Zulip agent tools (search, topic management) | [#56](https://github.com/whizzlelabs/openclaw-zulip/issues/56) |
| Doctor adapter (`openclaw doctor` diagnostics) | [#57](https://github.com/whizzlelabs/openclaw-zulip/issues/57) |

All feature knobs follow one convention: validated in `config-schema.ts` **and** read in the
runtime path (they are separate — see AGENTS.md), named after the equivalent option in openclaw's
bundled channels where one exists.

## Won't do

Documented so nobody (including future maintainers) re-investigates:

- **Native commands** — Zulip slash commands are hardcoded client-side ("zcommands"); there is no
  API for bots to register commands with autocomplete. Text-parsed commands via the generic
  OpenClaw path already work; a native-commands adapter would add surface without adding UX.
- **Polls** — Zulip polls are client-side widgets with no useful bot interaction model.
- **Message effects / group management / TTS voice notes** — no meaningful Zulip mapping; no
  first-party OpenClaw channel enables effects or group management either.
