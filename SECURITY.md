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

## Prohibited data

Never commit or capture token values, credential files, kubeconfig contents,
subscription or tenant identifiers, private keys, Keychain contents, or full
environment dumps. Evidence must record only sanitized metadata and conclusions.

## Reporting

This is a private experimental repository. Record discovered vulnerabilities in
the private repository without including live secrets.

