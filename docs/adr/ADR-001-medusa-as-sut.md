# ADR-001: Medusa v2 as the shared system under test

- Status: accepted
- Date: 2026-10-31

## Context

Three test projects (UI + API with Playwright, API with pytest, performance with k6) need one realistic,
deterministic application that:

- has a public REST API and a browser UI (storefront and admin);
- contains real business logic worth testing: carts, orders, promotions, taxes, regions and currencies,
  inventory, customer accounts and roles;
- runs locally and in CI from one command, on macOS arm64 and Linux amd64;
- has a licence that allows running, scanning and load-testing it in public repositories.

## Decision

Use **Medusa v2** (MIT) through its official **dtc-starter** (backend + admin + Next.js storefront),
pinned to commit `d4e4dae` of `medusajs/dtc-starter`, which uses `@medusajs/*` **2.22.2**. The starter is
vendored into `app/` with a small set of documented patches (`docs/upstream-patches.md`).

## Alternatives considered

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **Toolshop** (Practice Software Testing) | Ready in minutes, Swagger, a version with seeded bugs | Looks like a training app; licence asks for the author's permission for public hosting and use in third-party services | Licence friction for public CI and a "training app" signal to reviewers |
| **OWASP Juice Shop** | Famous, easy to run | Intentionally vulnerable training app; little realistic commerce logic (promos, taxes, regions) | Wrong purpose: it is a security trainer, not a product |
| **Saleor** | Real product, rich domain | GraphQL-first API (the target vacancies ask for REST), heavier stack (Python + Celery + dashboard), BSD-3 | REST coverage and stack weight |
| **Medusa v2** | Real product, MIT, REST Store + Admin APIs, promotions with tax-inclusive rules, regions/currencies, Postgres + Redis | Longer setup (backend, admin build, storefront, seed); versions must be pinned | **Chosen** — the setup cost is paid once in this repository |

## Consequences

- One `make up` gives every test project the same data; tests read it from `.generated/sut.env`.
- Upgrading Medusa is a deliberate change: bump the starter commit, re-run smoke, record it here.
- Defects found in Medusa can be reported upstream, which is verifiable evidence of real testing.
- The starter seed downloads product images from Medusa's public S3 bucket; QA products use local images
  instead, so visual tests stay deterministic.

## References

- https://github.com/medusajs/dtc-starter (commit `d4e4dae`, MIT)
- https://docs.medusajs.com/learn/installation/docker
- https://docs.medusajs.com/learn/deployment/general
