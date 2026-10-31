# Changes to the vendored Medusa starter

`app/` is a copy of [`medusajs/dtc-starter`](https://github.com/medusajs/dtc-starter) at commit
`d4e4dae` (2026-10-30, "chore: update @medusajs/* to v2.22.2"), MIT licence (see `LICENSE-medusa-dtc-starter`).
Everything outside `app/` belongs to this repository. Inside `app/`, only the changes below were made,
so an upgrade is a diff of these files.

| File | Change | Why |
|---|---|---|
| `apps/backend/medusa-config.ts` | Redis caching, event bus, workflow engine and locking modules; `redisUrl`; `workerMode`; Postgres SSL off; session cookie `secure: false, sameSite: "lax"` | Production-like run mode (ADR-002); local HTTP stand |
| `apps/backend/src/scripts/qa-bootstrap.ts` | New file | Idempotent QA data, admin, key lookup, read-only role, contract file |
| `apps/storefront/public/qa/*.png` | New files (generated images) | Local images for QA products, deterministic visual tests |
| removed `.github/`, `AGENTS.md`, `CLAUDE.md`, `apps/storefront/tsconfig.tsbuildinfo` | Upstream CI and editor-agent files, build cache | Not used here; avoid confusing tooling |

To upgrade: check out the new starter commit next to this repository, copy it over `app/`, re-apply
the table above, bump `QA_MEDUSA_VERSION` in `compose.yaml`, then `make reset && make smoke`.
