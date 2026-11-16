-- O conteúdo guardado de uma mensagem guarda cada menção como `<@id>` (uns 40 caracteres), então cabe mais do que os 2000
-- que a pessoa pode digitar. Só aumenta o limite da coluna: nenhuma mensagem existente muda (e o Postgres não reescreve a tabela).

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "content" SET DATA TYPE VARCHAR(8000);
