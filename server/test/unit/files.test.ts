import { describe, expect, it } from 'vitest';
import { describeAttachments, extensionOf, fileKind, formatBytes, sentAttachments } from '../../../shared/src/files.js';
import type { Attachment } from '../../../shared/src/models.js';

const image = (): Attachment => ({ id: 'i', fileName: 'a.png', contentType: 'image/png', size: 1, width: 4, height: 3, expired: false });
const file = (name = 'a.zip'): Attachment => ({
  id: 'f',
  fileName: name,
  contentType: 'application/octet-stream',
  size: 1,
  width: null,
  height: null,
  expired: false,
});

describe('fileKind', () => {
  it('escolhe o tipo pela extensão, sem ligar para maiúsculas', () => {
    expect(fileKind('relatório.PDF')).toBe('document');
    expect(fileKind('notas.txt')).toBe('document');
    expect(fileKind('planilha.xlsx')).toBe('sheet');
    expect(fileKind('save.zip')).toBe('archive');
    expect(fileKind('musica.mp3')).toBe('audio');
    expect(fileKind('clipe.MP4')).toBe('video');
    expect(fileKind('app.tsx')).toBe('code');
    expect(fileKind('algo.xyz')).toBe('other');
    expect(fileKind('sem-extensao')).toBe('other');
    expect(fileKind('.gitignore')).toBe('other');
  });

  it('marca como programa o que roda no computador de quem abrir', () => {
    for (const name of ['instalador.exe', 'a.bat', 'b.msi', 'c.ps1', 'd.JAR', 'atalho.lnk', 'script.js', 'e.vbs']) {
      expect(fileKind(name)).toBe('program');
    }
  });

  it('a extensão é a do fim do nome', () => {
    expect(extensionOf('arquivo.tar.gz')).toBe('gz');
    expect(extensionOf('foto.exe.png')).toBe('png');
    expect(extensionOf('Foto.PNG')).toBe('png');
  });
});

describe('descrição dos anexos', () => {
  it('diz imagens, arquivos ou anexos conforme o que veio', () => {
    expect(describeAttachments([image()])).toBe('1 imagem');
    expect(describeAttachments([image(), image()])).toBe('2 imagens');
    expect(describeAttachments([file()])).toBe('1 arquivo');
    expect(describeAttachments([file(), file()])).toBe('2 arquivos');
    expect(describeAttachments([image(), file(), file()])).toBe('3 anexos');
  });

  it('para a notificação: "uma imagem", "um arquivo", e o resto como acima', () => {
    expect(sentAttachments([image()])).toBe('uma imagem');
    expect(sentAttachments([file()])).toBe('um arquivo');
    expect(sentAttachments([image(), image(), image()])).toBe('3 imagens');
    expect(sentAttachments([file(), image()])).toBe('2 anexos');
  });
});

describe('formatBytes', () => {
  it('usa a unidade certa, com vírgula decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(4300)).toBe('4,2 KB');
    expect(formatBytes(18 * 1024 * 1024)).toBe('18 MB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });
});
