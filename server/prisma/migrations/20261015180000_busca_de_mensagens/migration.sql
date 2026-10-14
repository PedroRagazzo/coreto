-- Busca de mensagens: texto normalizado (sem acentos, minúsculo) e índice trigram,
-- que acelera `LIKE '%trecho%'`. O pg_trgm vem com o PostgreSQL e é uma extensão confiável.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

-- Preenche as mensagens antigas. O servidor grava as novas com searchKey() (shared/src/search.ts);
-- aqui `translate` cobre os acentos do português e os ids de menção saem com regexp_replace.
UPDATE "Message" SET "searchText" = btrim(regexp_replace(lower(translate(
  regexp_replace("content", '<@[A-Za-z0-9_-]{1,64}>', ' ', 'g'),
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
  'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
)), '\s+', ' ', 'g'));

-- CreateIndex
CREATE INDEX "Message_searchText_idx" ON "Message" USING GIN ("searchText" gin_trgm_ops);
