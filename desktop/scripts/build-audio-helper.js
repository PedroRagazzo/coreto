// @ts-check
// Compila native/coreto-audio.cpp em native/bin/coreto-audio.exe (captura de som por programa no
// Windows; ver o cabeçalho do .cpp). Precisa do Visual Studio com as ferramentas de C++, que o
// windows-latest do GitHub Actions já traz. Fora do Windows não faz nada.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('coreto-audio: só existe no Windows, nada a compilar.');
  process.exit(0);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'native', 'coreto-audio.cpp');
const outDir = join(root, 'native', 'bin');
const output = join(outDir, 'coreto-audio.exe');
mkdirSync(outDir, { recursive: true });

const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!existsSync(vswhere)) throw new Error('Visual Studio não encontrado (vswhere.exe). Instale as ferramentas de C++.');
const installation = execFileSync(
  vswhere,
  ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
  { encoding: 'utf8' },
).trim();
if (!installation) throw new Error('Visual Studio sem as ferramentas de C++ para x64.');
const vcvars = join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');

// /MT: sem depender do runtime do Visual C++ instalado no PC de quem usa.
const compile = `"${vcvars}" >nul && cl /nologo /O2 /EHsc /std:c++17 /MT /W3 /Fo"${outDir}\\\\" /Fe"${output}" "${source}"`;
const build = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${compile}"`], { stdio: 'inherit', windowsVerbatimArguments: true });
if (build.status !== 0) throw new Error('A compilação do coreto-audio.exe falhou.');
console.log(`coreto-audio: ${output}`);
