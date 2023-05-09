# For testing purposes only!

SHELL=bash

image=directus-test
version=$(shell git rev-parse HEAD)
tag=latest

.PHONY: build-image test-image

build-image:
	pnpm install
	NODE_OPTIONS=--max_old_space_size=8192 pnpm -r build
	node pack.js
	cp $$HOME/.npmrc ../dist
	docker build --no-cache \
		--build-arg VERSION=$(version) \
		-t $(image):$(version) \
		-f ./Dockerfile \
		..
	docker tag $(image):$(version) $(image):$(tag)

build-final-image:
	docker build --build-arg VERSION=$(version) -t docker.etisoftware.com/directus:9.23.0-eti -f ./Dockerfile.extensions ..

# To override or pass additional arguments:
# DOCKER_ARGS='-p 8051:8055 -e LOG_STYLE=raw' make test-image
test-image:
	ARGS=($$DOCKER_ARGS); docker run \
		--rm \
		--dns 10.1.2.28 \
		-t \
		-p 8055:8055 \
		-e "KEY=$$(uuidgen | tr '[:upper:]' '[:lower:]')" \
		-e "SECRET=$$(uuidgen | tr '[:upper:]' '[:lower:]')" \
		"$${ARGS[@]}" \
		$(image):$(tag)

enter-image:
	ARGS=($$DOCKER_ARGS); docker run \
		--rm \
		-it \
		"$${ARGS[@]}" \
		$(image):$(tag) \
		/bin/sh
