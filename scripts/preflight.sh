#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' '== workspace =='
pwd
printf '%s\n' '== git =='
git --version
printf '%s\n' '== github auth =='
gh auth status
printf '%s\n' '== copilot =='
copilot --version
printf '%s\n' '== azure cli =='
az version --query '"azure-cli"' -o tsv
printf '%s\n' '== azure account (non-sensitive) =='
az account show --query '{name:name,state:state,isDefault:isDefault}' -o json
printf '%s\n' '== kubectl =='
kubectl version --client -o yaml | grep -E 'gitVersion|platform'
printf '%s\n' '== docker =='
docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
printf '%s\n' '== node/npm/go =='
node --version
npm --version
go version
printf '%s\n' '== optional tools =='
command -v kind >/dev/null && kind version || printf '%s\n' 'kind: unavailable'
command -v helm >/dev/null && helm version --short || printf '%s\n' 'helm: unavailable'

