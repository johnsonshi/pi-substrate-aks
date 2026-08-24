.PHONY: aks-harness-image aks-provision aks-runtime-probe-image aks-runtime-probes aks-substrate-preflight aks-teardown aks-verify doctor security test

doctor:
	./scripts/preflight.sh

test:
	npm test

security:
	./scripts/security-acceptance.sh

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

aks-teardown:
	./scripts/aks-teardown.sh
