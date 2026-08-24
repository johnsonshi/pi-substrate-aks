package main

import (
	"reflect"
	"testing"
)

func TestCredentialEnvironmentNames(t *testing.T) {
	t.Parallel()

	environment := []string{
		"PATH=/usr/bin",
		"GITHUB_TOKEN=redacted-test-value",
		"AZURE_CLIENT_ID=redacted-test-value",
		"PISA_ACTOR_ID=actor-a",
		"GH_TOKEN=redacted-test-value",
	}

	want := []string{"AZURE_CLIENT_ID", "GH_TOKEN", "GITHUB_TOKEN"}
	if got := credentialEnvironmentNames(environment); !reflect.DeepEqual(got, want) {
		t.Fatalf("credential names = %v, want %v", got, want)
	}
}

func TestCredentialEnvironmentNamesReturnsEmptyForActorMetadata(t *testing.T) {
	t.Parallel()

	environment := []string{
		"PATH=/usr/bin",
		"PISA_ACTOR_ID=actor-a",
		"HOME=/workspace",
	}

	if got := credentialEnvironmentNames(environment); len(got) != 0 {
		t.Fatalf("unexpected credential names: %v", got)
	}
}
