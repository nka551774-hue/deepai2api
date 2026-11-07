# syntax=docker/dockerfile:1
FROM node:20-alpine

LABEL org.opencontainers.image.title="deepai2api" \
      org.opencontainers.image.description="DeepAI.org chat reverse proxy — OpenAI-compatible API, account pool, admin console" \
      org.opencontainers.image.source="https://github.com/nka551774-hue/deepai2api" \
      org.opencontainers.image.licenses="MIT"

# curl is required by the upstream /api/* transport cascade (the upstream
# refuses non-browser TLS stacks; calls fall back to a system curl client).
RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    HOST=0.0.0.0

COPY package.json server.js ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app
USER app

EXPOSE 3737
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3737/healthz || exit 1

CMD ["node", "server.js"]
