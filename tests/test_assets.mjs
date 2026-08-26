#!/usr/bin/env node
// Garante que o Pages sirva os arquivos otimizados e que a versão nas URLs
// seja o hash do conteúdo atual. Isso evita tanto regressão de peso quanto
// clientes presos num asset antigo por uma versão reaproveitada.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularVersao, versaoGravada } from '../tools/versionar.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = caminho => readFileSync(join(raiz, caminho), 'utf8');

const versao = versaoGravada();
assert.ok(versao, 'ASSET_VERSION não encontrada');
assert.equal(versao, calcularVersao(),
  'assets mudaram sem versionar: rode node tools/versionar.mjs');
const versaoMinificada = ler('assets/js/supabase.min.js')
  .match(/ASSET_VERSION=["']([^"']+)["']/)?.[1];
assert.equal(versaoMinificada, versao,
  'supabase.min.js carrega páginas com uma versão antiga dos assets');

for (const pagina of ['index.html', 'julgados.html', 'acervo.html', '404.html']) {
  const html = ler(pagina);
  const assets = [...html.matchAll(/(?:href|src)="(assets\/(?:css|js)\/[^"?]+\.min\.(?:css|js))\?v=([^"&]+)"/g)];
  assert.ok(assets.length > 0, `${pagina}: nenhum asset minificado versionado`);

  for (const [, caminho, versaoHtml] of assets) {
    assert.equal(versaoHtml, versao, `${pagina}: versão divergente em ${caminho}`);
    assert.ok(existsSync(join(raiz, caminho)), `${pagina}: ${caminho} não existe`);
  }
}

const erro404 = ler('404.html');
const paginaAninhada = new URL('https://thelustosa.github.io/sorteio-sei/inexistente/aninhado');
const base404 = erro404.match(/<base href="([^"]+)"/i)?.[1] || paginaAninhada.href;
for (const [recurso, destino] of [
  ['assets/img/favicon.png', '/sorteio-sei/assets/img/favicon.png'],
  [`assets/css/index.min.css?v=${versao}`, '/sorteio-sei/assets/css/index.min.css'],
  ['./index.html', '/sorteio-sei/index.html']
]) {
  assert.equal(new URL(recurso, new URL(base404, paginaAninhada)).pathname, destino,
    `404 aninhada resolve ${recurso} fora da raiz do Pages`);
}

const index = ler('index.html');
const julgados = ler('julgados.html');
const acervo = ler('acervo.html');
assert.doesNotMatch(index, /<script[^>]+index\.min\.js/, 'index.js voltou ao carregamento inicial');
assert.doesNotMatch(julgados, /<script[^>]+julgados\.min\.js/, 'julgados.js voltou ao carregamento inicial');
assert.ok(acervo.indexOf('class="nav-actions"') < acervo.indexOf('id="btnExportar"')
  && acervo.indexOf('id="btnExportar"') < acervo.indexOf('</nav>'),
  'Exportar precisa permanecer junto das ações da barra superior');

const css = ler('assets/css/index.css');
// O seletor pode vir sozinho ou em lista, e a var pode trazer fallback — o que
// importa é a regra que o bloco aplica, não a forma exata de escrevê-la.
const alertaImpresso = css.match(
  /@media print[\s\S]*?\.acervo-table tbody td\.acervo-alerta[^{]*\{([^}]*)\}/)?.[1] || '';
assert.match(alertaImpresso, /background-color:\s*var\(--danger-panel[^)]*\)\s*!important/,
  'impressão do alerta deve usar o mesmo vermelho da tela');
assert.match(alertaImpresso, /color:\s*var\(--danger-panel-text[^)]*\)\s*!important/,
  'impressão do alerta deve preservar o texto vinho sobre o vermelho claro');
assert.match(alertaImpresso, /print-color-adjust:\s*exact/,
  'impressão do alerta deve solicitar preservação exata das cores');
assert.match(css,
  /@media \(max-width: 480px\)[\s\S]*?\.dashboard-page \.nav-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,/,
  'as quatro ações do dashboard precisam formar duas colunas em telas estreitas');
assert.match(css,
  /@media \(max-width: 480px\)[\s\S]*?\.dashboard-page \.export-options,[\s\S]*?max-width:\s*calc\(100vw - 24px\)/,
  'centralizado numa célula de meia largura, o menu de exportação precisa caber na viewport');
// O clicável do painel é um <button> dentro do <td>; o <td> mantém o padding
// que muda por breakpoint, então quem estende o alvo ao retângulo é o ::after.
assert.match(css, /\.acervo-celula-btn::after\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/,
  'sem o ::after, só o texto da célula seria clicável');

console.log('assets: minificação, lazy load e versão por hash coerentes ✓');
