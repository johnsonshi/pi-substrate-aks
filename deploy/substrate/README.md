# Pinned Agent Substrate kind Baseline

This baseline runs only in the dedicated local kind cluster
`pisa-substrate`. The upstream checkout and generated binaries remain under
ignored `.work/`; only the exact upstream SHA and these instructions are
committed.

The upstream cluster bootstrap deletes and recreates the selected kind cluster.
Never omit `KIND_CLUSTER_NAME=pisa-substrate`.

## Install

From the repository root:

```bash
mkdir -p .work/upstream .work/bin
git clone https://github.com/agent-substrate/substrate \
  .work/upstream/substrate
git -C .work/upstream/substrate checkout --detach \
  "$(cat deploy/substrate/UPSTREAM_SHA)"
test "$(git -C .work/upstream/substrate rev-parse HEAD)" = \
  "$(cat deploy/substrate/UPSTREAM_SHA)"

(
  cd .work/upstream/substrate
  KIND_CLUSTER_NAME=pisa-substrate ./hack/create-kind-cluster.sh
  KIND_CLUSTER_NAME=pisa-substrate \
    ./hack/install-ate-kind.sh --deploy-ate-system
  KIND_CLUSTER_NAME=pisa-substrate \
    ./hack/install-ate-kind.sh --deploy-demo-counter
  go build -o ../../bin/kubectl-ate ./cmd/kubectl-ate
)
```

The bootstrap manages its pinned kind and ko dependencies. The observed local
Docker environment did not expose `/dev/kvm`, so upstream selected its gVisor
worker mode. This is not evidence for the Substrate microVM backend.

## Stock lifecycle proof

Create an atespace and the stock counter actor:

```bash
PATH="$PWD/.work/bin:$PATH" \
  kubectl ate --context=kind-pisa-substrate \
  create atespace pisa-demo
PATH="$PWD/.work/bin:$PATH" \
  kubectl ate --context=kind-pisa-substrate \
  create actor pisa-counter -a pisa-demo \
  --template=ate-demo-counter/counter
kubectl --context kind-pisa-substrate \
  port-forward -n ate-system svc/atenet-router 18000:80
```

In a second terminal, route requests by actor identity:

```bash
curl --fail --silent --show-error -X POST \
  -H 'Host: pisa-counter.pisa-demo.actors.resources.substrate.ate.dev' \
  http://127.0.0.1:18000/
PATH="$PWD/.work/bin:$PATH" \
  kubectl ate --context=kind-pisa-substrate \
  suspend actor pisa-counter -a pisa-demo
curl --fail --silent --show-error -X POST \
  -H 'Host: pisa-counter.pisa-demo.actors.resources.substrate.ate.dev' \
  http://127.0.0.1:18000/
```

The stock template declares `onPause: Full` and `onCommit: Data`. A suspend
therefore preserves `DurableDir` while deliberately cold-booting process
memory. A pause/resume preserves both.

## Full suspend/resume proof

Create a separate immutable template with a distinct snapshot location:

```bash
kubectl --context kind-pisa-substrate \
  get actortemplate counter -n ate-demo-counter -o json |
  jq '{
    apiVersion,
    kind,
    metadata: {
      name: "counter-full",
      namespace: .metadata.namespace
    },
    spec: (
      .spec
      | .snapshotsConfig.onCommit = "Full"
      | .snapshotsConfig.location =
          "gs://ate-snapshots/ate-demo-counter-full/"
    )
  }' |
  kubectl --context kind-pisa-substrate apply -f -

kubectl --context kind-pisa-substrate wait \
  --for=condition=Ready \
  actortemplate/counter-full \
  -n ate-demo-counter \
  --timeout=300s

PATH="$PWD/.work/bin:$PATH" \
  kubectl ate --context=kind-pisa-substrate \
  create actor pisa-counter-full -a pisa-demo \
  --template=ate-demo-counter/counter-full
```

The first routed request must report memory/file counters `1/1`. After
`suspend actor pisa-counter-full`, the next routed request implicitly resumes
the actor and must report `2/2`. The sanitized observed values are in
`evidence/substrate-kind/lifecycle.txt`.

## Local teardown

This removes only the dedicated local kind cluster and its bootstrap registry:

```bash
(
  cd .work/upstream/substrate
  KIND_CLUSTER_NAME=pisa-substrate ./hack/delete-kind-cluster.sh
)
```
