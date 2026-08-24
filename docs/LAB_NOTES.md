# Lab Notes

This log is chronological and append-only. Outputs are sanitized and never
contain credentials, subscription IDs, tenant IDs, or kubeconfig contents.

## 2026-08-24 00:37 PDT - Safe preflight and repository creation

### Goal

Confirm the trusted workstation can run the POC and establish a private durable
repository before implementation.

### Hypothesis

The required local CLIs and authenticated contexts are available; kind may need
a project-local or user-local installation.

### Environment

- local git commit: not yet created
- upstream Substrate SHA: not yet selected
- Pi version/SHA: not yet selected
- AKS version: not yet provisioned
- runtime: macOS arm64 trusted operator machine
- Git `2.50.1`, Copilot CLI `1.0.81-3`, Azure CLI `2.89.1`
- kubectl `v1.36.1`, Docker `29.7.2`, Node `v24.19.0`
- npm `12.0.2`, Go `1.26.6`, Helm `v4.2.4`

### Actions

Ran status/version checks that do not reveal credentials, checked whether the
target GitHub repository existed, initialized Git, created the private GitHub
repository, and verified its visibility.

### Result

Required authenticated tools are available. The repository
`johnsonshi/pi-substrate-aks` exists with `PRIVATE` visibility. `kind` is not
installed.

### Evidence

- `STATUS.md`
- GitHub repository visibility query (observed interactively; no credential
  output retained)

### Interpretation

Local implementation and Azure experiments can proceed without transporting
credentials. The kind binary must be installed without modifying system-global
configuration.

### Decision / next step

Commit and push the bootstrap, then implement the local broker while independent
upstream investigations run.

## 2026-08-24 00:46 PDT - Local Copilot credential broker

### Goal

Prove a bounded broker can use the already authenticated local GitHub Copilot
runtime without accepting or returning raw GitHub credentials.

### Hypothesis

The official TypeScript Copilot SDK can use the logged-in local user while a
tool-free session and a narrow HTTP API keep actor-facing access separate from
credential resolution.

### Environment

- local git commit: `3e1ef52`
- upstream Substrate SHA: not yet selected
- Pi version/SHA: not yet selected
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, Node `v24.19.0`
- GitHub Copilot CLI `1.0.81-3`
- `@github/copilot-sdk` `1.0.11`
- relevant paths: `packages/copilot-broker/`, `packages/protocol/`,
  `scripts/smoke-copilot.ts`

### Actions

Implemented an actor-authenticated loopback broker, deterministic fake backend,
and official Copilot SDK backend. Restricted SDK sessions to an empty available
tool set, disabled cross-session storage, bounded request size/concurrency/time,
and returned generic external errors. Installed pinned dependencies with
lifecycle scripts disabled. Ran type checking, four broker tests, and one real
model request.

The local npm proxy initially rejected registry tarballs because remote package
fetches were disabled. The installation was retried with the invocation-scoped
`--allow-remote=all` option; no global npm configuration was changed.

### Result

All broker tests passed. The real authenticated request returned exactly
`PISA_COPILOT_OK`. The smoke test supplied no GitHub token and printed no
credential or session data.

### Evidence

- `experiments/001-local-broker/RESULTS.md`
- `tests/unit/copilot-broker.test.ts`
- `scripts/smoke-copilot.ts`
- `package-lock.json`

### Interpretation

The official SDK is a viable local credential boundary. Actor credentials can
authorize bounded model requests without exposing the underlying logged-in
GitHub identity material.

### Decision / next step

Use this broker behind the future relay and implement a Pi SDK actor against its
typed protocol.

## 2026-08-24 01:01 PDT - Fake-backed Pi coding actor

### Goal

Prove Pi can complete a structured read, edit, and test loop while every
operation remains confined to a disposable actor workspace.

### Hypothesis

A custom Pi model provider can translate broker tool-call envelopes into native
Pi tool calls, execute constrained tools actor-side, and return their results
without putting host tools or Copilot credentials behind the model API.

### Environment

- local git commit: `fc49ca2`
- upstream Substrate SHA: not yet selected
- Pi packages: `0.73.1`
- Copilot SDK: `1.0.11`
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, disposable temporary workspaces
- relevant paths: `packages/pi-actor/`, `tests/integration/pi-actor.test.ts`

### Actions

Extended the broker protocol with typed prompt, tool-call, and tool-result
envelopes. Added deferred Copilot custom-tool handlers that relay calls rather
than executing them. Built a Pi actor around `createAgentSession()` with
in-memory state, disabled resource discovery, canonical filesystem checks, and
an exact test-command allowlist. Ran type checking, the complete broker suite,
and four Pi integration cases.

The first actor run exposed a macOS path alias: the fixture was created below
`/var`, while `realpath()` canonicalized the policy root below `/private/var`.
The policy now accepts either known lexical root for the initial containment
check and still requires every existing path or writable ancestor to resolve
under the canonical root.

### Result

**PASS.** The fake-backed actor read `math.js`, replaced subtraction with
addition, ran the fixture's passing `npm test`, and changed no other file. A
separate model-requested `../outside-secret.txt` read failed, and the outside
file remained unchanged. Canonical symlink escape and
Git-metadata-through-symlink attempts were also blocked. All eight broker and
actor tests passed.

### Evidence

- `experiments/002-local-pi-actor/RESULTS.md`
- `tests/integration/pi-actor.test.ts`
- `packages/pi-actor/src/workspace-policy.ts`
- `packages/pi-actor/src/broker-provider.ts`

### Interpretation

Structured actor-side tools preserve the broker's credential boundary while
providing Pi a native coding loop. Canonical path policy is necessary defense in
depth, but runtime isolation is still required to close process, race, and
kernel-level escape paths.

### Decision / next step

Validate the same Pi loop against the real locally authenticated Copilot backend,
then implement archive-in and patch-out source transport.

## 2026-08-24 01:07 PDT - Real Pi and local Copilot coding loop

### Goal

Prove the constrained Pi actor can complete a coding task through real Copilot
custom tools while Copilot authentication remains exclusively in the trusted
local broker.

### Hypothesis

The Copilot SDK can keep one `sendAndWait()` turn active while deferred custom
tool handlers relay calls to Pi and await actor-side results.

### Environment

- local git commit: `6bd8c23`
- upstream Substrate SHA: not yet selected
- Pi packages: `0.73.1`
- Copilot SDK: `1.0.11`
- Copilot CLI: `1.0.81-3`
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, disposable fixture workspace
- relevant path: `scripts/smoke-pi-copilot.ts`

### Actions

Started the real SDK backend with logged-in-user resolution and an ephemeral
actor identity. Copied the repository-owned broken-calculator fixture to a
temporary workspace. Asked Pi to inspect `math.js`, correct the addition
function, and run `npm test`. Asserted the file contents, changed-file set,
successful test tool event, and non-empty final response. Removed the workspace
after the run.

### Result

**PASS.** The real model drove the actor through read, edit, and test operations.
The test passed, only `math.js` changed, and the script printed exactly
`PISA_PI_COPILOT_OK`.

### Evidence

- `experiments/003-local-pi-copilot/RESULTS.md`
- `scripts/smoke-pi-copilot.ts`
- `packages/copilot-broker/src/copilot-sdk-backend.ts`

### Interpretation

Pi and the real Copilot SDK interoperate through deferred structured tools.
Model authentication does not need to enter the actor process or workspace.

### Decision / next step

Implement trusted archive-in and validated patch-out transport before any actor
receives non-fixture source.

## 2026-08-24 01:11 PDT - Pi security migration

### Goal

Remove known production dependency vulnerabilities without regressing the Pi
coding loop or introducing file-backed credentials.

### Hypothesis

The maintained `@earendil-works/pi-*` package family is API-compatible after a
small migration to its `ModelRuntime` API and includes the published fixes.

### Environment

- local git commit: `2987391`
- old Pi packages: `@mariozechner/pi-*` `0.73.1`
- new Pi packages: `@earendil-works/pi-*` `0.84.2`
- runtime: trusted macOS arm64 workstation

### Actions

Reviewed the reported advisories, confirmed the deprecated namespace has no
patched release, and migrated all direct Pi imports together. Replaced legacy
auth/model registry construction with `ModelRuntime`, an in-memory credential
store, an in-memory model store, no models file, and network catalog refresh
disabled. Installed dependencies with lifecycle scripts disabled. Ran type
checking, all eight tests, the real Pi/Copilot smoke, and a production
dependency audit.

### Result

**PASS.** Fake and real actor flows remained green. The real smoke returned
`PISA_PI_COPILOT_OK`. `npm audit --omit=dev` reported zero vulnerabilities.

### Evidence

- `packages/pi-actor/package.json`
- `packages/pi-actor/src/pi-actor.ts`
- `package-lock.json`
- GitHub advisories `GHSA-jfgx-wxx8-mp94`,
  `GHSA-r95r-rj6r-c39x`, `GHSA-7v5m-pr3q-6453`, and
  `GHSA-jmr9-qjv8-65gv`

### Interpretation

Disabling extensions and file-backed auth reduced exploitability, but upgrading
removed the vulnerable code and archive dependency entirely. The in-memory
runtime preserves the no-actor-credential design.

### Decision / next step

Keep exact Pi versions pinned and include the production audit in security
checkpoints. Continue with source transport.

## 2026-08-24 01:21 PDT - Trusted source and patch transport

### Goal

Move committed source into an actor and return a locally committable change
without sharing trusted Git metadata, credentials, history, or a host mount.

### Hypothesis

A bounded `git archive` plus actor-local Git can preserve the current snapshot
and generate a robust binary patch. Replaying that patch in a disposable
repository can enforce the trust boundary before canonical application.

### Environment

- local git commit: `09a1fd9`
- source transport: Node.js plus Git `2.50.1`
- archive parser: `tar-stream` `3.1.7`
- runtime: trusted macOS arm64 workstation; all scratch data under `.state/`
- relevant paths: `packages/orchestrator/`,
  `tests/integration/source-transport.test.ts`

### Actions

Implemented exact-revision archive creation, SHA-256 archive and per-file
manifests, bounded tar parsing, private workspace materialization, and
credential-free actor-local Git initialization. Implemented staged full-index
binary patch export, changed-path and content scanning, disposable repository
replay, Git index mode validation, protected policy gating, and clean trusted
application. Added a fake-backed Pi roundtrip and negative tests.

### Result

**PASS.** Fifteen total tests passed, including seven source transport cases. A
Pi actor received only the archive and actor token, changed and tested
`math.js`, returned a patch, and the trusted temporary repository committed the
validated result. Credential-like paths, source/actor symlinks, protected
policy changes, repository-local artifacts outside `.state/`, and a modified
patch were rejected. The real Pi/Copilot smoke still returned
`PISA_PI_COPILOT_OK`, and the repository's committed tree produced a bounded
source archive successfully.

### Evidence

- `experiments/004-source-transport/RESULTS.md`
- `packages/orchestrator/src/source-transport.ts`
- `tests/integration/source-transport.test.ts`

### Interpretation

Snapshot archives avoid exposing reachable Git history. Validating the
post-application tree catches unsafe modes and links that header-only patch
inspection could miss. The actor still needs runtime isolation because its own
process and Git metadata are untrusted.

### Decision / next step

Pin and run the official Agent Substrate baseline on a local kind cluster before
creating Azure resources.
