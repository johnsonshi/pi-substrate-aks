# Security

## Trust boundary

The operator workspace, reviewed project code, and local GitHub Copilot CLI are
trusted. Repository content, model output, actor processes, actor filesystems,
package output, upstream documentation, and remote workloads are untrusted.

## Invariants

1. Copilot, GitHub, Azure, SSH, and kubeconfig credentials remain on the trusted
   local machine.
2. Actors receive source snapshots without repository credentials and return
   patches for local validation.
3. Actor tools are constrained in code and by the runtime; prompt instructions
   are not a security boundary.
4. Actor workloads have no service-account token, host namespace, host path,
   privileged mode, or unrestricted egress.
5. Broker requests are authenticated per actor, bounded, rate limited, and
   fail closed.
6. All Azure changes are restricted to `rg-pi-substrate-aks` and `pisa-*`
   resources where practical.

## Source boundary

Actors receive a bounded committed `git archive`, never the trusted repository,
its history, `.git`, or a filesystem mount. Source and returned changes reject
symlinks, submodules, unsupported Git modes, traversal, credential-like paths,
and credential-like content. Returned full-index binary patches are applied to
a disposable validation repository before being staged in a clean trusted
repository. Safety-policy changes require an explicit trusted-call override.

## Prohibited data

Never commit or capture token values, credential files, kubeconfig contents,
subscription or tenant identifiers, private keys, Keychain contents, or full
environment dumps. Evidence must record only sanitized metadata and conclusions.

## Dependency posture

Pi is pinned to the patched `@earendil-works/pi-*` `0.84.2` package family.
Dependency installation disables lifecycle scripts. The deprecated
`@mariozechner/pi-coding-agent` `0.73.1` line is prohibited because its known
extension-path, auth-file, and HTML-export advisories have no patched release
under the old package name.

## Reporting

This is a private experimental repository. Record discovered vulnerabilities in
the private repository without including live secrets.
