# shop-sut · Medusa commerce stand for test automation

A realistic, deterministic system under test that starts with one command: Medusa v2 (backend, admin,
Store and Admin REST APIs), the official Next.js storefront, PostgreSQL and Redis in Docker, plus seeded
QA data and a generated contract file that test projects read their settings from.

![Medusa](https://img.shields.io/badge/Medusa-2.22.2-blue) ![Docker Compose](https://img.shields.io/badge/Docker%20Compose-v2-informational) ![License: MIT](https://img.shields.io/badge/license-MIT-green)

## In 30 seconds

- `make up` builds and starts the stand, waits for every healthcheck and writes `.generated/sut.env`.
- From an empty database to a passing smoke check in **41 s** (`make reset && make smoke`, cached images, 2026-10-31).
- Bootstrap is idempotent: run twice in a row, it creates nothing new (verified 2026-10-31).
- Production run mode (`medusa start`, `next start`, Redis-backed modules) for stable timings.
- Used by three test projects: Playwright UI + API, pytest API, and k6 performance tests.

## Live reports

Not published yet — this repository has no CI until it is pushed to GitHub (see Roadmap).

## Architecture

```mermaid
flowchart LR
  tests([tests on the host]) -->|127.0.0.1:9000| medusa
  browser([browser]) -->|127.0.0.1:8000| storefront
  subgraph qa-shop-net
    subgraph shared network namespace
      medusa[Medusa backend + admin]
      storefront[Next.js storefront]
    end
    medusa --> pg[(PostgreSQL)]
    medusa --> redis[(Redis)]
    migrate[[migrate]] --> pg
    bootstrap[[bootstrap]] --> pg
  end
```

Start-up order, ports and images: [docs/architecture.md](docs/architecture.md).

## Stack

| Tool | Why |
|---|---|
| Medusa 2.22.2 via `medusajs/dtc-starter` (pinned commit) | Real open-source commerce product with REST APIs, promotions, taxes, regions; MIT ([ADR-001](docs/adr/ADR-001-medusa-as-sut.md)) |
| Next.js 16 storefront from the same starter | The official UI for Medusa; ships `data-testid` attributes |
| PostgreSQL 17.11, Redis 7.4.12 | Medusa's production data store and infrastructure modules |
| Docker Compose v2 with healthchecks and `depends_on` conditions | One command, strict start-up order, no sleeps |
| GNU Make + POSIX `sh` + `curl` | Same commands on macOS, Linux and Git Bash on Windows |

## Quick start

Prerequisites: Docker Desktop or Docker Engine with Compose v2 (≥ 8 GB memory for Docker), GNU Make, curl.
On macOS: `brew install --cask docker` (make and curl ship with the Xcode command line tools).

```bash
git clone <this repository> shop-sut && cd shop-sut
make up        # first run builds the images (192 s on the reference machine), later runs under a minute
make smoke     # 5 checks: health, catalog with key, no key → 4xx, admin login, storefront page
```

Open the storefront at http://localhost:8000/dk and the admin at http://localhost:9000/app
(credentials: `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD` in `.env`, test-only values).

| Command | What it does |
|---|---|
| `make up` | Build if needed, start, wait for health, write `.generated/sut.env` |
| `make smoke` | Smoke checks against the running stand |
| `make bootstrap` | Re-run the idempotent QA bootstrap and refresh the contract |
| `make reset` | Delete this stand's volumes and start from a clean state |
| `make down` / `make clean` | Stop (keep data) / stop and delete data |
| `make status` / `make logs` | Service status / follow logs |

Ports are bound to `127.0.0.1` only; change them in `.env` if they are taken.

## Project structure

| Path | Purpose |
|---|---|
| `app/` | Vendored Medusa dtc-starter (backend + storefront), with the patches listed in [docs/upstream-patches.md](docs/upstream-patches.md) |
| `app/apps/backend/src/scripts/qa-bootstrap.ts` | Idempotent QA data, admin, publishable key lookup, read-only DB role, contract file |
| `docker/` | Backend and storefront Dockerfiles, storefront entrypoint (runtime key injection) |
| `compose.yaml` | Services, healthchecks, start-up order, ports, network `qa-shop-net` |
| `scripts/smoke.sh` | POSIX smoke check |
| `docs/` | Architecture, test data contract, ADRs |
| `.env.example` | Ports and test-only credentials; copied to `.env` on first `make up` |

## Test strategy

This repository is the environment, not a test suite. Its own quality bar is the smoke check plus two
properties verified on every change: **reset → smoke passes from scratch**, and **bootstrap is idempotent**.
The rule for test projects is "read shared data, create your own through the API" —
see [docs/test-data-contract.md](docs/test-data-contract.md).

## Coverage

| What the stand guarantees | How it is checked |
|---|---|
| Backend healthy, Store API requires a publishable key | `make smoke` checks 1–3 |
| Test admin can log in | `make smoke` check 4 |
| Storefront renders QA products with local images | `make smoke` check 5 |
| No duplicate data after repeated bootstrap | `make bootstrap` twice, product/region/user counts unchanged |
| Read-only DB role cannot write | `UPDATE`/`CREATE` as `qa_readonly` fail with "read-only transaction" |

## CI/CD

Planned after publication: lint scripts, Dockerfiles and workflows (shellcheck, hadolint, actionlint),
build and start the stand, run smoke, upload logs on failure; multi-arch images in GHCR and a reusable
`start-sut` action for the test repositories.

## How-to

- **Change a port:** edit `.env` (`SHOP_BACKEND_PORT`, …), then `make up`. Backend and storefront follow automatically.
- **See why a service is unhealthy:** `make status`, then `docker compose logs <service> --tail=100`.
- **Query the database as tests do:** `docker compose exec postgres psql "postgres://qa_readonly:qa-local-readonly-password@localhost:5432/medusa"`.
- **Upgrade Medusa:** follow [docs/upstream-patches.md](docs/upstream-patches.md).

## Results and findings

| Check (2026-10-31, Windows 11 x86_64, Docker Desktop 16 GB / 12 CPUs) | Result |
|---|---|
| `make reset` + `make smoke`, cached images | 41 s, 5/5 checks passed |
| `make bootstrap` twice in a row | exit 0 both times (17 s, 16 s), 0 new records |
| `docker compose build --no-cache` (base images already pulled) | 192 s, exit 0 |

## Decisions

- [ADR-001](docs/adr/ADR-001-medusa-as-sut.md) — Medusa v2 rather than Toolshop, Juice Shop or Saleor
- [ADR-002](docs/adr/ADR-002-run-mode-and-key.md) — production run mode, shared network namespace, runtime publishable key injection

## How AI was used

The repository owner defined the goals and scope, chose the system under test and approved the
architecture and tools. An AI coding assistant (Claude Code) helped write the Compose setup, scripts,
bootstrap code and documentation within that plan. Everything here was run and checked on a real
machine; the numbers above come from those runs.

## Roadmap & known limitations

- No CI yet; images are built locally (CI, GHCR images and the `start-sut` action come with publication).
- Verified on Windows 11 + Docker Desktop (x86_64) so far; macOS arm64 and Linux runs are pending.
- The starter seed references product images on Medusa's public S3 bucket; pages with those products
  need internet access to show images. QA products use local images.
- The session cookie is configured without `Secure` because the stand is plain HTTP on localhost —
  never copy this configuration to a real deployment.

## Licence and credits

MIT © 2026 Taras Bilokin — see [LICENSE](LICENSE). `app/` is
[medusajs/dtc-starter](https://github.com/medusajs/dtc-starter) at commit `d4e4dae`
(`@medusajs/*` 2.22.2), MIT © 2022 Medusa — see [LICENSE-medusa-dtc-starter](LICENSE-medusa-dtc-starter)
and [NOTICE](NOTICE). Runtime images: `node:22.23.4-bookworm-slim`, `postgres:17.11-alpine`, `redis:7.4.12-alpine`.
