# Blog Notes

These notes contain only material suitable for later public review. They exclude
credentials, tenant/subscription identifiers, and proprietary information.

## Problem framing

Coding agents need durable workspaces and strong isolation, but model
authentication is often tied to a trusted developer machine. The experiment
asks whether those concerns can be separated: untrusted execution on AKS,
durable actor lifecycle through Agent Substrate, and authenticated Copilot model
access that never leaves the local machine.

## Narrative threads

- A pod running an agent is not the same as a durable isolated actor.
- Two Kata placements may look similar but have different control boundaries:
  Substrate-managed micro-VMs versus an AKS Kata RuntimeClass around a worker
  pod.
- A local outbound broker tunnel can make credential revocation immediate
  without placing a GitHub token in Kubernetes.
- Failed runtime combinations are useful architecture results when captured with
  exact evidence.

## Early observations

- The trusted workstation already has the main CLIs and authenticated contexts.
- `kind` is the first missing local prerequisite and should be installed
  user-locally rather than system-wide.
- The official Copilot SDK can resolve the existing logged-in user without a
  token parameter. A broker session can expose an empty tool set, turning the
  local runtime into a narrow text-generation boundary.
- Empty-mode SDK clients require an explicit session filesystem or base
  directory. Using the normal local CLI mode preserves existing authentication;
  explicit `availableTools: []` and a replaced system message provide the
  tool-free boundary for this POC.
- A package-feed proxy can return remote tarball URLs while npm remote fetching
  is disabled. An invocation-scoped `--allow-remote=all` plus
  `--ignore-scripts` was enough without changing global configuration.
- Plain assistant text is not a safe tool protocol. Pi expects structured tool
  calls, so the broker now declares only actor tools while their SDK handlers
  wait for execution results from the isolated actor.
- Keeping tool execution actor-side makes the trust split concrete: the local
  broker can use authenticated Copilot without gaining a model-driven path to
  local files or commands.
- macOS temporary paths exposed a useful canonicalization edge case:
  `/var/...` may resolve to `/private/var/...`. Accepting either lexical root
  alias before enforcing the final canonical-root check avoids false denials
  without allowing symlink escape.

## Measurements to capture

- Broker first-token and total latency.
- Actor task duration and patch size.
- Concurrent actor isolation and peak resource use.
- Suspend/resume duration and state preservation.

## Evidence worth preserving

- A real broker request returning one exact marker while the client only knows
  an actor-scoped ephemeral token.
- Negative tests showing actor A cannot use actor B's session and oversized
  input is rejected without being echoed.
