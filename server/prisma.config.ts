import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Opcional aqui para que `prisma generate` rode sem banco; migrations exigem a URL.
  ...(url ? { datasource: { url } } : {}),
});
