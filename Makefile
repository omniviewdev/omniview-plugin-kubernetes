.PHONY: prepare generate build build-ui update lint install package storybook storybook-build

# Every Go subprocess uses this module, never an enclosing go.work or GOFLAGS.
override export GOWORK := off
override export GOFLAGS :=
export OMNIVIEW_DEV_CLI
STORYBOOK_PORT ?= 6006
STORYBOOK_HOST ?= 127.0.0.1

# Extract version from git tag
VERSION := $(shell git describe --tags --abbrev=0 | sed 's/^v//')
PLATFORMS := linux/amd64 windows/amd64 darwin/amd64 darwin/arm64

prepare:
	pip install openapi2jsonschema

generate:
	cd generators && go run .
	go mod tidy
	golangci-lint run --fix ./pkg/plugin/resource/register_gen.go

build:
	rm -rf bin && rm -f kubernetes.tar.gz
	mkdir bin && GOEXPERIMENT=jsonv2 go build -o bin/plugin ./pkg
	cd ui && pnpm run build

build-ui:
	cd ui && pnpm run build

update:
	go mod tidy
	
lint:
	golangci-lint run --fix

# The live host owns source validation, builds and transactional installation.
install:
	node hack/install.mjs

package:
	# Clean
	rm -rf ./.package
	mkdir -p ./.package

	# Build UI once (platform-agnostic)
	mkdir -p ./.package/assets
	cd ./ui && pnpm run build && cd ..
	cp -r ui/dist/assets/* ./.package/assets/

	# Copy metadata (shared)
	cp plugin.yaml ./.package/

	# Loop through platforms
	@set -eu; for platform in $(PLATFORMS); do \
		GOOS=$${platform%/*}; \
		GOARCH=$${platform#*/}; \
		OUTDIR=./.package/bin; \
		OUTFILE=plugin; \
		MODPLATFORM=$${GOOS}_$${GOARCH}; \
		if [ "$$GOOS" = "windows" ]; then OUTFILE=plugin.exe; fi; \
		rm -rf $$OUTDIR && mkdir -p $$OUTDIR; \
		GOEXPERIMENT=jsonv2 GOOS=$$GOOS GOARCH=$$GOARCH go build -o $$OUTDIR/$$OUTFILE ./pkg; \
		NAME=omniview-plugin-kubernetes-$(VERSION)-$$MODPLATFORM.tar.gz; \
		tar -czvf ./build/$$NAME -C .package .; \
	done


	
storybook:
	cd ui && pnpm run storybook --port "$(STORYBOOK_PORT)" --host "$(STORYBOOK_HOST)" --ci --exact-port

storybook-build:
	cd ui && pnpm run build-storybook

# ── Kind test cluster ─────────────────────────────────────────────────

CLUSTER_NAME ?= omniview-test
KIND_CONFIG ?= hack/kind-config.yaml
CLUSTER_CONFIG ?= .local/kind-config.yaml
CLUSTER_KUBECONFIG ?= $(CURDIR)/.local/kubeconfig
CLUSTER_HTTP_PORT ?= 8080
CLUSTER_HTTPS_PORT ?= 8443
SEED_DIR ?= hack/seed

.PHONY: cluster cluster-config cluster-create cluster-seed cluster-delete cluster-reset

# Create or verify the kind cluster exists, then apply seed data
cluster: cluster-create
	$(MAKE) cluster-seed

cluster-config:
	node hack/cluster-config.mjs "$(KIND_CONFIG)" "$(CLUSTER_CONFIG)" "$(CLUSTER_HTTP_PORT)" "$(CLUSTER_HTTPS_PORT)"

# The private kubeconfig avoids touching the user's current cluster/context.
cluster-create: cluster-config
	@set -eu; \
	mkdir -p "$$(dirname "$(CLUSTER_KUBECONFIG)")"; \
	if kind get clusters 2>/dev/null | grep -Fxq -- "$(CLUSTER_NAME)"; then \
		echo "Cluster '$(CLUSTER_NAME)' already exists"; \
		kind export kubeconfig --name "$(CLUSTER_NAME)" --kubeconfig "$(CLUSTER_KUBECONFIG)"; \
	else \
		kind create cluster --name "$(CLUSTER_NAME)" --config "$(CLUSTER_CONFIG)" --kubeconfig "$(CLUSTER_KUBECONFIG)" --wait 60s; \
	fi
	@kubectl --kubeconfig "$(CLUSTER_KUBECONFIG)" cluster-info --context "kind-$(CLUSTER_NAME)"

# Apply seed data (idempotent — kubectl apply is naturally idempotent)
cluster-seed:
	kubectl --kubeconfig "$(CLUSTER_KUBECONFIG)" apply --context "kind-$(CLUSTER_NAME)" -k "$(SEED_DIR)"

# Tear down the kind cluster
cluster-delete:
	kind delete cluster --name "$(CLUSTER_NAME)" --kubeconfig "$(CLUSTER_KUBECONFIG)"

# Reset seed data (delete and reapply)
cluster-reset:
	kubectl --kubeconfig "$(CLUSTER_KUBECONFIG)" delete --context "kind-$(CLUSTER_NAME)" -k "$(SEED_DIR)" --ignore-not-found
	kubectl --kubeconfig "$(CLUSTER_KUBECONFIG)" apply --context "kind-$(CLUSTER_NAME)" -k "$(SEED_DIR)"
