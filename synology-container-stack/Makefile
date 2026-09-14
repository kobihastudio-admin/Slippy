# Single front door for this stack — `make <target>` instead of remembering
# rsync/ssh/docker-compose invocations. Defaults point at the NAS this stack
# is currently set up for (192.168.1.200); override per-invocation, e.g.:
#   make deploy NAS_SSH=admin@192.168.1.50

NAS_SSH  ?= admin@192.168.1.200
NAS_PATH ?= /volume1/docker/slippy
NAS_HOST ?= 192.168.1.200

.PHONY: up down build restart logs ps deploy smoke-test smoke-test-full env

## Local (Mac) — same containers, useful for a quick check before deploying
up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build

restart:
	docker compose restart web api

logs:
	docker compose logs -f web api

ps:
	docker compose ps

## NAS — one-shot deploy: rsync + remote build/up + wait for health
deploy:
	NAS_SSH="$(NAS_SSH)" NAS_PATH="$(NAS_PATH)" NAS_HOST="$(NAS_HOST)" sh scripts/deploy.sh

## LAN-only checks — run this BEFORE touching the Cloudflare Tunnel
smoke-test:
	NAS_HOST="$(NAS_HOST)" sh scripts/smoke-test.sh

## Same, but also SSHes in to check internal web→api networking + container
## restart loops — needs NAS_SSH (passwordless SSH key set up to the NAS)
smoke-test-full:
	NAS_HOST="$(NAS_HOST)" NAS_SSH="$(NAS_SSH)" NAS_PATH="$(NAS_PATH)" sh scripts/smoke-test.sh

## First-time setup — copies the three env templates if they don't exist yet
env:
	[ -f .env ]     || cp .env.example .env
	[ -f web.env ]  || cp web.env.example web.env
	[ -f api.env ]  || cp api.env.example api.env
	@echo "Now edit .env, web.env, api.env with real values before running 'make deploy'."
