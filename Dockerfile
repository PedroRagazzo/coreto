# Imagem de produção do Coreto: um container entrega o site, a API e o socket.io.
# Ao iniciar, aplica as migrations no banco (DATABASE_URL) e sobe o servidor.
#
#   docker build -t coreto .
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -v coreto-uploads:/data/uploads coreto
#
# Backup: o servidor copia o banco para /data/backups todo dia (server/src/backup.ts); `npm run backup -w server` faz uma agora.

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

# yt-dlp, o programa que o bot de música usa para ler o áudio de links do YouTube: o binário único
# oficial (sem Python), com versão e soma de verificação fixas. O YouTube muda com frequência e o
# yt-dlp acompanha: para atualizar, troque a versão e as duas somas (arquivo SHA2-256SUMS da release).
FROM base AS ytdlp
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256_AMD64=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a
ARG YTDLP_SHA256_ARM64=b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && case "$(uname -m)" in \
       x86_64) file=yt-dlp_linux; sha=$YTDLP_SHA256_AMD64 ;; \
       aarch64) file=yt-dlp_linux_aarch64; sha=$YTDLP_SHA256_ARM64 ;; \
       *) echo "sem yt-dlp para $(uname -m)" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${file}" \
  && echo "${sha}  /yt-dlp" | sha256sum -c - \
  && chmod 755 /yt-dlp

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
# ffmpeg converte o áudio do bot de música (yt-dlp -> PCM). O WebRTC do bot vem pronto no npm
# (@roamhq/wrtc) e pede a libasound2.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libasound2 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ytdlp /yt-dlp /usr/local/bin/yt-dlp
ENV NODE_ENV=production \
    SERVER_PORT=3000 \
    UPLOAD_DIR=/data/uploads \n    BACKUP_DIR=/data/backups \
    CLIENT_DIST=/app/client/dist
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads /data/backups && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME ["/data/uploads", "/data/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["sh", "-c", "npm run db:deploy -w server && exec node --import tsx server/src/index.ts"]
