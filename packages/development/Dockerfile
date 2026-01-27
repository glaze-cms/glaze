##################################
# base
##################################
FROM oven/bun:1 AS base
WORKDIR /app

##################################
# deps (cached)
##################################
FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/development/package.json ./packages/development/package.json
COPY packages/admin/package.json ./packages/admin/package.json
COPY packages/cms/package.json ./packages/cms/package.json
COPY packages/logger/package.json ./packages/logger/package.json

RUN bun install

##################################
# dev
##################################
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/admin/node_modules ./packages/admin/node_modules
COPY --from=deps /app/packages/cms/node_modules ./packages/cms/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/development/node_modules ./packages/development/node_modules
COPY --from=deps /app/packages/logger/node_modules ./packages/logger/node_modules
COPY . .
WORKDIR /app
ENV NODE_ENV=development
EXPOSE 4000
EXPOSE 5173
CMD ["bun", "run", "dev"]
