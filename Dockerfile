# Remy for a home server or a VM: one process, one port (7790), no other services.
# Build:  docker build -t remy .
# Run:    see docker-compose.yml and docs/home-server.md

# ---- build: install, bundle the CLI and the web app, keep only what runs
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm bundle \
  && pnpm --filter @koryei/remy deploy --prod /out

# ---- run: the bundle, its few runtime packages, and nothing else
FROM node:22-alpine
RUN addgroup -S remy && adduser -S -G remy -h /home/remy remy \
  && mkdir /data && chown remy:remy /data \
  && ln -s /app/release/remy.js /usr/local/bin/remy
COPY --from=build /out /app
ENV NODE_ENV=production \
    REMY_HOME=/data \
    REMY_SERVE_ALLOW_REMOTE=on
USER remy
WORKDIR /data
VOLUME /data
EXPOSE 7790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:7790/api/health || exit 1
CMD ["remy", "serve", "--host", "0.0.0.0", "--port", "7790"]
