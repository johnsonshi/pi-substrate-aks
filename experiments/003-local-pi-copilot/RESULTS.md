# Experiment 003: Local Pi and Copilot

## Metadata

- Date: 2026-08-24
- Local baseline commit: `6bd8c23`
- Pi SDK packages: `0.73.1`
- Copilot SDK: `1.0.11`
- Copilot CLI: `1.0.81-3`
- Node.js: `v24.19.0`
- Runtime: trusted macOS arm64 workstation with a disposable fixture workspace

## Question

Can a Pi actor complete a real coding task using the already authenticated local
Copilot runtime without receiving a GitHub/Copilot credential?

## Command

```bash
npm run smoke:pi-copilot
```

## Flow

1. Copy the repository-owned broken calculator fixture to a temporary workspace.
2. Start a loopback broker with the real Copilot SDK backend and an ephemeral
   actor-scoped token.
3. Create a constrained Pi session.
4. Ask the real model to inspect `math.js`, fix the addition function, and run
   `npm test`.
5. Assert the source fix, exact changed-file set, successful test tool event,
   and final assistant response.
6. Close the SDK session and remove the temporary workspace.

## Result

**PASS**

The command printed exactly:

```text
PISA_PI_COPILOT_OK
```

The model drove structured read, edit, and test calls. The fixture test passed,
and `math.js` was the only changed file.

## Credential boundary

The actor received one random actor-scoped broker token. It received no
GitHub/Copilot token, credential file, SDK session data, Azure identity,
kubeconfig, or host filesystem mount. The trusted broker used
`useLoggedInUser: true`; no explicit GitHub token was passed.

The evidence captures only the exact success marker and assertions, not model
transcripts, tool output, or authentication material.

## Remaining work

- Validate archive-in and patch-out source transport.
- Place the actor behind process, network, and kernel isolation.
- Insert the credential-free relay and prove the same task from AKS.

## Follow-up

The exact smoke passed again after migrating to the patched
`@earendil-works/pi-*` `0.84.2` package family.
