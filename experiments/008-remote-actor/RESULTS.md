# Remote Pi actor on AKS Kata

## Result

**PASS.** A digest-pinned, credential-free Pi actor ran under
`kata-vm-isolation`, received a committed calculator snapshot as a bounded
manifest archive, used the trusted local Copilot login through the private
relay/bridge path, edited only `math.js`, ran `workspace_test` successfully,
and returned a full-index binary patch. The trusted workstation replayed the
patch in a disposable repository, ran `npm test` in a no-network container
with a read-only source mount, and committed only the prevalidated index
locally.

Disconnecting the trusted bridge prevented model completion. Pi returned no
successful test event, so the remote acceptance gate returned
`422 actor_acceptance_failed` and exported no patch.

## Pinned artifact

```text
pisasubstrate84acr.azurecr.io/pisa-harness@sha256:e165adfda8b91490fa4b7339541d4e5bfca52448d4d3a00fd3a86cd6d4d7b326
```

## Security properties

- The actor received no GitHub, Copilot, Azure, kubeconfig, registry, or
  workstation credential.
- Kubernetes service-account token automount was disabled.
- The actor ran non-root with a read-only root filesystem, dropped
  capabilities, no privilege escalation, no host mount, and an ephemeral
  workspace.
- Both actor and relay Services were `ClusterIP`.
- Actor ingress was limited to the relay; actor egress was limited to relay and
  DNS. Relay egress was limited to actor and DNS.
- Actor-model, tunnel, trusted-job-client, relay-to-actor delivery, and
  local-broker capabilities were separate. The actor held only the SHA-256
  verifier for the delivery bearer.
- The trusted bridge accepted only loopback relay and broker endpoints.
- The relay failed closed without the trusted bridge.
- A patch was exportable only after a successful actor-side
  `workspace_test` and an independent replay/test of the exact final patch.
  The actor pod exited after the job. Trusted replay tests ran again in a
  no-network, read-only-mount container before local commit.

## Failed experiments and corrections

1. The first apply immediately restarted the new deployment, creating two Kata
   sandboxes on the one-node pool. Both timed out before image pull.
   Deployments now use `Recreate` and a pod-template revision, so a singleton
   actor is never surged.
2. A single actor still timed out, and the previously known-good Kata probe
   also failed. The Kata node had become wedged after prior host-device
   diagnostics. Scaling only the disposable `sandbox` pool from one to zero
   and back to one restored the runtime; the exact probe passed again.
3. Direct `kubectl port-forward` to the healthy Kata pod returned an empty
   response. Kubelet reported connection refusal to guest service loopback.
   Job traffic now enters through the runc relay port-forward and reaches the
   actor over the ClusterIP network.
4. Model attempts that stopped before tests passed were initially visible only
   to the smoke assertion. The remote server now refuses to export a patch
   unless the event trace contains a successful `workspace_test`, then replays
   and retests the exact final patch in a fresh actor workspace; the trusted
   caller may retry at most three fresh sessions.
5. A trusted-side npm HOME was initially placed inside the disposable
   repository and made it dirty. Trusted commands now use a separate
   credential-free HOME and npm cache outside the repository.
6. Kubernetes server-side apply retained an obsolete raw `job-token` data key
   after the actor moved to a verifier-only Secret. Capability rotation now
   stops both deployments and deletes/recreates the POC Secrets before
   deployment. The live actor Secret contains only `actor-token` and
   `actor-job-token-sha256`.

## Reproduce

```bash
make aks-verify
make aks-harness-image
npm run smoke:remote-actor
```

Expected final marker:

```text
PISA_REMOTE_ACTOR_OK
```

Sanitized evidence is in `evidence/remote-actor/remote-smoke.txt`.
