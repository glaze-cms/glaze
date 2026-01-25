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
COPY packages/development/package.json ./packages/development/package.json

RUN bun install --frozen-lockfile

##################################
# dev
##################################
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/packages/development
ENV NODE_ENV=development
EXPOSE 4000
CMD ["bun", "run", "dev"]
