# oovi's cloud runner image. Build from the repository root:
#   docker build -f runner/Dockerfile -t oovi-runner .
# It holds the app's own built server (the same engine as the desktop app) and runner/. No secrets inside:
# OOVI_WEB_URL and RUNNER_SECRET come from the server's env file at run time (infra/setup.sh).

# The app is built once on the build machine (its output is plain JavaScript); the final image exists for amd64 and arm64.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src
# Electron is only for the desktop app: its download is skipped here.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# A build behind a company proxy can give its certificate as a build secret (docker build --secret id=extra_ca,src=…).
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="oovi-runner" \
      org.opencontainers.image.description="oovi's cloud runner: phone tasks while the user's computer is off" \
      org.opencontainers.image.source="https://github.com/oussasz/oovi"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    OOVI_STANDALONE=/app/server \
    RUNNER_TMP=/tmp/oovi-runner \
    RUNNER_STATE_DIR=/tmp/oovi-runner
WORKDIR /app
COPY --from=build /src/.next/standalone ./server
COPY runner/package.json runner/*.mjs runner/*.cjs ./runner/
# The job folders live in /tmp (a tmpfs in infra/docker-compose.yml): nothing is kept on disk.
RUN mkdir -p /tmp/oovi-runner && chown node:node /tmp/oovi-runner
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD ["node", "/app/runner/health.cjs"]
# node is PID 1's child through tini (docker run --init / compose init: true) so SIGTERM reaches the runner.
CMD ["node", "/app/runner/index.mjs"]
