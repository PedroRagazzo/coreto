import 'dotenv/config';

/** Banco usado pelos testes de integração; sem ele, esses testes são pulados. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

/**
 * Os testes apagam todas as tabelas. Para nunca rodarem contra um banco de
 * verdade por engano, o nome do banco precisa terminar em `_test`.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL aponta para o banco "${name}". Os testes apagam todos os dados, então o nome precisa terminar em "_test".`,
    );
  }
}
