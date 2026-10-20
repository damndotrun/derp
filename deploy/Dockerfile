# syntax=docker/dockerfile:1
# dERP app-kép: Fastify szerver + a kliens buildje. Építés a repó gyökeréből:
#   docker build -f deploy/Dockerfile -t derp-app .
# (a compose ugyanígy építi). Céges/MITM proxy mögött opcionálisan CA adható:
#   --secret id=ca,src=/path/ca.crt

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    corepack enable && corepack install

# Minden függőség + a kliens buildje.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @derp/web build

# Csak a szerver futásidejű függőségei.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --prod --filter @derp/server...

FROM node:22-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY modules modules
COPY --from=build /app/apps/web/dist apps/web/dist
# A fájltár (DATA_DIR) helye; a node tulajdona, hogy a ráhúzott névvel ellátott kötet is írható legyen.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
# Migráció, majd a szerver. A frissítés előtti pg_dump a telepítő szkript dolga (13. munkacsomag).
CMD ["sh", "-c", "node apps/server/src/cli.ts migrate && exec node apps/server/src/index.ts"]
