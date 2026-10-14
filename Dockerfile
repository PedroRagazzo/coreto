# Imagem de produção do Coreto: um container entrega o site, a API e o socket.io.
# Ao iniciar, aplica as migrations no banco (DATABASE_URL) e sobe o servidor.
#
#   docker build -t coreto .
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -v coreto-uploads:/data/uploads coreto

FROM node:24-bookworm-slim AS base
# OpenSSL: o motor de migrations do Prisma precisa dele.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY shared/package.json shared/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w client && npm run db:generate -w server

FROM base
ENV NODE_ENV=production \
    SERVER_PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    CLIENT_DIST=/app/client/dist
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["sh", "-c", "npm run db:deploy -w server && exec node --import tsx server/src/index.ts"]
