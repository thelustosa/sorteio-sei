#!/usr/bin/env node
// Garante que o Pages sirva os arquivos otimizados e que a versão nas URLs
// seja o hash do conteúdo atual. Isso evita tanto regressão de peso quanto
// clientes presos num asset antigo por uma versão reaproveitada.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularVersao, versaoGravada, PAGINAS } from '../tools/versionar.mjs';
import vm from 'node:vm';

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
const cssIndex = ler('assets/css/index.css');
const julgadosCj = ler('julgados-cj.html');
const julgadosCreg = ler('julgados-creg.html');
const acervoCj = ler('acervo-cj.html');
const acervoCreg = ler('acervo-creg.html');
assert.match(index, /class="selection-card selection-card-sorteio"/,
  'o card de sorteio precisa ser o primeiro degrau explícito do gradiente');
assert.match(cssIndex,
  /\.selection-card-sorteio\s*\{\s*background:\s*#ffffff;\s*\}/,
  'o sorteio precisa manter o fundo inicial do gradiente');
assert.match(cssIndex,
  /\.selection-card-sorteio \.mode-button\s*\{\s*border-color:\s*var\(--accent\);\s*background:\s*var\(--accent\);\s*color:\s*var\(--on-accent\);\s*\}/,
  'os botões do sorteio precisam usar o primeiro tom do gradiente');
assert.doesNotMatch(index, /<script[^>]+index\.min\.js/, 'index.js voltou ao carregamento inicial');
assert.doesNotMatch(julgadosCj, /<script[^>]+julgados\.min\.js/, 'julgados.js voltou ao carregamento inicial');
assert.doesNotMatch(julgadosCreg, /<script[^>]+julgados\.min\.js/, 'julgados.js voltou ao carregamento inicial (Conselho)');
// As duas páginas de julgados são gêmeas — mesmo script, colegiados
// diferentes —: sem data-colegiado, o Conselho gravaria na tabela da Câmara.
assert.match(julgadosCj, /data-colegiado="cj"/, 'julgados-cj.html sem data-colegiado');
assert.match(julgadosCreg, /data-colegiado="creg"/, 'julgados-creg.html sem data-colegiado');
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
assert.match(cssIndex,
  /\.selection-card-historico\s*\{\s*background:\s*var\(--surface-historico\);\s*\}/,
  'o histórico precisa usar o tom intermediário do gradiente entre acervo e registro');
assert.match(cssIndex,
  /\.selection-card-historico \.mode-button-outline\s*\{\s*border-color:\s*var\(--accent-historico\);\s*background:\s*var\(--accent-historico\);\s*color:\s*var\(--on-accent\);\s*\}/,
  'os botões do histórico precisam usar o verde intermediário do gradiente');
assert.match(cssIndex,
  /\.selection-card-acervo \.mode-button-outline\s*\{\s*border-color:\s*var\(--accent-acervo\);\s*background:\s*var\(--accent-acervo\);\s*color:\s*var\(--on-accent\);\s*\}/,
  'os botões do acervo precisam inaugurar o gradiente preenchido');
// Cada cor do "gradiente" dos quatro cards é um token em :root, não um hex
// solto no seletor — checa as duas pontas: a variável resolve pro tom certo,
// e o card de fato referencia a variável (não redeclara o valor por conta).
for (const [nome, cor] of [
  ['--accent-acervo', '#0c695c'],
  ['--accent-historico-hover', '#126b5c'],
  ['--accent-secondary-hover', '#245f55']
]) {
  assert.match(cssIndex, new RegExp(`${nome}:\\s*${cor};`),
    `${nome} precisa continuar valendo ${cor}`);
}
for (const [card, token] of [
  ['acervo', '--accent-acervo'],
  ['historico', '--accent-historico-hover'],
  ['records', '--accent-secondary-hover']
]) {
  assert.match(cssIndex, new RegExp(`\\.selection-card-${card} \\.selection-copy h2\\s*\\{\\s*color:\\s*var\\(${token}\\);`),
    `${card} precisa acompanhar o tom correspondente do gradiente`);
}
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

// Toda página que entra pelo bootstrap consulta o banco antes de existir. Sem o
// preconnect, o aperto de mão TLS com o Supabase só começa depois dos scripts —
// as telas de acervo e histórico nasceram sem ele.
for (const pagina of PAGINAS.filter(p => /data-page="/.test(ler(p)))) {
  assert.match(ler(pagina), /<link rel="preconnect" href="https:\/\/[\w-]+\.supabase\.co" crossorigin/,
    `${pagina} não abre a conexão com o Supabase antecipadamente`);
}

// O rótulo da barra verde nasce no HTML e é reescrito pelo script da página —
// mas só depois de os dados chegarem. Se os dois discordarem, a barra mostra a
// palavra errada até lá, e com a transição entre páginas isso virou meio segundo
// de "Pautas pendentes" na tela do Conselho, que fala em sessões. O default do
// HTML tem de ser um dos valores que o próprio script escreve.
const arquivoDoScript = new Map([...bootstrap.matchAll(
  /'?([\w-]+)'?:\s*\{[^}]*?arquivo:\s*'([\w-]+)\.min\.js'/gs)]
  .map(([, chave, arquivo]) => [chave, `${arquivo}.js`]));
assert.ok(arquivoDoScript.size >= 6, 'não achei o par data-page/arquivo em PAGINAS');

let rotulosConferidos = 0;
for (const pagina of PAGINAS) {
  const html = ler(pagina);
  const chave = html.match(/data-page="([^"]+)"/)?.[1];
  const estatico = html.match(/id="txtModo">([^<]*)</)?.[1];
  const script = arquivoDoScript.get(chave);
  if (!chave || estatico === undefined || !script) continue;

  const escritos = [...ler(`assets/js/${script}`)
    .matchAll(/txtModo\.textContent\s*=\s*'([^']+)'/g)].map(([, valor]) => valor);
  // Páginas cujo script nunca mexe no rótulo não têm com o que divergir.
  if (escritos.length === 0) continue;

  assert.ok(escritos.includes(estatico),
    `${pagina}: a barra nasce com "${estatico}", mas ${script} só escreve ${
      escritos.map(v => `"${v}"`).join(', ')} — o rótulo pisca até os dados chegarem`);
  rotulosConferidos++;
}
assert.ok(rotulosConferidos >= 1,
  `esperava conferir o rótulo de pelo menos 1 página, conferi ${rotulosConferidos}`);
// As telas de julgados escapam da conferência acima por construção: o script
// guarda o rótulo que o HTML traz e o repõe, sem uma segunda cópia da palavra.
assert.match(ler('assets/js/julgados.js'), /rotuloDaLista = txtModo\.textContent/,
  'julgados.js voltou a escrever o rótulo da lista por conta própria');
assert.match(ler('assets/js/julgados.js'), /txtModo\.textContent = rotuloDaLista/,
  'julgados.js não repõe o rótulo da lista vindo do HTML');

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

// O card de detalhe segura o indicador de carregamento até ele ter aparecido de
// fato (aguardarIndicador, em supabase.js), e para isso precisa saber em quanto
// tempo o CSS o coloca na tela. O atraso mora nos dois arquivos; divergir faria
// o JS soltar o indicador no meio da animação de entrada — o lampejo que a
// espera existe para evitar.
const atrasoNoJs = Number(ler('assets/js/supabase.js')
  .match(/const ATRASO_DO_INDICADOR = (\d+);/)?.[1]);
assert.ok(atrasoNoJs, 'ATRASO_DO_INDICADOR não encontrado em supabase.js');
const entradaDoIndicador = cssIndex.match(
  /\.detalhe-loading \.loading-state,[^{]*\{\s*animation: spinner-fade-in \d+ms [^\d]*(\d+)ms backwards;/);
assert.ok(entradaDoIndicador, 'não achei o animation-delay de spinner-fade-in no CSS');
assert.equal(Number(entradaDoIndicador[1]), atrasoNoJs,
  'ATRASO_DO_INDICADOR divergiu do animation-delay de spinner-fade-in');

// Cada destino protegido precisa explicar o contexto em que a pessoa está entrando.
// Se um HTML voltar ao bloco genérico, a autenticação ainda funciona, mas a tela
// perde a identidade e a orientação específicas pedidas para aquele fluxo.
// admin.html entra na lista: ficar de fora era o que permitia ao painel manter
// um sistema de login paralelo (.admin-login-*), duplicando esta composição
// inteira sem nenhum teste notar a divergência.
const loginsEspecificos = [
  ['index.html', 'sorteio'],
  ['acervo-cj.html', 'acervo-cj'],
  ['acervo-creg.html', 'acervo-creg'],
  ['historico-cj.html', 'historico-cj'],
  ['historico-creg.html', 'historico-creg'],
  ['julgados-cj.html', 'julgados-cj'],
  ['julgados-creg.html', 'julgados-creg'],
  ['admin.html', 'admin']
];
const titulosDosLogins = new Set();
for (const [pagina, identidade] of loginsEspecificos) {
  const html = ler(pagina);
  const login = html.match(/<section id="loginScreen"[\s\S]*?<\/section>/)?.[0] || '';

  assert.match(login, /class="app-login"/,
    `${pagina}: o login precisa usar a composição institucional`);
  assert.match(login, new RegExp(`data-login-art="${identidade}"`),
    `${pagina}: o login precisa declarar sua identidade visual própria`);
  assert.match(login, /aria-labelledby="loginTitulo"/,
    `${pagina}: a composição precisa ser nomeada pelo seu título`);
  assert.match(login, /class="app-login-intro"/,
    `${pagina}: falta o painel contextual do login`);
  assert.match(login, /class="app-login-form-card"/,
    `${pagina}: falta o painel de identificação do login`);

  for (const id of ['loginForm', 'loginEmail', 'loginSenha', 'loginLembrar', 'btnEntrar', 'loginErro']) {
    assert.equal((login.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1,
      `${pagina}: o contrato de autenticação exige um único #${id}`);
  }

  const titulo = login.match(/<h2 id="loginTitulo">([^<]+)<\/h2>/)?.[1];
  assert.ok(titulo, `${pagina}: o painel contextual precisa de título próprio`);
  titulosDosLogins.add(titulo);
}
assert.equal(titulosDosLogins.size, loginsEspecificos.length,
  'cada HTML protegido precisa ter um conceito de login independente');

// E o contrato é UM: um segundo sistema de login no CSS foi exatamente o que
// deixou o painel administrativo fora desta verificação por tanto tempo.
// Procura por REGRA e não pela palavra: os comentários do CSS citam o sistema
// removido de propósito, para que ninguém o reintroduza sem ler por quê.
assert.doesNotMatch(cssIndex, /\.admin-login[\w-]*\s*[,{]/,
  'o painel voltou a ter um sistema de login próprio em vez de usar .app-login');
for (const [pagina, identidade] of loginsEspecificos) {
  assert.ok(cssIndex.includes(`[data-login-art='${identidade}']`),
    `${pagina}: nenhuma regra de .app-login veste a identidade "${identidade}"`);
}

console.log('assets: minificação, lazy load e versão por hash coerentes ✓');

// Toda página carrega supabase.js, bootstrap.js e o script da tela como scripts
// clássicos, que dividem um só escopo global. Um nome de topo declarado em dois
// deles com const/let/class derruba o segundo inteiro antes da primeira linha:
// foi o que aconteceu quando bootstrap.js ganhou `const moldura` e admin.js já
// tinha `function moldura()` — o painel abria em "window[paginaAtual.iniciar]
// is not a function". Os testes de tela não pegam isso, porque avaliam cada
// arquivo num escopo próprio; aqui os três rodam no mesmo, como no navegador.
// A redeclaração falha na instanciação do script, antes de qualquer código, e
// por isso não importa que falte DOM: os outros erros são esperados e ignorados.
for (const tela of ['index', 'julgados', 'acervo', 'historico', 'admin']) {
  const contexto = vm.createContext({});
  for (const arquivo of ['supabase', 'bootstrap', tela]) {
    try {
      vm.runInContext(ler(`assets/js/${arquivo}.min.js`), contexto);
    } catch (erro) {
      assert.doesNotMatch(String(erro.message), /already been declared/,
        `${tela}: ${arquivo}.min.js redeclara um nome global de outro script — ${erro.message}`);
    }
  }
}
