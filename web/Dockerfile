# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.5.1

# ---- base
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION} @openai/codex@0.159.0 @anthropic-ai/claude-code@2.1.284
RUN mkdir -p /var/lib/blew-engines && chmod 700 /var/lib/blew-engines

# ---- deps: install with a persistent pnpm store cache
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---- dev: hot reload (source is bind-mounted by compose)
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- build
FROM deps AS build
COPY . .
RUN pnpm build

# ---- prod: standalone output, non-root
FROM node:${NODE_VERSION}-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN npm install -g @openai/codex@0.159.0 @anthropic-ai/claude-code@2.1.284
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs \
    && mkdir -p /var/lib/blew-engines && chown nextjs:nextjs /var/lib/blew-engines && chmod 700 /var/lib/blew-engines
COPY --from=build --chown=nextjs:nextjs /app/public ./public
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
