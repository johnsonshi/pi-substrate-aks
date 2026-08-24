# Pi Substrate AKS

Private proof of concept for running credential-free Pi coding actors on isolated
AKS workloads while keeping GitHub Copilot authentication on a trusted local
machine.

The local credential broker is proven against the authenticated GitHub Copilot
SDK, and a constrained Pi SDK actor has completed a real read, edit, and test
task through that broker. Remote actor and AKS work remains in progress. See
[STATUS.md](STATUS.md) for verified capabilities, [DESIGN.md](DESIGN.md) for
the authoritative design, and [docs/LAB_NOTES.md](docs/LAB_NOTES.md) for the
append-only experiment record.

## Security boundary

- Remote actors never receive GitHub, Copilot, Azure, SSH, or kubeconfig
  credentials.
- GitHub and Azure writes run only from the trusted local workspace.
- Model requests cross an authenticated relay to the local Copilot broker; raw
  credentials never cross the broker API.
- Azure resources are limited to `rg-pi-substrate-aks`.

## Bootstrap

```bash
./scripts/preflight.sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

The real broker smoke test consumes one Copilot model request:

```bash
npm run smoke:copilot
```

It starts a loopback-only broker with an ephemeral actor token, creates a
tool-free SDK session using the already logged-in local user, and requires the
model to return `PISA_COPILOT_OK`. No GitHub token is accepted by the broker API
or printed by the test.

Commands for Pi and AKS experiments will be added only after they are proven.

## Local broker

`packages/copilot-broker` provides:

- actor-token authentication with only token digests retained;
- actor/session ownership enforcement;
- bounded JSON bodies, messages, concurrency, and request duration;
- a deterministic fake backend for tests;
- a GitHub Copilot SDK backend with no available tools or session store;
- generic external errors that do not echo prompts, tokens, or backend details.

The standalone CLI binds only to loopback and requires local environment
variables:

```bash
PISA_ACTOR_ID=local-actor \
PISA_BROKER_TOKEN='<ephemeral-token-at-least-32-characters>' \
npx tsx packages/copilot-broker/src/cli.ts
```

Do not persist the token in this repository.

## Local Pi actor

`packages/pi-actor` wraps Pi's `createAgentSession()` with in-memory session and
settings stores, disabled resource discovery, and four constrained tools:

- `workspace_read`
- `workspace_edit`
- `workspace_write`
- `workspace_test`

The actor receives an ephemeral actor-scoped broker token, never a GitHub or
Copilot credential. Filesystem operations reject `.git`, traversal, and
canonical symlink escapes. Test execution uses exact command allowlisting and
`spawn()` without a shell. The deterministic integration proof copies a broken
calculator fixture, edits only `math.js`, runs `npm test`, and verifies an
out-of-workspace read is blocked:

```bash
node --import tsx --test tests/integration/pi-actor.test.ts
```

The real end-to-end smoke consumes Copilot model requests and operates only on
the repository-owned disposable fixture:

```bash
npm run smoke:pi-copilot
```

It must print exactly `PISA_PI_COPILOT_OK`. The actor receives only an ephemeral
broker token; the SDK resolves the existing logged-in user inside the trusted
local broker.

## Trusted source transport

`packages/orchestrator` moves a committed snapshot across the actor boundary
without GitHub credentials or local mounts:

1. resolve an exact local commit and reject links, submodules, credential-like
   paths, and credential-like content;
2. create a bounded `git archive` tar with a SHA-256 file manifest;
3. parse and materialize regular files into a new private actor workspace;
4. initialize credential-free actor-local Git metadata;
5. export a bounded full-index binary patch after scanning actor output;
6. apply the patch first to a disposable validation repository;
7. reject path/manifest changes, links, unsupported modes, credentials, and
   protected policy edits unless the trusted caller explicitly opts in;
8. stage the validated patch in the clean trusted repository for local commit.

The local roundtrip—including a fake-backed Pi edit/test task and trusted local
commit—is reproducible with:

```bash
npm run smoke:transport:local
```
