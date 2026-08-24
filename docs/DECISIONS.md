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

## D-003: Use the official Copilot SDK with explicit tool allowlists

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
argument, disabled cross-session storage, and a replaced system message.
Text-only sessions use `availableTools: []`. Actor sessions expose only
explicitly declared `custom:*` relay tools and disable tool search.

### Rationale

The SDK is the supported typed JSON-RPC interface and has explicit session,
timeout, tool, and lifecycle APIs. Explicit allowlisting prevents the model
runtime from discovering or executing local shell, file, network, or
credential-access tools.

### Consequences

The broker process remains trusted and must run locally. SDK version changes need
contract tests. Actor-facing errors and logs must remain redacted.

### Evidence

- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `experiments/001-local-broker/RESULTS.md`

## D-004: Declare tools at the broker and execute them only in the actor

**Status:** accepted

### Context

Pi needs structured tool calls to run a coding loop. Returning tool instructions
as model text is ambiguous, while executing SDK custom-tool handlers in the
trusted broker would expose the local host to untrusted model actions.

### Options considered

- Parse tool requests from assistant text.
- Execute Copilot SDK custom tools inside the trusted broker.
- Declare bounded tools to Copilot, defer their handlers, execute calls through
  Pi in the actor workspace, and return structured results.

### Decision

Use typed prompt, tool-call, and tool-result envelopes. SDK handlers publish a
call and wait on a deferred result. Pi executes only its registered constrained
tools, then the broker resolves the handler so the original Copilot turn can
continue.

### Rationale

This preserves native structured tool calling without giving the trusted broker
filesystem or command-execution responsibilities. Actor runtime policy remains
the enforcement point even when repository content or model output is hostile.

### Consequences

The broker must bind each pending call to its session and reject unmatched
results. Actor tools need canonical path checks, exact command allowlists, and
stronger process/runtime isolation before remote use.

### Evidence

- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `packages/pi-actor/src/broker-provider.ts`
- `experiments/002-local-pi-actor/RESULTS.md`

## D-005: Migrate Pi to the patched package namespace

**Status:** accepted

### Context

GitHub reported high-severity advisories after the initial Pi integration. The
deprecated `@mariozechner/pi-coding-agent` line ends at `0.73.1` and has no
patched release. The maintained package moved to `@earendil-works`.

### Options considered

- Retain `0.73.1` because extensions and file-backed auth are disabled.
- Downgrade according to npm's incomplete automatic fix suggestion.
- Migrate the complete Pi package family to a current patched release.

### Decision

Pin `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent` to `0.84.2`.
Use in-memory credential and model stores with model-network refresh disabled.

### Rationale

Avoiding vulnerable code paths is defense in depth, not a substitute for taking
available security patches. Migrating the complete family avoids mixed-scope
type/runtime duplication and resolves the vulnerable transitive archive
dependency.

### Consequences

The actor uses the newer `ModelRuntime` API instead of the legacy in-memory
`AuthStorage`/`ModelRegistry` factories. Future updates require both fake and
real coding-loop validation.

### Evidence

- `packages/pi-actor/package.json`
- `packages/pi-actor/src/pi-actor.ts`
- zero findings from `npm audit --omit=dev` on 2026-08-24
- successful `npm run smoke:pi-copilot`

## D-006: Transport a snapshot archive, then validate a binary patch locally

**Status:** accepted

### Context

Actors need source and must return changes without GitHub credentials, host
mounts, or access to canonical Git metadata. A Git bundle includes reachable
history and could expose credentials deleted from the current tree.

### Options considered

- Mount the trusted working tree into the actor.
- Send a Git bundle with history and refs.
- Send a committed `git archive`, initialize actor-local Git metadata, and
  return a full-index binary patch.

### Decision

Create a bounded archive for one resolved commit, attach a SHA-256 content
manifest, and allow only regular files. Initialize a credential-free baseline
repository after materialization. Export a bounded binary patch, apply it to a
fresh validation workspace, inspect resulting paths/files/index modes, then
stage it in a clean trusted repository.

### Rationale

An archive exposes only the selected snapshot. Actor-local Git enables robust
binary diffs without carrying trusted history or configuration. Reapplying in a
disposable repository validates the final filesystem, not only patch text.

### Consequences

Symlinked files and submodules are rejected for this POC. Credential-like paths
or content fail closed. Authoritative prompts, security policy, workflows, and
enforcement code require an explicit `allowProtectedPaths` override. The final
commit remains a trusted local action.

### Evidence

- `packages/orchestrator/src/source-transport.ts`
- `tests/integration/source-transport.test.ts`
- `experiments/004-source-transport/RESULTS.md`
