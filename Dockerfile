# Imagem de produção do Coreto: um container entrega o site, a API e o socket.io.
# Ao iniciar, aplica as migrations no banco (DATABASE_URL) e sobe o servidor.
#
#   docker build -t coreto .
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -v coreto-uploads:/data/uploads coreto
#
# Backup: `npm run backup -w server` grava uma cópia do banco em /data/backups (ver server/scripts/backup.sh).

FROM node:24-bookworm-slim AS base
# OpenSSL: o motor de migrations do Prisma precisa dele.
# postgresql-client-17, do repositório oficial do PostgreSQL: pg_dump da mesma versão do banco, para os backups.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
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
RUN mkdir -p /data/uploads /data/backups && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME ["/data/uploads", "/data/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["sh", "-c", "npm run db:deploy -w server && exec node --import tsx server/src/index.ts"]
