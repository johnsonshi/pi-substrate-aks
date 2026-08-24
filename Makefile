.PHONY: aks-provision aks-teardown aks-verify doctor test

doctor:
	./scripts/preflight.sh

test:
	npm test

aks-provision:
	./scripts/aks-provision.sh

aks-verify:
	./scripts/aks-verify.sh

aks-teardown:
	./scripts/aks-teardown.sh
