# Decisions

## D-001: Keep model credentials behind a local broker

**Status:** accepted

### Context

Remote actors need model access, but copying the operator's GitHub Copilot
credential into AKS would collapse the actor isolation boundary.

### Options considered

- Copy a Copilot or GitHub token into each actor.
- Store a Copilot credential in a Kubernetes Secret.
- Keep authentication local and proxy bounded model requests through an
  authenticated relay.

### Decision

Use the existing authenticated local GitHub Copilot CLI behind a local broker.
Remote actors authenticate to a credential-free in-cluster relay using
short-lived actor-scoped credentials.

### Rationale

Stopping the local broker immediately revokes model access, and compromised
actors cannot read or reuse the underlying GitHub credential.

### Consequences

Remote runs require the trusted workstation and a private tunnel. Relay identity,
request limits, redaction, and fail-closed behavior become security-critical.

### Evidence

- `DESIGN.md` sections 3-5
- Security tests to be added under `tests/security/`

## D-002: Keep canonical Git operations local

**Status:** accepted

### Context

Actors must edit code without receiving repository credentials.

### Options considered

- Give actors GitHub credentials.
- Mount the trusted local repository into actor workloads.
- Transfer a source archive and return a validated binary patch.

### Decision

The local orchestrator exports source snapshots and validates returned patches.
Only the trusted local workspace commits and pushes.

### Rationale

This preserves the GitHub credential and filesystem boundaries while retaining a
reviewable coding workflow.

### Consequences

The orchestrator must reject traversal, symlink escapes, hooks, credential-like
files, and safety-policy changes before applying actor output.

### Evidence

- `DESIGN.md` sections 4 and 8

## D-003: Use the official Copilot SDK with tool-free sessions

**Status:** accepted

### Context

The broker needs a supported programmatic interface to the authenticated local
Copilot runtime. Parsing interactive CLI text would be brittle, and passing a
token explicitly would violate the credential boundary.

### Options considered

- Spawn `copilot -p` and parse text output.
- Use a private or reverse-engineered protocol.
- Use the official `@github/copilot-sdk` package and logged-in-user resolution.

### Decision

Use `@github/copilot-sdk` `1.0.11` with `useLoggedInUser: true`, no token
argument, `availableTools: []`, disabled cross-session storage, and a replaced
text-only system message.

### Rationale

The SDK is the supported typed JSON-RPC interface and has explicit session,
timeout, and lifecycle APIs. Empty tool availability prevents the model runtime
from executing local shell, file, network, or credential-discovery tools.

### Consequences

The broker process remains trusted and must run locally. SDK version changes need
contract tests. Actor-facing errors and logs must remain redacted.

### Evidence

- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `experiments/001-local-broker/RESULTS.md`
