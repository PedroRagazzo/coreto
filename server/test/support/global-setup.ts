// Roda uma vez antes de todos os testes: aplica as migrations no banco de teste.

import { execSync } from 'node:child_process';
import { assertTestDatabase, TEST_DATABASE_URL } from './database.js';

export default function setup(): void {
  if (!TEST_DATABASE_URL) {
    console.warn(
      '\n[testes] TEST_DATABASE_URL não definida: os testes de integração serão pulados. ' +
        'Veja "Testes" no README.\n',
    );
    return;
  }
  assertTestDatabase(TEST_DATABASE_URL);
  // `migrate deploy` cria o banco se ele não existir e só aplica migrations, sem nunca apagar dados.
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
