#!/usr/bin/env node
// Garante que o Pages sirva os arquivos otimizados e que a versão do cache
// avance junto com as URLs. Isso evita tanto regressão de peso quanto clientes
// presos indefinidamente em um asset antigo do service worker.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = caminho => readFileSync(join(raiz, caminho), 'utf8');

const supabase = ler('assets/js/supabase.js');
const sw = ler('sw.js');
const versao = supabase.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
assert.ok(versao, 'ASSET_VERSION não encontrada');
assert.match(sw, new RegExp(`sorteio-sei-assets-${versao}`), 'cache do service worker está em outra versão');

for (const pagina of ['index.html', 'julgados.html', '404.html']) {
  const html = ler(pagina);
  const assets = [...html.matchAll(/(?:href|src)="(assets\/(?:css|js)\/[^"?]+\.min\.(?:css|js))\?v=([^"&]+)"/g)];
  assert.ok(assets.length > 0, `${pagina}: nenhum asset minificado versionado`);

  for (const [, caminho, versaoHtml] of assets) {
    assert.equal(versaoHtml, versao, `${pagina}: versão divergente em ${caminho}`);
    assert.ok(existsSync(join(raiz, caminho)), `${pagina}: ${caminho} não existe`);
  }
}

const index = ler('index.html');
const julgados = ler('julgados.html');
assert.doesNotMatch(index, /<script[^>]+index\.min\.js/, 'index.js voltou ao carregamento inicial');
assert.doesNotMatch(julgados, /<script[^>]+julgados\.min\.js/, 'julgados.js voltou ao carregamento inicial');

console.log('assets: minificação, lazy load e versão de cache coerentes ✓');
