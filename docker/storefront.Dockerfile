# syntax=docker/dockerfile:1.7
# Next.js storefront built once with placeholders; the real publishable key
# and URLs are written in at container start (docs/adr/ADR-002-run-mode-and-key.md).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
WORKDIR /server

FROM base AS deps
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml app/.npmrc app/turbo.json ./
COPY app/apps/backend/package.json apps/backend/package.json
COPY app/apps/storefront/package.json apps/storefront/package.json
RUN --mount=type=cache,id=qa-shop-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dtc/storefront

FROM deps AS build
COPY app/apps/storefront apps/storefront
ENV NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_qa_build_placeholder_key \
    NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://qa-build-placeholder-backend:9000 \
    NEXT_PUBLIC_BASE_URL=http://qa-build-placeholder-storefront:8000 \
    NEXT_PUBLIC_DEFAULT_REGION=dk
RUN cd apps/storefront && pnpm exec next build && mv .next .next-template

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8000
COPY --from=build /server /server
COPY docker/storefront-entrypoint.sh /usr/local/bin/storefront-entrypoint.sh
RUN chmod 0755 /usr/local/bin/storefront-entrypoint.sh
WORKDIR /server/apps/storefront
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/'+(process.env.QA_STOREFRONT_COUNTRY||'dk')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/storefront-entrypoint.sh"]
