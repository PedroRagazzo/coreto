-- Nova permissão STREAM (1 << 7, compartilhar a tela). O @everyone de cada
-- espaço (cargo com o mesmo id do espaço) passa a tê-la, como nos espaços novos.
UPDATE "Role" SET "permissions" = "permissions" | 128 WHERE "id" = "spaceId";
