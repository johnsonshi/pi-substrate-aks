# Experiment 004: Trusted Source Transport

## Metadata

- Date: 2026-08-24
- Local baseline commit: `09a1fd9`
- Git: `2.50.1`
- Archive parser: `tar-stream` `3.1.7`
- Runtime: trusted macOS arm64 workstation; scratch data under `.state/`

## Question

Can a Pi actor receive one committed source snapshot and return a locally
validated, committable patch without GitHub credentials, trusted Git metadata,
history, or a host filesystem mount?

## Implementation

- `packages/orchestrator/src/source-transport.ts`
- `tests/integration/source-transport.test.ts`

The trusted side resolves one commit, rejects unsupported or credential-like
tree entries, creates `git archive` output, and records archive/file SHA-256
metadata. The actor gets only regular snapshot files and initializes a new local
baseline repository with no remote or credentials.

After actor execution, the transport scans the workspace, stages all changes,
and exports a bounded full-index binary patch. The trusted side verifies its
digest, replays it in a fresh snapshot, scans final files and Git index modes,
checks the changed-path manifest and protected policy, then stages the same
patch in a clean trusted repository.

## Command

```bash
npm run smoke:transport:local
```

## Result

**PASS**

Seven transport cases passed:

1. Repository-local transport artifacts were accepted only under the ignored
   `.state/` directory.
2. A fake-backed Pi actor read, edited, and tested the archived fixture; the
   trusted side validated and committed only `math.js`.
3. A regular binary-patch roundtrip preserved modified and added files.
4. Protected policy changes failed without an explicit override and passed only
   with the trusted override.
5. Credential-like source and actor output paths were rejected.
6. Source and actor workspace symlinks were rejected.
7. A patch modified after export failed its integrity check.

The complete project suite passed fifteen tests. The repository's real
committed tree also produced a bounded source archive, and the real
Pi/Copilot coding smoke still returned `PISA_PI_COPILOT_OK`.

## Security boundary

No Git history, trusted `.git`, repository remote, GitHub credential, or local
filesystem mount enters the actor workspace. Artifacts are size/file bounded.
Traversal, `.git`, links, submodules, unsupported modes, credential-like paths
and content, and protected policy changes fail closed.

The trusted side alone stages the validated patch and performs the final commit.

## Remaining work

- Carry the same artifacts through the private AKS relay.
- Run source materialization and patch export inside the isolated remote actor.
- Add prompt-injection and runtime network/identity security cases.
