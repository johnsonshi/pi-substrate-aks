# Experiment 002: Local Pi Actor

## Metadata

- Date: 2026-08-24
- Local baseline commit: `fc49ca2`
- Pi SDK packages: `0.73.1`
- Copilot SDK: `1.0.11`
- Node.js: `v24.19.0`
- Runtime: trusted macOS arm64 workstation with disposable actor workspaces

## Question

Can Pi execute a complete coding loop through the structured broker protocol
without receiving a GitHub/Copilot credential or escaping its workspace?

## Implementation

- `packages/pi-actor/src/pi-actor.ts`
- `packages/pi-actor/src/broker-provider.ts`
- `packages/pi-actor/src/workspace-policy.ts`
- `tests/integration/pi-actor.test.ts`

Pi uses `createAgentSession()` with in-memory session, settings, and auth
registries. Resource discovery, context files, extensions, skills, templates,
themes, images, and built-in tools are disabled. The only tools are constrained
workspace read/edit/write and exact-allowlisted test execution.

The broker protocol carries structured tool calls and results. Broker-side SDK
handlers do not execute tools; they wait for actor-side Pi execution to return a
result.

## Commands

```bash
npm run typecheck
npm test
npm run smoke:copilot
```

## Result

**PASS**

- Type checking passed.
- All eight broker and actor tests passed.
- The actor read the deliberately broken fixture, edited only `math.js`, and
  ran `npm test` successfully.
- A requested `../outside-secret.txt` read was rejected, recorded as a tool
  error, and did not alter the outside file.
- Canonical symlink escape and Git-metadata-through-symlink reads were rejected.
- The existing real text-only Copilot broker smoke remained green and returned
  exactly `PISA_COPILOT_OK`.

## Security boundary

The actor receives only an actor-scoped ephemeral broker token. It receives no
GitHub, Copilot, Azure, kubeconfig, service-account, or local credential. Tool
paths reject traversal, `.git`, and canonical symlink escape. Test commands are
spawned directly without a shell and use a reduced environment.

This local policy does not claim kernel isolation and has a residual
check-to-write symlink-race risk. Container/Kata isolation and source transport
validation remain mandatory for remote use.

## Remaining work

- Run the Pi coding loop against the real Copilot SDK custom-tool backend.
- Package source as a validated archive and return a validated patch.
- Add process, network, service-account, metadata, and prompt-injection security
  tests under the eventual isolated runtime.

## Follow-up

The same eight-test suite passed after migrating to the patched
`@earendil-works/pi-*` `0.84.2` package family.
