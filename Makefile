.PHONY: build

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

install: build
	mkdir -p ~/.omniview/plugins/kubernetes/bin && \
		mkdir -p ~/.omniview/plugins/kubernetes/assets && \
		mkdir -p ~/.omniview/plugins/kubernetes/store && \
		cp bin/plugin ~/.omniview/plugins/kubernetes/bin/ && \
		cp plugin.yaml ~/.omniview/plugins/kubernetes/ && \
	  cp -r ui/dist/assets/* ~/.omniview/plugins/kubernetes/assets/
		rm bin/plugin

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
	@for platform in $(PLATFORMS); do \
		GOOS=$${platform%/*}; \
		GOARCH=$${platform#*/}; \
		OUTDIR=./.package/bin; \
		OUTFILE=plugin; \
		MODPLATFORM=$${platform//\//_}; \
		if [ "$$GOOS" = "windows" ]; then OUTFILE=plugin.exe; fi; \
		rm -rf $$OUTDIR && mkdir -p $$OUTDIR; \
		GOEXPERIMENT=jsonv2 GOOS=$$GOOS GOARCH=$$GOARCH go build -o $$OUTDIR/$$OUTFILE ./pkg; \
		NAME=omniview-plugin-kubernetes-$(VERSION)-$$MODPLATFORM.tar.gz; \
		tar -czvf ./build/$$NAME -C .package .; \
	done

# package:
# 	mkdir -p .package
# 	rm -rf ./.package && rm -f kubernetes.tar.gz
#
# 	# Binary
# 	mkdir -p ./.package/bin && go build -o ./.package/bin/plugin ./pkg	
# 	# UI
# 	mkdir -p ./.package/assets && cd ./ui && pnpm run build && cd .. && cp -r ui/dist/assets/* ./.package/assets/
# 	# Metadata file
# 	cp plugin.yaml ./.package/ 
#
# 	# package it up
# 	tar -czvf kubernetes.tar.gz -C .package .

installui: 
	cd ui && pnpm run build
	mkdir -p ~/.omniview/plugins/kubernetes/assets
	cp -r ui/dist/assets/* ~/.omniview/plugins/kubernetes/assets/
	
storybook:
	cd ui && pnpm run storybook

storybook-build:
	cd ui && pnpm run build-storybook

# ── Kind test cluster ─────────────────────────────────────────────────

CLUSTER_NAME := omniview-test
KIND_CONFIG := hack/kind-config.yaml
SEED_DIR := hack/seed

.PHONY: cluster cluster-create cluster-seed cluster-delete cluster-reset

# Create or verify the kind cluster exists, then apply seed data
cluster: cluster-create cluster-seed

# Create kind cluster (idempotent — skips if already exists)
cluster-create:
	@if kind get clusters 2>/dev/null | grep -q "^$(CLUSTER_NAME)$$"; then \
		echo "Cluster '$(CLUSTER_NAME)' already exists"; \
	else \
		kind create cluster --name $(CLUSTER_NAME) --config $(KIND_CONFIG) --wait 60s; \
	fi
	@kubectl cluster-info --context kind-$(CLUSTER_NAME)

# Apply seed data (idempotent — kubectl apply is naturally idempotent)
cluster-seed:
	kubectl apply --context kind-$(CLUSTER_NAME) -k $(SEED_DIR)

# Tear down the kind cluster
cluster-delete:
	kind delete cluster --name $(CLUSTER_NAME)

# Reset seed data (delete and reapply)
cluster-reset:
	kubectl delete --context kind-$(CLUSTER_NAME) -k $(SEED_DIR) --ignore-not-found
	kubectl apply --context kind-$(CLUSTER_NAME) -k $(SEED_DIR)
