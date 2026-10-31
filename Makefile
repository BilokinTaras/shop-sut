# shop-sut — one-command local stand. Requires Docker with Compose v2, make, curl.
# Compatible with GNU Make 3.81 (macOS default) and newer.
SHELL := /bin/sh
COMPOSE ?= docker compose
GENERATED := .generated

.PHONY: help env build up bootstrap contract smoke down reset clean logs status ps

help: ## Show targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-10s %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

build: env ## Build backend and storefront images
	$(COMPOSE) build

up: env ## Start the stand from scratch or resume it, then write the contract file
	$(COMPOSE) up -d --build --wait --wait-timeout 600
	@$(MAKE) --no-print-directory contract

bootstrap: env ## Re-run the idempotent QA bootstrap and refresh the contract file
	$(COMPOSE) run --rm bootstrap
	@$(MAKE) --no-print-directory contract

contract: ## Copy .generated/sut.env out of the stand
	@mkdir -p $(GENERATED)
	@$(COMPOSE) run --rm --no-deps -T --entrypoint cat bootstrap /generated/sut.env > $(GENERATED)/sut.env.tmp
	@mv $(GENERATED)/sut.env.tmp $(GENERATED)/sut.env
	@echo "contract: $(GENERATED)/sut.env"

smoke: ## Run smoke checks against the running stand
	@sh scripts/smoke.sh $(GENERATED)/sut.env

down: ## Stop the stand (data is kept)
	$(COMPOSE) down

reset: env ## Wipe all data of this stand and start again from a clean state
	$(COMPOSE) down -v --remove-orphans
	rm -rf $(GENERATED)
	@$(MAKE) --no-print-directory up

clean: ## Stop the stand and delete its volumes and generated files
	$(COMPOSE) down -v --remove-orphans
	rm -rf $(GENERATED)

logs: ## Follow logs of all services
	$(COMPOSE) logs -f --tail=200

status: ## Show service status
	$(COMPOSE) ps -a

ps: status
