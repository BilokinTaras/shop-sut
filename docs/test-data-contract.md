# Test data contract

This document tells test projects which data in `shop-sut` they can rely on and how to behave with it.

## The rule

> **Read shared data, never change it. Create your own data through the API and clean it up.**

Shared data is everything created by the starter seed and by `qa-bootstrap`. Tests run in parallel and
in any order, so a test that edits a shared product, price, region or promotion breaks other tests.

## Contract file: `.generated/sut.env`

Written by the `bootstrap` service and copied to the host by `make up` / `make bootstrap`.
Test projects read it from `../shop-sut/.generated/sut.env` and must not hard-code any of these values.

| Variable | Meaning | Example |
|---|---|---|
| `SUT_MEDUSA_VERSION` | Pinned Medusa version | `2.22.2` |
| `SUT_BACKEND_URL` | Backend from the host | `http://localhost:9000` |
| `SUT_ADMIN_URL` | Admin dashboard | `http://localhost:9000/app` |
| `SUT_STOREFRONT_URL` | Storefront from the host | `http://localhost:8000` |
| `SUT_STOREFRONT_COUNTRY` | Country code used in storefront URLs | `dk` |
| `SUT_PUBLISHABLE_KEY` | Publishable API key of the default sales channel (public by design) | `pk_…` |
| `SUT_ADMIN_EMAIL` / `SUT_ADMIN_PASSWORD` | Test admin (test-only values from `.env.example`) | `qa-admin@example.com` |
| `SUT_REGION_ID` / `SUT_REGION_CURRENCY` | Europe region from the starter seed | `reg_…` / `eur` |
| `SUT_REGION_USD_ID` | "QA North America" region (us, ca) in USD | `reg_…` |
| `SUT_SALES_CHANNEL_ID` | Default sales channel | `sc_…` |
| `SUT_STOCK_LOCATION_ID` | "European Warehouse" stock location | `sloc_…` |
| `SUT_DB_READONLY_URL` | Postgres as role `qa_readonly` (SELECT only, read-only transactions) | `postgres://qa_readonly:…@localhost:55432/medusa` |
| `SUT_REDIS_URL` | Redis from the host | `redis://localhost:56379` |
| `SUT_DOCKER_NETWORK` | Docker network other stacks join | `qa-shop-net` |
| `SUT_INTERNAL_BACKEND_URL` | Backend from a container on that network | `http://medusa:9000` |
| `SUT_INTERNAL_DB_READONLY_URL` | Postgres read-only from that network | `postgres://qa_readonly:…@postgres:5432/medusa` |
| `SUT_INTERNAL_REDIS_URL` | Redis from that network | `redis://redis:6379` |
| `SUT_JWT_SECRET` | Test-only JWT signing secret of the stand, for tests that need expired or tampered tokens | `qa-local-jwt-secret-not-for-production` |

## Shared data you can rely on

### From the Medusa starter seed (`app/apps/backend/src/migration-scripts/initial-data-seed.ts`)

| Data | Details |
|---|---|
| Store | "Default Store", currencies EUR (default) and USD |
| Region "Europe" | EUR; countries gb, de, dk, se, fr, es, it; payment provider `pp_system_default`; tax regions with provider `tp_system` and no default rate |
| Sales channel | "Default Sales Channel", linked to the publishable key and the stock location |
| Stock location | "European Warehouse" (Copenhagen) |
| Shipping options | "Standard Shipping" and "Express Shipping", flat 10 EUR/USD, Europe service zone |
| Categories | Shirts, Sweatshirts, Pants, Merch |
| Products | Medusa T-Shirt, Sweatshirt, Sweatpants, Shorts with variants; images on Medusa's public S3 |

### From `qa-bootstrap` (`app/apps/backend/src/scripts/qa-bootstrap.ts`)

| Handle | Variants (SKU) | Price EUR / USD | Stock | Use it for |
|---|---|---|---|---|
| `qa-tee` | S, M, L (`QA-TEE-S/M/L`) | 25.00 / 30.00 | 1,000,000 each | Variant selection, cart, checkout |
| `qa-mug` | one (`QA-MUG`) | 12.50 / 14.00 | 1,000,000 | Single-variant flows, quantity changes |
| `qa-sold-out` | one (`QA-SOLD-OUT`) | 40.00 / 45.00 | 0 | Out-of-stock behaviour |

- All three are in collection **"QA Picks"** (`qa-picks`), which the storefront home page lists.
- Images are served by the storefront from `/qa/<handle>.png` — no internet access is needed and pages
  render identically everywhere.
- Region **"QA North America"** (USD; us, ca; tax provider `tp_system`, no rate) with shipping option
  "QA Standard Shipping (US/CA)", flat 8 USD.
- Admin user from `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD`.
- Database role `qa_readonly`: `SELECT` on all tables in `public` (including future ones),
  `default_transaction_read_only = on`, member of `pg_monitor` for the Postgres exporter.

## Data tests must create themselves

| Need | How |
|---|---|
| A customer | `POST /store/customers` after registering an auth identity; unique email per test |
| A cart | `POST /store/carts` with `region_id` from the contract |
| A promotion | `POST /admin/promotions` with a unique code; delete it in teardown |
| A product with special prices or stock | `POST /admin/products`; delete it in teardown |
| A region with taxes | Use countries not used by shared regions, or create tax rates only inside your own region |

Prefer unique names with a per-test suffix (e.g. faker seeded by the test title plus a random part)
so parallel workers never collide.

## Resetting

`make reset` wipes the volumes of this stand only (`qa-shop-sut_pgdata`, `qa-shop-sut_generated`) and
rebuilds the data from scratch. Nothing outside the `qa-shop-sut` Compose project is touched.
