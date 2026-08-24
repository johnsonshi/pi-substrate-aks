.PHONY: aks-agent-sandbox aks-agent-sandbox-install aks-agent-sandbox-teardown aks-harness-image aks-multi-actor aks-provision aks-runtime-probe-image aks-runtime-probes aks-substrate-preflight aks-teardown aks-verify doctor security test

doctor:
	./scripts/preflight.sh

test:
	npm test

security:
	./scripts/security-acceptance.sh

aks-agent-sandbox-install:
	./scripts/install-agent-sandbox.sh

aks-agent-sandbox:
	./scripts/experiment-agent-sandbox.sh

aks-agent-sandbox-teardown:
	./scripts/teardown-agent-sandbox.sh

aks-provision:
	./scripts/aks-provision.sh

aks-verify:
	./scripts/aks-verify.sh

aks-runtime-probe-image:
	./scripts/build-runtime-probe.sh

aks-runtime-probes:
	./scripts/run-runtime-probes.sh

aks-substrate-preflight:
	./scripts/probe-substrate-aks.sh

aks-harness-image:
	./scripts/build-harness-image.sh

aks-multi-actor:
	npm run smoke:multi-actor

aks-teardown:
	./scripts/aks-teardown.sh
