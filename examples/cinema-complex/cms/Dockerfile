FROM oven/bun:1-slim AS base
WORKDIR /app

# ---- Install stage ----
FROM base AS installer

ARG GLAZE_REGISTRY_TOKEN
ARG GLAZE_REGISTRY_URL

# Write registry credentials directly — ARGs are available in RUN but don't
# persist to downstream stages, so the token never ends up in the final image.
RUN printf '[install.scopes]\n"@glaze" = { token = "%s", url = "%s" }\n' \
    "$GLAZE_REGISTRY_TOKEN" "$GLAZE_REGISTRY_URL" > /root/.bunfig.toml

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- Build stage ----
FROM installer AS builder

COPY index.ts drizzle.config.ts ./
RUN bun run build

# ---- Runtime stage ----
FROM base AS runner

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
COPY --from=builder /app/drizzle.config.ts .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["bun", "dist/index.js"]
