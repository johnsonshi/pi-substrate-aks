.PHONY: doctor test

doctor:
	./scripts/preflight.sh

test:
	npm test

