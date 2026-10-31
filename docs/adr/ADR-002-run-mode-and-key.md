# ADR-002: Production run mode, storefront networking and the publishable key

- Status: accepted
- Date: 2026-10-31

## Context

Medusa's official Docker guide runs everything in **development mode** (`medusa develop`, `next dev`)
with hot reload. For automated tests that is a poor fit: first requests compile code on demand, timings
jump between runs, and dev-only behaviour (verbose errors, file watching) differs from production.

Two further problems are specific to the Next.js storefront:

1. `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is required at build time and inlined into the built JavaScript,
   but the key is created by Medusa only after the database is seeded.
2. The storefront calls the backend both from the Next.js server (inside Docker) and from the browser
   (search, option pickers). One URL must therefore work in both places.

## Decision

1. **Production mode.** The backend image runs `medusa build` and then `medusa start` with
   `NODE_ENV=production`; the storefront image runs `next build` and `next start`. Redis-backed caching,
   event bus, workflow engine and locking modules are enabled as in Medusa's deployment guide.
   Because the stand is served over plain HTTP on localhost, the session cookie is configured with
   `secure: false, sameSite: "lax"` (production would otherwise send `Secure` cookies that WebKit rejects
   on HTTP). The storefront's own cookies (cart, customer token, locale) get the same treatment through
   `STOREFRONT_INSECURE_COOKIES=true`, set only in `compose.yaml`: Chromium and Firefox accept `Secure`
   cookies on `http://localhost`, WebKit does not, and the cart silently stops working there.
   This is documented as a local-only deviation.
2. **Startup order as Compose dependencies.** `postgres`/`redis` (healthy) → `migrate` (one-shot,
   `medusa db:migrate`, which also applies the starter seed once) → `medusa` (healthy) → `bootstrap`
   (one-shot, idempotent QA data, writes the contract) → `storefront`.
3. **Runtime key injection.** The storefront is built once with placeholder values. At container start
   the entrypoint copies the pristine build, replaces the placeholders with the key from the shared
   `generated` volume and the configured URLs, and starts `next start`. A reset that creates a new key
   only needs a container restart, not a rebuild. This also lets CI reuse prebuilt images later.
4. **Shared network namespace.** The storefront runs with `network_mode: service:medusa`, so
   `http://localhost:<backend port>` means the backend for the browser on the host and for the Next.js
   server in the container. The backend listens on the same port inside and outside the container, so
   overriding a port in `.env` keeps both sides consistent. This is not host networking and works the
   same on Docker Desktop for macOS and on Linux.

## Alternatives considered

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Development mode as in the official guide | Matches docs, hot reload | Unstable timings, on-demand compilation, differs from production | Bad for performance tests and flaky for UI tests |
| Rebuild the storefront after bootstrap with the real key | Simple to explain | Every reset costs a multi-minute `next build`; images cannot be prebuilt | Too slow for resets and CI |
| Hard-code a deterministic key into the database | No substitution step | Writes to Medusa's tables behind its API; hides how keys really work | Fragile and unrealistic |
| Two URLs (internal `http://medusa:9000` for the server, `localhost` for the browser) | Standard Docker naming | Next.js inlines one `NEXT_PUBLIC_` value for both server and browser code | Would need storefront code changes |
| `network_mode: host` | Trivial | Not supported the same way on Docker Desktop for macOS | Breaks the target demo machine |

## Consequences

- The storefront container depends on the backend container's network; if `medusa` is recreated,
  Compose recreates the storefront as well.
- The storefront port is published on the `medusa` service.
- Other containers (k6, Playwright in Docker) reach the backend as `http://medusa:<port>` on network
  `qa-shop-net`; a browser running inside a container that must load the storefront exactly as a host
  browser does can join the backend's network namespace (`--network container:<medusa container>`).

## References

- https://docs.medusajs.com/learn/deployment/general (production modules, `redisUrl`, predeploy migrations)
- https://nextjs.org/docs/app/guides/environment-variables (build-time inlining of `NEXT_PUBLIC_`)
- https://docs.docker.com/reference/compose-file/services/#network_mode
