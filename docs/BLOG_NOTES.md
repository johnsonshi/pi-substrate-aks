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
- The real Copilot SDK preserved one model turn across deferred tool handlers:
  Pi executed read, edit, and test calls in the disposable actor workspace,
  returned structured results, and received a final assistant response.
- A narrow proof marker is useful evidence: the smoke prints only
  `PISA_PI_COPILOT_OK`, not model text, session details, tool output, or
  authentication material.
- Security advisories arrived after the first Pi proof. The deprecated package
  namespace had no patched release, so the harness migrated as a family to
  `@earendil-works/pi-*` `0.84.2`; fake and real coding loops still passed, and
  the production dependency audit returned zero findings.
- Git bundles are convenient but can expose reachable history, including
  sensitive data deleted from the current tree. A one-commit `git archive`
  provides a narrower source boundary; actor-local Git can still produce a
  full-index binary patch.
- Patch validation is stronger when it reconstructs the resulting filesystem.
  The transport replays untrusted output in a disposable repository, checks
  paths, modes, links, credentials, and protected files, then stages the same
  patch in the clean trusted repository.
- The default Substrate counter demo contains a useful lifecycle lesson:
  `onPause: Full` but `onCommit: Data`. Pause/resume preserves process memory;
  suspend/resume preserves its durable directory but intentionally cold-boots
  the process. A separate immutable `onCommit: Full` template preserved both
  counters across a true suspend.
- The first lifecycle assertion expected memory continuity from a `Data`
  snapshot and was wrong. Reading the template contract before interpreting the
  counter values changed the experiment from an apparent failure into a precise
  distinction between durable state and full process state.
- The Apple-silicon Docker kind node exposed no `/dev/kvm`, so upstream selected
  gVisor. That is a clean local baseline, not evidence that Substrate microVMs
  work on AKS or that AKS Kata is the same placement.
- A minimal AKS Standard cluster can keep the matrix explicit without becoming
  large: one small system node plus one Azure Linux `KataVmIsolation` node.
  Azure CNI overlay with Cilium avoids custom subnet IAM while preserving a
  network-policy enforcement path.
- Provisioning-state races matter in reproducibility scripts. The first verify
  saw the cluster and both pools in `Updating` immediately after node-pool
  creation; adding an explicit Azure wait made the idempotent path accurate
  instead of treating eventual consistency as failure.
- The dedicated ACR uses managed pull and has admin authentication disabled, so
  image distribution does not require a registry password in the actor.
- AKS Kata has a concrete minimum memory floor: the first `64Mi` diagnostic pod
  failed before sandbox creation and reported a `128Mi` minimum. Treat runtime
  overhead as part of actor capacity planning, not an incidental limit.
- The same static scratch probe made runc-versus-Kata evidence easy to compare.
  The kernels differed, while both had no service-account token, credential
  variable names, KVM, host paths, Kubernetes API, IMDS, or public egress.
- A nested-virtualization-capable VM size does not guarantee a Linux KVM device.
  On this Azure Linux sandbox node, `/dev/kvm` failed character-device
  validation; a privileged runc mount reported KVM API version `0`, and the
  equivalent Kata placement could not create its sandbox.
- A locally configured buildx default can silently target an unrelated
  Kubernetes builder. Selecting a dedicated docker-container builder by name
  kept image building local and avoided modifying cluster build resources.
- A failed Kata sandbox experiment can leave a one-node pool unable to start
  even the previously known-good probe. Rechecking the smallest accepted probe
  distinguished runtime damage from application failure; recycling only the
  disposable Kata user pool restored it.
- Kubernetes port-forwarding is not transparent across every sandbox network
  model. The healthy Kata actor answered readiness on its pod IP, while kubelet
  could not connect to the guest service through pod-netns loopback. Routing
  jobs through a tiny runc relay preserved ClusterIP-only exposure.
- Separate actor-model, bridge, trusted-job, actor-delivery, and local-broker
  capabilities make the trust handoff inspectable. The actor gets only the
  delivery token's one-way verifier. The cluster receives no Copilot
  credential, and closing one local WebSocket immediately removes model
  access.
- "The patch applies and tests locally" is weaker than "the actor tested its
  own change." A server-side acceptance gate now exports no patch unless the
  Pi trace includes a successful test tool result; local replay remains a
  second independent gate.
- Trusted orchestration needs workspace hygiene too. Pointing npm HOME inside
  the disposable repository created an unrelated untracked directory; a
  separate credential-free HOME keeps the trusted commit exact.
- "Trusted replay" must not mean executing model-authored code under a
  credentialed desktop account. Run the returned tree in a no-network
  container with no host credential mount, and commit only the separately
  validated Git index.
- Applying a Kubernetes Secret is not key revocation: merge semantics can keep
  omitted data keys. Stop the old capability holders, delete/recreate the
  disposable Secret, then start workloads with the new key set.
- A managed Kubernetes version number does not prove that every upstream beta
  API is enabled. The pinned Substrate identity plane needed
  PodCertificateRequest and ClusterTrustBundle; AKS exposed neither and pruned
  their projected-volume fields. A server-side dry-run gate avoided a partial
  cluster-wide install.
- Compatibility and security can fail independently. Even with the certificate
  APIs, the upstream gVisor worker's host path, mount propagation, AppArmor
  unconfined, and broad capabilities would need a separate trust decision; it
  is not the same boundary as a restricted Kata actor.
- Prompt-injection tests should make the model malicious on purpose. A
  cooperative refusal proves prompt behavior; an adversarial fake model that
  requests outside reads/writes and destructive commands proves enforcement.
- Security evidence should avoid becoming a credential collection mechanism.
  The live acceptance probe records only environment names, Secret key names,
  path booleans, placement, and connectivity outcomes—never values.
- Resolve annotated release tags instead of trusting example permalinks. The
  Agent Sandbox `v0.5.6` tag resolved to a different commit than an initial
  research handoff reported, while the release-manifest digest stayed the
  executable pin.
- "Suspend/resume" needs a state taxonomy. Agent Sandbox released the Kata
  worker and restored its PVC into a new process; that is workspace continuity,
  not memory or Pi-session continuity.
- A secure actor controller may still be highly trusted infrastructure. Agent
  Sandbox `v0.5.6` watches cluster-wide and needs Kubernetes API credentials;
  hardening its pod does not reduce its RBAC blast radius.
- Adversarial tests need isolated adversarial artifacts too. A fixed canary
  filename made two otherwise independent test processes race; deriving the
  filename from each unique workspace restored safe parallel execution.
- One local model credential can safely serve concurrent remote actors without
  becoming a cluster credential. Multiplex identity over one authenticated
  bridge, keep per-actor delivery capabilities and workspaces distinct, and
  never accept a caller-provided target URL.
- Parallel patches need a final-tree gate. Independently validate each patch,
  combine only disjoint changes in a fresh baseline, re-export the combined
  patch, and test that exact tree before a trusted commit.
- The one-node `Standard_D4s_v3` Kata pool ran two actor guests concurrently;
  the relay measured `19,887 ms` of request overlap. Capacity was sufficient
  for the POC without adding a node.
- Successful experiments can still expose harness defects after the marker is
  printed. An unbounded WebSocket cleanup kept the local process alive; bounded
  termination made completion itself reproducible, and the hardened rerun
  exited normally.
- A fixed target URL is insufficient if the HTTP client follows redirects.
  Rejecting downstream redirects keeps the actor from selecting a second
  destination for the trusted archive body.
- Standard NetworkPolicy has node-traffic exceptions. A Cilium entity deny for
  host, remote-node, and kube-apiserver closes that gap while retaining only
  relay and DNS egress.

## Measurements to capture

- Broker first-token and total latency.
- Actor task duration and patch size.
- Concurrent actor isolation and peak resource use.
- Suspend/resume duration and state preservation.
- Data-only versus full-snapshot size and restore latency.

## Evidence worth preserving

- A real broker request returning one exact marker while the client only knows
  an actor-scoped ephemeral token.
- Negative tests showing actor A cannot use actor B's session and oversized
  input is rejected without being echoed.

## Showcase framing

- The strongest headline is not "Pi runs on AKS." It is "remote coding compute
  does not need to become a credentialed developer workstation."
- Tell the story through two lenses. The individual keeps login, review, and
  source-control authority locally. The organization gets disposable workers,
  narrow actor identity, enforced network/runtime boundaries, and a final
  patch-acceptance gate.
- Be explicit that the actor can consume the user's Copilot entitlement while
  the bridge is connected, but never receives a GitHub-issued or Copilot token.
  The custom relay capability delegates one application action, not the user's
  external identity.
- The two-actor result demonstrates composition, not scale: one implementer,
  one reviewer/tester, isolated workspaces and capabilities, `19,887 ms` of
  measured overlap, and one trusted final-tree gate.
- The blocked Agent Substrate result strengthens the article. It shows why
  runtime names and lifecycle claims matter: local kind proved Substrate
  semantics, direct Kata proved AKS execution, and Agent Sandbox proved only
  workspace continuity on AKS.
- Keep the "cannot" table prominent. A credible agent-platform story includes
  missing production controls, cold process restart, narrow workload support,
  controller RBAC, denied public egress, and the absence of fleet-scale proof.
