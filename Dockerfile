# SPDX-License-Identifier: AGPL-3.0-only
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm -r build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --prod --frozen-lockfile && corepack cache clean
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
RUN cp apps/web/dist/3rdpartylicenses.txt apps/web/dist/browser/3rdpartylicenses.txt
COPY packages/api-contracts packages/api-contracts
COPY scripts/runtime.mjs scripts/runtime.mjs
COPY scripts/check-deployment.mjs scripts/check-deployment.mjs
RUN mkdir -p /app/state && chown node:node /app/state
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/runtime.mjs"]
