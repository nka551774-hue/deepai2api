# syntax=docker/dockerfile:1
FROM node:24-alpine

LABEL org.opencontainers.image.title="deepai2api" \
      org.opencontainers.image.description="DeepAI.org chat reverse proxy — OpenAI-compatible API, account pool, admin console" \
      org.opencontainers.image.source="https://github.com/nka551774-hue/deepai2api" \
      org.opencontainers.image.licenses="MIT"

# curl is required by the upstream /api/* transport cascade (the upstream
# refuses non-browser TLS stacks; calls fall back to a system curl client).
RUN apk add --no-cache curl su-exec tzdata chromium font-noto-cjk

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY public ./public
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/deepai2api-entrypoint

RUN mkdir -p /app/data && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app

EXPOSE 3737
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT:-3737}/healthz" || exit 1

# The entrypoint initializes bind-mount ownership, then runs Node as app.
ENTRYPOINT ["deepai2api-entrypoint"]
CMD ["node", "server.js"]
