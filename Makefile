.PHONY: aks-provision aks-runtime-probe-image aks-runtime-probes aks-teardown aks-verify doctor test

doctor:
	./scripts/preflight.sh

test:
	npm test

aks-provision:
	./scripts/aks-provision.sh

aks-verify:
	./scripts/aks-verify.sh

aks-runtime-probe-image:
	./scripts/build-runtime-probe.sh

aks-runtime-probes:
	./scripts/run-runtime-probes.sh

aks-teardown:
	./scripts/aks-teardown.sh
