-- Mensagens não lidas: até onde cada pessoa já leu cada canal ou conversa direta. Só acrescenta uma tabela.

-- CreateTable
CREATE TABLE "ReadState" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadState_pkey" PRIMARY KEY ("userId","channelId")
);

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem já está nos canais e nas conversas de hoje começa com tudo lido: sem isso, o histórico inteiro viraria
-- "não lido" na primeira vez. Para o que for criado depois, o servidor conta a partir de quando a pessoa entrou
-- no espaço (canais) ou de quando a conversa começou (conversas diretas).
-- (O horário é gravado em UTC, como o resto do banco, qualquer que seja o fuso do servidor do banco.)
INSERT INTO "ReadState" ("userId", "channelId", "lastReadAt")
SELECT m."userId", c."id", timezone('UTC', now())
FROM "Member" m
JOIN "Channel" c ON c."spaceId" = m."spaceId" AND c."kind" = 'TEXT'
ON CONFLICT DO NOTHING;

INSERT INTO "ReadState" ("userId", "channelId", "lastReadAt")
SELECT p."userId", d."id", timezone('UTC', now())
FROM "DirectConversation" d
CROSS JOIN LATERAL (VALUES (d."userAId"), (d."userBId")) AS p("userId")
ON CONFLICT DO NOTHING;
