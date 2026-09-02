#!/usr/bin/env node
// Garante que o Pages sirva os arquivos otimizados e que a versão nas URLs
// seja o hash do conteúdo atual. Isso evita tanto regressão de peso quanto
// clientes presos num asset antigo por uma versão reaproveitada.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularVersao, versaoGravada, PAGINAS } from '../tools/versionar.mjs';

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

for (const pagina of PAGINAS) {
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
const julgadosCj = ler('julgados-cj.html');
const julgadosCreg = ler('julgados-creg.html');
const acervoCj = ler('acervo-cj.html');
const acervoCreg = ler('acervo-creg.html');
assert.doesNotMatch(index, /<script[^>]+index\.min\.js/, 'index.js voltou ao carregamento inicial');
assert.doesNotMatch(julgadosCj, /<script[^>]+julgados\.min\.js/, 'julgados.js voltou ao carregamento inicial');
assert.doesNotMatch(julgadosCreg, /<script[^>]+julgados-creg\.min\.js/, 'julgados-creg.js voltou ao carregamento inicial');
assert.ok(acervoCj.indexOf('class="nav-actions"') < acervoCj.indexOf('id="btnExportar"')
  && acervoCj.indexOf('id="btnExportar"') < acervoCj.indexOf('</nav>'),
  'Exportar precisa permanecer junto das ações da barra superior (Câmara)');
assert.ok(acervoCreg.indexOf('class="nav-actions"') < acervoCreg.indexOf('id="btnExportar"')
  && acervoCreg.indexOf('id="btnExportar"') < acervoCreg.indexOf('</nav>'),
  'Exportar precisa permanecer junto das ações da barra superior (Conselho)');

// O histórico entra pelo mesmo caminho das demais telas autenticadas: o script
// da página só é buscado depois que a sessão existe. E as duas páginas são
// gêmeas — mesmo script, colegiados diferentes —, então cada uma precisa dizer
// qual é o seu, ou as duas mostrariam a Câmara.
assert.match(index, /class="selection-card selection-card-historico"/,
  'o card de histórico saiu da tela principal');
for (const [pagina, colegiado] of [['historico-cj.html', 'cj'], ['historico-creg.html', 'creg']]) {
  const html = ler(pagina);
  assert.doesNotMatch(html, /<script[^>]+historico\.min\.js/,
    `${pagina}: historico.js voltou ao carregamento inicial`);
  assert.match(html, new RegExp(`data-colegiado="${colegiado}"`),
    `${pagina}: sem data-colegiado, o script cai no padrão e mostra o outro colegiado`);
  // O card da tela principal é a única porta para cada histórico: sem o link, a
  // página existe e ninguém chega nela.
  assert.ok(index.includes(`href="./${pagina}"`),
    `o card de histórico não aponta para ${pagina}`);
}

// A fixture visual do histórico carrega o historico.js de verdade, e o script
// resolve todos os elementos no topo do arquivo. Um id que exista nas páginas e
// falte aqui não dá erro nenhum na CI — a fixture não está em PAGINAS —, mas
// derruba o script no carregamento e a tela abre em branco, que foi o que
// aconteceu quando o card do histórico ganhou o botão Exportar.
const historicoJs = ler('assets/js/historico.js');
const fixtureHistorico = ler('tests/fixtures/historico-visual.html');
const idsDoHistorico = [...new Set([...historicoJs.matchAll(/getElementById\('([^']+)'\)/g)]
  .map(([, id]) => id))];
assert.ok(idsDoHistorico.length >= 15, 'não achei os getElementById do historico.js: a forma mudou?');
for (const id of idsDoHistorico) {
  assert.ok(fixtureHistorico.includes(`id="${id}"`),
    `historico-visual.html não tem id="${id}": a fixture abre em branco`);
}

// Renomear uma página e esquecer a entrada correspondente deixa o dashboard em
// branco: sem a chave, o bootstrap não carrega script nenhum e não reclama.
const bootstrap = ler('assets/js/bootstrap.js');
const chavesBootstrap = new Set([...bootstrap
  .slice(bootstrap.indexOf('const PAGINAS'), bootstrap.indexOf('};', bootstrap.indexOf('const PAGINAS')))
  .matchAll(/^ {2}'?([\w-]+)'?:\s*\{/gm)].map(([, chave]) => chave));
const paginasDoHtml = PAGINAS.map(pagina => ler(pagina).match(/data-page="([^"]+)"/)?.[1]).filter(Boolean);
assert.ok(paginasDoHtml.length >= 6, 'não achei os data-page das páginas: o atributo mudou?');
for (const pagina of paginasDoHtml) {
  assert.ok(chavesBootstrap.has(pagina), `data-page="${pagina}" não tem entrada em PAGINAS no bootstrap.js`);
}
for (const chave of chavesBootstrap) {
  assert.ok(paginasDoHtml.includes(chave), `PAGINAS["${chave}"] no bootstrap.js não corresponde a página nenhuma`);
}

const css = ler('assets/css/index.css');
// O seletor pode vir sozinho ou em lista, e a var pode trazer fallback — o que
// importa é a regra que o bloco aplica, não a forma exata de escrevê-la.
// Ancorado no início da linha: a palavra "@media print" também aparece em
// comentário, e um regex solto passava a ler as regras de tela como se fossem
// as do papel.
const inicioImpressao = css.search(/^@media print \{/m);
assert.ok(inicioImpressao >= 0, 'bloco @media print não encontrado');
const blocoImpressao = css.slice(inicioImpressao);

const alertaImpresso = blocoImpressao.match(
  /\.acervo-table tbody td\.acervo-alerta[^{]*\{([^}]*)\}/)?.[1] || '';
assert.match(alertaImpresso, /background-color:\s*var\(--danger-panel[^)]*\)\s*!important/,
  'impressão do alerta deve usar o mesmo vermelho da tela');
assert.match(alertaImpresso, /color:\s*var\(--danger-panel-text[^)]*\)\s*!important/,
  'impressão do alerta deve preservar o texto vinho sobre o vermelho claro');
assert.match(alertaImpresso, /print-color-adjust:\s*exact/,
  'impressão do alerta deve solicitar preservação exata das cores');
assert.match(css,
  /@media screen and \(max-width: 480px\)[\s\S]*?\.dashboard-page \.nav-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,/,
  'as quatro ações do dashboard precisam formar duas colunas em telas estreitas');
assert.match(css,
  /@media screen and \(max-width: 480px\)[\s\S]*?\.dashboard-page \.export-options,[\s\S]*?max-width:\s*calc\(100vw - 24px\)/,
  'centralizado numa célula de meia largura, o menu de exportação precisa caber na viewport');
// O clicável do painel é um <button> dentro do <td>; o <td> mantém o padding
// que muda por breakpoint, então quem estende o alvo ao retângulo é o ::after.
assert.match(css, /\.acervo-celula-btn::after\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/,
  'sem o ::after, só o texto da célula seria clicável');

// ...e é o `height` do <td> que dá a altura desse retângulo, porque o botão tem
// min-height: 0. Sem este piso, os breakpoints de densidade decidiam a altura do
// alvo de toque sozinhos — 40px no mais apertado, abaixo dos 44px que
// `button, input, select` garante a todo o resto da interface.
const PISO_ALVO = 44;
const alturasDaCelula = [...css.matchAll(
  /\.acervo-table tbody th,\s*[^{]*\.acervo-table tbody td\s*\{[^}]*?height:\s*(\d+)px/g)]
  .map(m => Number(m[1]));
assert.ok(alturasDaCelula.length >= 3,
  'não achei as alturas da célula do painel: o seletor mudou?');
assert.ok(alturasDaCelula.every(h => h >= PISO_ALVO),
  `célula do painel abaixo do alvo de ${PISO_ALVO}px: ${alturasDaCelula.join(', ')}`);

// As larguras e alturas de tela também casam no papel — e com valores
// diferentes em cada navegador: o Chrome imprime como se a página fosse
// estreita, o Firefox não. Sem `screen`, um `display: none` pensado para caber
// na tela apagava o subtítulo do painel só no PDF do Firefox. Quem monta o
// layout impresso é o bloco @media print, sozinho.
const responsivosSemScreen = [...css.matchAll(/^@media ([^{]*(?:max-width|min-width|max-height|min-height)[^{]*)\{/gm)]
  .map(([, condicao]) => condicao.trim())
  .filter(condicao => !condicao.startsWith('screen'));
assert.deepEqual(responsivosSemScreen, [],
  'bloco responsivo sem `screen and`: ele vaza para a impressão');

const subtituloImpresso = blocoImpressao.match(/\.acervo-subtitle\s*\{([^}]*)\}/)?.[1] || '';
assert.doesNotMatch(subtituloImpresso, /display:\s*none/,
  'o subtítulo do painel precisa sair no PDF');

// O rodapé do painel só sai inteiro no PDF do Firefox sem flex e com folga
// abaixo da linha: com o inline-flex da tela a data não era desenhada, e com
// padding-bottom zero ela saía com a metade de baixo aparada.
const rodapeImpresso = blocoImpressao.match(/\.acervo-panel-footer\s*\{([^}]*)\}/)?.[1] || '';
assert.match(rodapeImpresso, /display:\s*block/,
  'o rodapé impresso não pode voltar a ser flex');
assert.match(rodapeImpresso, /padding:\s*\d+px\s+\d+px\s+[1-9]\d*px/,
  'o rodapé impresso precisa de padding-bottom, senão o Firefox corta a data');

console.log('assets: minificação, lazy load e versão por hash coerentes ✓');
