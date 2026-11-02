# syntax=docker/dockerfile:1.7
# Medusa backend + admin in production mode (see docs/adr/ADR-002-run-mode-and-key.md).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    MEDUSA_DISABLE_TELEMETRY=true
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
WORKDIR /server

FROM base AS deps
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml app/.npmrc app/turbo.json ./
COPY app/apps/backend/package.json apps/backend/package.json
COPY app/apps/storefront/package.json apps/storefront/package.json
RUN --mount=type=cache,id=qa-shop-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dtc/backend

FROM deps AS build
COPY app/apps/backend apps/backend
WORKDIR /server/apps/backend
RUN pnpm exec medusa build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=9000 \
    PATH=/server/apps/backend/node_modules/.bin:/pnpm:$PATH
COPY --from=build /server /server
WORKDIR /server/apps/backend/.medusa/server
HEALTHCHECK --interval=5s --timeout=3s --start-period=60s --retries=30 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||9000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["medusa", "start"]
