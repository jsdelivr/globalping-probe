# AGENTS.md

## Project

- Node.js ESM TypeScript service for Globalping probes. It connects to the Globalping API and runs ping, traceroute, MTR, DNS, and HTTP measurements.
- Supports Node.js 18, 20, 22, 24, and 26. The production image uses Node.js 22 on Debian Linux.
- The runtime depends on the Linux networking tools installed by the `Dockerfile`, including `ping`, `traceroute`, `dig`, `mtr`, and `unbuffer`.
- Local development with `npm run dev` requires the main [Globalping API](https://github.com/jsdelivr/globalping) to be running.

## Commands

- Install: `npm ci`

## Worktree Setup

- Create worktrees under `.worktrees/` (already git-ignored).
- Run `npm ci` in each new worktree. Unit tests do not require external services.

## Code Style

- Use tabs for code indentation and spaces for Markdown.
- Keep the project ESM-only. Use explicit `.js` extensions in relative TypeScript imports.
- Follow the existing logging pattern: use the scoped logger in probe runtime modules and preserve the deliberate bootstrap output in `src/index.ts`.
- Keep interfaces direct. Avoid getters, factories, optional dependency parameters, or test-only methods unless production code needs them.
- Keep async behavior intentional. Await work when callers need the result; use `.catch()` for intentional fire-and-forget work.

## Testing

- For all test-related commands, set the following environment variables:
  - `MOCHA_OPTIONS="--reporter=min"` unless you specifically need details about passing tests,
  - `LOG_LEVEL="error"` unless you specifically need app log output at lower levels.
- Add or update tests when changing already-tested behavior.
- For existing untested code, keep fixes targeted and do not add tests unless asked.
- Unit tests live under `test/unit/`; command-output fixtures live under `test/mocks/`, with expected parsed output stored in matching JSON files where applicable.
- For normal verification, run sequentially: `npm run lint`, `npm run test:mocha`.
- Run `npm run test:e2e` when a change affects probe/API integration or when explicitly requested. It requires Docker and clones the Globalping API into `test/e2e/globalping/`.
- Update or regenerate snapshots only when the corresponding output change is intentional; use the existing `test:mocha:dev:*` scripts.
