#!/usr/bin/env node
// A versão dos assets é o hash do próprio conteúdo: nunca mais existe URL
// `?v=` repetida apontando para arquivos diferentes — que era o que deixava o
// navegador servindo CSS antigo com JS novo até um Ctrl+F5.
// Uso: node tools/versionar.mjs   (depois gere os .min.* e rode os testes)

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FONTES = [
  'assets/css/index.css',
  'assets/js/supabase.js',
  'assets/js/bootstrap.js',
  'assets/js/index.js',
  'assets/js/julgados.js',
  'assets/js/julgados-creg.js',
  'assets/js/acervo.js'
];
export const PAGINAS = ['index.html', 'julgados.html', 'julgados-creg.html',
                        'acervo.html', '404.html'];

const ler = caminho => readFileSync(join(RAIZ, caminho), 'utf8');
// Zera a própria versão antes de hashear, senão o valor gravado mudaria o hash
// que acabou de ser calculado.
const semVersao = texto => texto.replace(/ASSET_VERSION = '[^']*'/, "ASSET_VERSION = ''");

export function calcularVersao() {
  const conteudo = FONTES.map(caminho => semVersao(ler(caminho))).join('\n');
  return createHash('sha256').update(conteudo).digest('hex').slice(0, 10);
}

export function versaoGravada() {
  return ler('assets/js/supabase.js').match(/ASSET_VERSION = '([^']*)'/)?.[1];
}

if (process.argv[1]?.endsWith('versionar.mjs')) {
  const versao = calcularVersao();
  const gravar = (caminho, texto) => writeFileSync(join(RAIZ, caminho), texto);

  gravar('assets/js/supabase.js',
    ler('assets/js/supabase.js').replace(/ASSET_VERSION = '[^']*'/, `ASSET_VERSION = '${versao}'`));
  gravar('assets/js/supabase.min.js',
    ler('assets/js/supabase.min.js').replace(/ASSET_VERSION=["'][^"']*["']/, `ASSET_VERSION="${versao}"`));

  for (const pagina of PAGINAS) {
    gravar(pagina, ler(pagina).replace(/(\.min\.(?:css|js))\?v=[^"&]*/g, `$1?v=${versao}`));
  }

  console.log(`assets versionados como ${versao}`);
}
