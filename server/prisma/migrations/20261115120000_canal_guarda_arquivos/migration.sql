-- Canais que guardam os arquivos para sempre. Só acrescenta uma coluna com padrão falso: nada que já existe muda.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "keepFiles" BOOLEAN NOT NULL DEFAULT false;
