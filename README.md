# Pi Substrate AKS

Private proof of concept for running credential-free Pi coding actors on isolated
AKS workloads while keeping GitHub Copilot authentication on a trusted local
machine.

The implementation is in progress. See [STATUS.md](STATUS.md) for verified
capabilities, [DESIGN.md](DESIGN.md) for the authoritative design, and
[docs/LAB_NOTES.md](docs/LAB_NOTES.md) for the append-only experiment record.

## Security boundary

- Remote actors never receive GitHub, Copilot, Azure, SSH, or kubeconfig
  credentials.
- GitHub and Azure writes run only from the trusted local workspace.
- Model requests cross an authenticated relay to the local Copilot broker; raw
  credentials never cross the broker API.
- Azure resources are limited to `rg-pi-substrate-aks`.

## Bootstrap

```bash
./scripts/preflight.sh
npm ci
npm test
```

Commands for local and AKS experiments will be added only after they are proven.

