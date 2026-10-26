-- Anexos que não são imagem: sem largura e altura. Só afrouxa uma restrição: nenhum dado existente muda.

-- AlterTable
ALTER TABLE "Attachment" ALTER COLUMN "width" DROP NOT NULL,
ALTER COLUMN "height" DROP NOT NULL;
