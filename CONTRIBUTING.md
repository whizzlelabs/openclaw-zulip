# Contributing to openclaw-zulip

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- A Zulip instance with a bot account (for integration testing)

### Setup

```bash
git clone https://github.com/whizzlelabs/openclaw-zulip.git
cd openclaw-zulip
npm install
npm run build
```

### Environment

Copy `.env.example` to `.env` and fill in your Zulip bot credentials for local testing:

```bash
cp .env.example .env
```

## Development Workflow

### Branches

All work happens on feature branches. Never commit directly to `main`.

```bash
git checkout main && git pull
git checkout -b feat/my-feature
```

Branch naming: `<type>/<description>` where type is one of `feat`, `fix`, `refactor`, `chore`, `docs`.

### Making Changes

1. Make your changes in `src/`
2. Run `npm run build` to check types
3. Run `npm test` to verify tests pass
4. Commit with a conventional commit message

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

- **type:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- **scope:** `config`, `gateway`, `outbound`, `threading`, `messaging`, `bindings`, `security`, `setup`, `client`, `actions`, `directory`, `resolver`, `status`, `commands`, `groups`, `allowlist`, `repo`

### Pull Requests

1. Push your branch and open a PR against `main`
2. Fill in the PR description with what changed and why
3. Self-review the diff
4. Merge when ready

## Code Standards

### TypeScript

- **Strict mode** — `tsconfig.json` has `strict: true`, keep it that way
- **ESM** — All imports/exports use ES module syntax
- **No `any`** — Use proper types. If interfacing with untyped boundaries, use `unknown` and narrow
- **One adapter per file** — Each OpenClaw SDK adapter surface lives in its own module

### File Organization

- `src/index.ts` — Plugin entry point, exports the plugin definition
- `src/plugin.ts` — Assembles all adapters into the `ChannelPlugin` object
- `src/types.ts` — Shared types (account shapes, config sections)
- `src/config-schema.ts` — Zod-based config validation schema
- `src/<adapter>.ts` — One file per SDK adapter surface (config, gateway, outbound, threading, messaging, bindings, security, allowlist, actions, commands, directory, groups, resolver, status, setup, agent-prompt)
- `src/zulip-client.ts` — Zulip API wrapper (all HTTP calls go through here)

### Testing

- Tests live alongside source or in a `__tests__/` directory
- Mock the Zulip API, not the OpenClaw SDK
- Run with `npm test`

## Releasing

We use [semver](https://semver.org/) versioning and publish to npm manually.

### Version bumps

```bash
# Patch release (bug fixes): 0.1.0 → 0.1.1
npm version patch

# Minor release (new features): 0.1.1 → 0.2.0
npm version minor

# Major release (breaking changes): 0.2.0 → 1.0.0
npm version major
```

`npm version` updates `package.json`, commits the change, and creates a git tag automatically.

### Publish workflow

```bash
# 1. Make sure you're on main with a clean tree
git checkout main && git pull

# 2. Bump the version (creates commit + tag)
npm version patch   # or minor/major

# 3. Push the commit and tag
git push origin main --follow-tags

# 4. Publish to npm (runs clean + build + test automatically)
npm publish

# 5. Create a GitHub release
gh release create v<version> --title "v<version> — <title>" --notes "<changelog>"
```

### Pre-1.0 guidelines

While on `0.x`, both minor and patch bumps can include breaking changes. Use minor bumps for new features or breaking changes, patch for bug fixes.

## Security

- Never commit credentials, API keys, or tokens
- Use `.env` for local secrets (it's in `.gitignore`)
- Use placeholders in `.env.example`
- Review diffs for accidental secret exposure before pushing
