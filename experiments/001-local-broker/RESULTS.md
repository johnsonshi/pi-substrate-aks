# Experiment 001: Local Copilot Broker

## Metadata

- Date: 2026-08-24
- Local baseline commit: `3e1ef52`
- Copilot CLI: `1.0.81-3`
- Copilot SDK: `1.0.11`
- Node.js: `v24.19.0`
- Runtime: trusted macOS arm64 workstation

## Question

Can a narrow local API use existing GitHub Copilot authentication without
accepting, returning, logging, or persisting the raw credential?

## Implementation

- `packages/copilot-broker/src/http-server.ts`
- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `packages/copilot-broker/src/fake-backend.ts`
- `packages/copilot-broker/src/actor-token-authorizer.ts`
- `scripts/smoke-copilot.ts`

The server binds to loopback, maps actor tokens to identities using retained
SHA-256 digests, enforces session ownership, and bounds bodies, message length,
concurrency, and duration. The SDK backend uses logged-in-user resolution and
supplies no GitHub token. Sessions expose `availableTools: []`.

## Commands

```bash
npm run typecheck
npm test
npm run smoke:copilot
```

## Result

**PASS**

- Type checking passed.
- Four broker tests passed.
- The real SDK smoke request returned exactly `PISA_COPILOT_OK`.
- Unauthorized requests returned `401`.
- Cross-actor session access returned `403`.
- Oversized requests returned `413`.
- Concurrent excess requests returned `429`.
- Timed-out requests returned `504`.
- Client-visible responses contained neither the actor token nor backend error
  details.

## Credential boundary

The real smoke request relied on the SDK's local logged-in-user resolution.
Neither the smoke client nor broker API supplied a GitHub/Copilot token. No
credential files, values, environment dump, or SDK session transcript were
captured.

## Remaining work

- Drive the broker through a Pi provider adapter.
- Insert a credential-free in-cluster relay.
- Verify the same boundary from remote actors and under tunnel failure.
