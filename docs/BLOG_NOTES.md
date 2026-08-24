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

## Measurements to capture

- Broker first-token and total latency.
- Actor task duration and patch size.
- Concurrent actor isolation and peak resource use.
- Suspend/resume duration and state preservation.

