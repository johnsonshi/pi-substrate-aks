# Pi Substrate AKS

Private proof of concept for running credential-free Pi coding actors on isolated
AKS workloads while keeping GitHub Copilot authentication on a trusted local
machine.

The local credential broker is implemented and proven against the authenticated
GitHub Copilot SDK. Remote actor and AKS work remains in progress. See
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
