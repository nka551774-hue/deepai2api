# syntax=docker/dockerfile:1
FROM node:20-alpine

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
