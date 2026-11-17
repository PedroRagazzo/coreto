-- Etiqueta ao lado do nome do membro (como a do "ROBÔ"), dada por um administrador do espaço. Só acrescenta colunas vazias.

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "tag" VARCHAR(16),
ADD COLUMN "tagColor" VARCHAR(7);
