#!/bin/sh
# Cópia do banco do Coreto (pg_dump, formato custom, já compactado).
#
#   BACKUP_DIR   pasta das cópias (padrão: /data/backups, um volume no Dokploy)
#   BACKUP_KEEP  quantas cópias guardar (padrão: 14); as mais antigas são apagadas
#
# Restaurar (apaga e recria as tabelas a partir da cópia):
#   pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /data/backups/coreto-AAAAMMDD-HHMMSS.dump
set -eu

dir="${BACKUP_DIR:-/data/backups}"
keep="${BACKUP_KEEP:-14}"
# O pg_dump não entende parâmetros do Prisma como ?schema=public.
url="${DATABASE_URL%%\?*}"

mkdir -p "$dir"
file="$dir/coreto-$(date -u +%Y%m%d-%H%M%S).dump"
# Grava num temporário e renomeia: uma cópia pela metade nunca parece completa.
pg_dump --format=custom --no-owner --dbname="$url" --file="$file.tmp"
mv "$file.tmp" "$file"

# Apaga as mais antigas, mantendo as $keep mais recentes.
ls -1t "$dir"/coreto-*.dump | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$old"; done

echo "backup: $file ($(du -h "$file" | cut -f1)); $(ls -1 "$dir"/coreto-*.dump | wc -l) cópia(s) guardada(s)"
