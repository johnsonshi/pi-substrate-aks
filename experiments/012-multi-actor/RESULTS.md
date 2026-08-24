# Two concurrent Pi actors on AKS Kata

## Result

**PASS** for two credential-free Pi actors running concurrently under
`kata-vm-isolation`.

**PASS** for implementer/reviewer-test role separation, actor-keyed relay
routing, independent actor-side test gates, trusted patch merge, and
actor-to-actor network denial.

## Topology

One trusted local Copilot broker and one trusted WebSocket bridge multiplexed
two actor identities:

- `remote-implementer`;
- `remote-reviewer`.

The relay held a configured cluster-local URL and a distinct delivery
capability for each actor. The trusted caller selected only a configured actor
ID through `/v1/actor/:actorId/run`; it could not supply a URL. Each actor had
its own Deployment, ClusterIP Service, model capability, delivery-capability
verifier, Kata workspace, and one-job process lifetime.

The actors received the same committed calculator archive. The implementer
added `multiply.js` and `multiply.test.js`. The reviewer/tester inspected the
existing addition path and added `math.review.test.js`. Both ran `npm test`
inside their own isolated workspace.

## Concurrency and merge

The relay health counter observed two active job proxies at once. Request
intervals overlapped for `19,887 ms`; both actors passed on their first attempt.

The returned patches were disjoint. The trusted orchestrator:

1. verified each archive, manifest, patch digest, source revision, and changed
   path set independently;
2. replayed each patch into a separate disposable workspace;
3. combined only the two validated patches against the original revision;
4. exported one combined binary patch;
5. replayed and tested that exact combined tree in a non-root, no-network
   container with a read-only source mount;
6. committed only the prevalidated index in a disposable trusted repository.

The final changed paths were:

```text
math.review.test.js
multiply.js
multiply.test.js
```

## Isolation

- both actor pods used `kata-vm-isolation`;
- both disabled service-account token automount;
- all Services remained `ClusterIP`;
- Cilium allowed actor ingress only from the relay and actor egress only to
  the relay and DNS;
- a valid Cilium deny rule blocked host, remote-node, and kube-apiserver
  entities;
- direct TCP from either actor to the other actor Service was blocked;
- an actor model capability could not authorize the trusted job route;
- unknown actor job routes returned `404` without accepting caller-provided
  destinations;
- actor Secrets contained only the actor model capability and the SHA-256
  delivery verifier;
- no GitHub, Copilot, Azure, kubeconfig, registry, SSH, or workstation
  credential entered either actor.

Both Kata guests ran concurrently on the existing single `sandbox` node, so no
node-pool scale-up was required.

## Operational finding

The first successful smoke printed `PISA_MULTI_ACTOR_OK` but its trusted local
process remained alive during cleanup. WebSocket close previously waited
without a deadline, and smoke cleanup had no final bound. `TrustedBridge.close`
now terminates a non-closing socket after five seconds; the smoke bounds bridge
and broker cleanup, force-kills unreaped port-forward processes after a grace
period, and explicitly exits only after a successful run.

A focused review also found that Fetch would follow an actor target redirect.
The relay now rejects redirects, with an integration test proving that the
second destination receives no request. The concurrency regression test has a
finite deadline and always releases blocked targets during failure cleanup.

The first proof after this hardening failed closed when the implementer
exhausted the three-attempt model acceptance budget; no patch was accepted.
The task wording was made more explicit and the bounded budget increased to
five. The final rerun used one attempt per actor, printed
`PISA_MULTI_ACTOR_OK`, and exited normally. The final source-matched image is:

```text
pisasubstrate84acr.azurecr.io/pisa-harness@sha256:437eef6199f18fc3b30e4a972e38156315f0cd53e31de5c9607bbc2aa64e48c9
```

## Reproduce

```bash
make aks-harness-image
make aks-multi-actor
make security
```

## Evidence

- `evidence/multi-actor/remote-concurrency.txt`
- `evidence/multi-actor/results.json`
- `deploy/aks/multi-actor.yaml`
- `scripts/smoke-multi-actor.ts`
- `tests/integration/model-relay.test.ts`
