# Experiment 005: Pinned Agent Substrate on kind

## Metadata

- Date: 2026-08-24
- Local baseline commit: `2264a31`
- Upstream repository: `agent-substrate/substrate`
- Upstream SHA: `bc51ef2452c4bf4c0542cd6850040c9ed1033421`
- kind: `v0.32.0`
- Kubernetes: `v1.36.1`
- Runtime: local arm64 Docker kind node, gVisor workers

## Question

Can the exact pinned upstream Agent Substrate control plane, worker pool,
routing, and genuine pause/suspend lifecycle run on a dedicated local kind
cluster before AKS-specific debugging begins?

## Command

The reproducible installation and lifecycle commands are in
`deploy/substrate/README.md`. All cluster operations use the explicit
`kind-pisa-substrate` context.

## Result

**PASS**

The upstream control plane, Valkey, RustFS, telemetry, certificate controller,
atelet, three-worker counter WorkerPool, and counter ActorTemplate became
ready. No `/dev/kvm` device was visible in the kind node, so upstream selected
gVisor rather than its microVM backend.

The stock counter template declares `onPause: Full` and `onCommit: Data`:

| Step | Memory | Durable file | Interpretation |
|---|---:|---:|---|
| First request | 1 | 1 | New actor |
| Suspend, then routed resume | 1 | 2 | Data commit persisted; process cold-booted |
| Pause, explicit resume, request | 2 | 3 | Node-local full snapshot restored |

A second immutable `counter-full` ActorTemplate changed only `onCommit` to
`Full` and used a separate snapshot location:

| Step | Memory | Durable file | Interpretation |
|---|---:|---:|---|
| First request | 1 | 1 | New actor |
| Suspend, then routed resume | 2 | 2 | Full committed snapshot restored |

The full actor reached `ACTOR_STATE_SUSPENDED` before the resume request. The
second request therefore proves true suspend/resume, not a pod restart labeled
as suspension.

## Evidence

- `deploy/substrate/UPSTREAM_SHA`
- `evidence/substrate-kind/versions.txt`
- `evidence/substrate-kind/health.txt`
- `evidence/substrate-kind/lifecycle.txt`

Evidence is intentionally summarized and excludes kubeconfig, credentials,
cluster certificates, pod environment, and raw logs.

## Interpretation

Substrate snapshot scope is part of application semantics. The stock demo's
`Data` commit correctly preserves only `DurableDir`; expecting process memory
to survive that mode would be a false test. `Full` commit proves that this
pinned revision can preserve both process memory and durable data across a
worker-releasing suspend in the local gVisor topology.

This result does not prove Substrate microVMs or AKS compatibility. The local
Docker VM exposed no KVM device, and AKS Kata is a distinct isolation placement
that must not be conflated with Substrate's own microVM backend.

## Remaining work

- Provision the dedicated `rg-pi-substrate-aks` resources.
- Run the AKS runtime compatibility matrix with explicit placement evidence.
- Deploy the credential-free Pi actor and private broker relay.
- Repeat lifecycle and security acceptance tests remotely.
