#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const active = force ?? !this.contains(value);
    active ? this.add(value) : this.remove(value);
    return active;
  }
}

class Node {
  constructor(document, tagName = 'div') {
    this.document = document;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new ClassList();
    this.events = new Map();
    this.style = { removeProperty() {} };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }

  set className(value) { this.classList = new ClassList(); this.classList.add(...value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.children[0]; }

  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) {
    if (node.tagName === '#FRAGMENT') {
      [...node.children].forEach(child => this.appendChild(child));
      node.children = [];
      return node;
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  removeAttribute(name) { delete this[name]; }
  getBoundingClientRect() { return { width: 100 }; }
  scrollIntoView() {}
  focus() { this.document.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === '[data-orgao]') return Object.hasOwn(this.dataset, 'orgao');
    if (selector === '[data-orgao-admin]') return Object.hasOwn(this.dataset, 'orgaoAdmin');
    if (selector === '[data-aba]') return Object.hasOwn(this.dataset, 'aba');
    if (selector === '[data-admin]') return Object.hasOwn(this.dataset, 'admin');
    if (selector === '[data-login-only]') return Object.hasOwn(this.dataset, 'loginOnly');
    if (selector === '[data-export-format]') return Object.hasOwn(this.dataset, 'exportFormat');
    if (selector === '[role="menuitem"]') return this.role === 'menuitem';
    return this.tagName === selector.toUpperCase();
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/);
    let nodes = [this];
    for (const part of parts) nodes = nodes.flatMap(node => node.descendants().filter(child => child.matches(part)));
    return nodes;
  }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }
  dispatch(type, event = {}) {
    return this.events.get(type)?.map(listener => listener({ target: this, preventDefault() {}, ...event })) || [];
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'BUTTON') this.focus();
    if (this.tagName === 'A') this.document.downloads.push(this.download);
    else this.dispatch('click');
  }
}

class Fragment extends Node {
  constructor(document) { super(document, '#fragment'); }
}

class Document {
  constructor() {
    this.elements = new Map();
    this.body = new Node(this, 'body');
    this.head = new Node(this, 'head');
    this.activeElement = null;
    this.downloads = [];
    this.events = new Map();
  }
  add(id, tagName = 'div') {
    const element = new Node(this, tagName);
    element.id = id;
    this.elements.set(id, element);
    return element;
  }
  getElementById(id) { return this.elements.get(id) || null; }
  createElement(tagName) { return new Node(this, tagName); }
  createElementNS(_, tagName) { return this.createElement(tagName); }
  createDocumentFragment() { return new Fragment(this); }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }
  querySelector(selector) {
    if (selector === '#processTable tbody') return this.getElementById('processTableBody');
    if (selector === '#resultTable tbody') return this.getElementById('resultTableBody');
    if (selector === '#julgadosTable tbody') return this.getElementById('julgadosTableBody');
    return this.body.querySelector(selector);
  }
  querySelectorAll(selector) {
    if (selector === '#pillsContainer .excluded') return this.getElementById('pillsContainer').querySelectorAll('.excluded');
    if (selector === '[data-sessao]') return [];
    return this.body.querySelectorAll(selector);
  }
}

const wait = () => new Promise(resolve => setImmediate(resolve));
const source = file => readFileSync(new URL(`../assets/js/${file}`, import.meta.url), 'utf8');

function supabaseApp(fetch, itensIniciais = {}, apiSubstituta = null) {
  const document = new Document();
  const ouvintes = new Map();
  const window = {
    addEventListener(tipo, ouvinte) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
      ouvintes.get(tipo).push(ouvinte);
    }
  };
  const navigator = {};
  const navegacoes = [];
  const location = {
    protocol: 'http:',
    replace(destino) { navegacoes.push(destino); }
  };
  const storage = new Map(Object.entries(itensIniciais));
  const sessionStorage = {
    getItem(chave) { return storage.get(chave) ?? null; },
    setItem(chave, valor) { storage.set(chave, String(valor)); },
    removeItem(chave) { storage.delete(chave); }
  };
  const codigo = apiSubstituta
    ? `${source('supabase.js').replace('async function api(', 'async function apiOriginal(')}\nconst api = apiSubstituta;`
    : source('supabase.js');
  const app = new Function('document', 'window', 'navigator', 'location', 'sessionStorage', 'fetch', 'apiSubstituta',
    `${codigo}\nreturn {
      autenticar, salvarSessao, restaurarSessao, encerrarSessao, revogarSessaoAtual, sair, api, ligarLogin,
      buscarOrgaosAutorizados: typeof buscarOrgaosAutorizados === 'function' ? buscarOrgaosAutorizados : undefined,
      aplicarVisibilidadePorOrgao: typeof aplicarVisibilidadePorOrgao === 'function' ? aplicarVisibilidadePorOrgao : undefined,
      erroSemPermissao: typeof erroSemPermissao === 'function' ? erroSemPermissao : undefined,
      CADEIRAS_CJ, rotularCadeira, criarIndicadorCarregamento, aguardarIndicador,
      alternarBotaoCarregando, redirecionarSemTransicao,
      estadoSessao: () => ({ accessToken, refreshToken })
    };`)(document, window, navigator, location, sessionStorage, fetch, apiSubstituta);
  return { ...app, document, navegacoes, storage,
    dispararPagereveal: evento => ouvintes.get('pagereveal')?.forEach(ouvinte => ouvinte(evento)) };
}

function paginaServidaComBundles(fetch) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="(assets\/js\/(?:supabase|bootstrap)\.min\.js)\?v=[^"]+"><\/script>/g)]
    .map(([, caminho]) => caminho);
  assert.deepEqual(scripts, [
    'assets/js/supabase.min.js',
    'assets/js/bootstrap.min.js'
  ], 'index.html deve servir supabase antes do bootstrap');

  const document = new Document();
  document.body.dataset.page = 'acervo-cj';
  const sessionLoading = document.add('sessionLoading', 'div');
  sessionLoading.hidden = true;
  document.add('loginScreen', 'div');
  document.add('loginForm', 'form');
  document.add('loginEmail', 'input');
  document.add('loginSenha', 'input');
  document.add('loginErro', 'div');
  document.add('btnEntrar', 'button');
  document.add('btnSair', 'button');
  const controleCj = document.createElement('button');
  controleCj.dataset.orgao = 'CJ';
  const controleCreg = document.createElement('button');
  controleCreg.dataset.orgao = 'CREG';
  document.body.append(controleCj, controleCreg);

  const navegacoes = [];
  const app = new Function('document', 'window', 'navigator', 'location', 'sessionStorage', 'fetch',
    `${scripts.map(caminho => readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')).join('\n')}\nreturn {
      buscarOrgaosAutorizados: typeof buscarOrgaosAutorizados === 'function' ? buscarOrgaosAutorizados : undefined,
      aplicarVisibilidadePorOrgao: typeof aplicarVisibilidadePorOrgao === 'function' ? aplicarVisibilidadePorOrgao : undefined,
      resolverDestinoPermitido: typeof resolverDestinoPermitido === 'function' ? resolverDestinoPermitido : undefined,
      carregarPaginaAutenticada
    };`) (
    document, { inicializarAcervo() {}, addEventListener() {} }, {},
    { replace(destino) { navegacoes.push(destino); } },
    { getItem() { return null; }, setItem() {}, removeItem() {} }, fetch);

  return { app, controleCj, controleCreg, document, navegacoes };
}

// O de-para das cadeiras mora no supabase.js, que toda página carrega antes do
// seu próprio script. As telas o enxergam como global; aqui ele é injetado, e
// vem do arquivo de verdade para que uma divergência apareça como falha.
const { CADEIRAS_CJ, rotularCadeira, criarIndicadorCarregamento, aguardarIndicador,
        alternarBotaoCarregando } = supabaseApp(async () => {});

function indexPage({ api = async () => null, aviso = () => {},
  supabaseUrl = 'url', supabaseKey = 'key', token = 'token' } = {}) {
  const document = new Document();
  const blobs = [];
  const add = (id, tag) => document.add(id, tag);
  const tbody = add('processTableBody', 'tbody');
  add('resultTableBody', 'tbody');
  ['numRows', 'createRows', 'sortear', 'addRowBtn', 'btnCreg', 'btnCj', 'btnVoltar',
    'modeSelector', 'sorteadorContent', 'thRecurso', 'thInteressado', 'pillsContainer', 'txtModo',
    'processEntry', 'processSetupHint', 'processFormMessage', 'resultadoSorteio',
    'sortControls', 'resumoContagem', 'resultadoStatus', 'thUnidadeResult',
    'modeSelectorTitle', 'resultadoSorteioTitle', 'baixarBackup',
    'cardRegistrarPendencias', 'pendenciasBadge'].forEach(id => add(id, id.includes('Btn') || id.startsWith('btn') || id === 'createRows' || id === 'sortear' || id === 'baixarBackup' ? 'button' : 'div'));
  document.getElementById('sorteadorContent').hidden = true;
  document.getElementById('processEntry').hidden = true;
  document.getElementById('sortear').hidden = true;
  document.getElementById('resultadoSorteio').hidden = true;
  document.getElementById('pendenciasBadge').hidden = true;
  document.getElementById('numRows').value = '3';

  const app = new Function('document', 'window', 'crypto', 'URL', 'Blob', 'setTimeout', 'requestAnimationFrame',
    'SUPABASE_URL', 'SUPABASE_KEY', 'accessToken', 'api', 'criarIndicadorCarregamento', 'alternarBotaoCarregando', 'aviso',
    'CADEIRAS_CJ', 'rotularCadeira',
    `${source('index.js')}\nreturn { inicializarSorteio, avisarPendenciasDeJulgamento };`)(
    document, { matchMedia: () => ({ matches: true }) }, { getRandomValues: values => values.fill(0) },
    { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} }, Blob, () => 0,
    callback => callback(), supabaseUrl, supabaseKey, token, api,
    () => document.createElement('div'), () => {}, aviso, CADEIRAS_CJ, rotularCadeira);
  return { document, tbody, blobs, ...app };
}

async function preencherCreg(page, numero, recurso = 'Com recurso') {
  const { document, tbody } = page;
  document.getElementById('btnCreg').dispatch('click');
  document.getElementById('numRows').value = '1';
  document.getElementById('createRows').dispatch('click');
  await wait();

  const row = tbody.children[0];
  row.querySelector('.num').textContent = '1';
  row.querySelector('.col-processo input').value = numero;
  row.querySelector('.col-assunto select').value = 'Auto de Infração';
  row.querySelector('.col-decisao select').value = recurso;
}

async function preencherCj(page) {
  const { document, tbody } = page;
  document.getElementById('btnCj').dispatch('click');
  document.getElementById('numRows').value = '5';
  document.getElementById('createRows').dispatch('click');
  await wait();

  tbody.children.forEach((row, indice) => {
    row.querySelector('.num').textContent = String(indice + 1);
    row.querySelector('.col-processo input').value = `20260002900${String(indice + 1).padStart(4, '0')}`;
    row.querySelector('.col-decisao select').value = indice % 2 === 0 ? 'Sim' : 'Não';
  });
}

function julgadosPage(registrar) {
  const document = new Document();
  const add = (id, tag) => document.add(id, tag);
  ['listaPautas', 'pautasContainer', 'semPendencia', 'pautasIntro', 'detalhePauta',
    'tituloPauta', 'contadorPendentes', 'btnSalvar', 'btnVoltar', 'txtModo',
    'listaPautasTitulo', 'btnVoltarInicio', 'btnTodosManter', 'btnTodosJulgado'].forEach(id => add(id, id.startsWith('btn') ? 'button' : 'div'));
  const tbody = add('julgadosTableBody', 'tbody');

  const app = new Function('document', 'api', 'aviso', 'alternarBotaoCarregando', 'criarIndicadorCarregamento',
    'rotularCadeira',
    `${source('julgados.js')}\nreturn { abrirPauta, salvar, inicializarJulgados, pendentesPorPauta };`)(
    document, registrar, () => {}, () => {}, () => document.createElement('div'), rotularCadeira);
  return { document, tbody, ...app };
}

test('não gera linhas para quantidade decimal', async () => {
  const { document, tbody } = indexPage();
  document.getElementById('btnCreg').dispatch('click');
  document.getElementById('numRows').value = '1.5';
  document.getElementById('createRows').dispatch('click');
  await wait();

  assert.equal(tbody.children.length, 0);
  assert.equal(document.getElementById('processFormMessage').hidden, false);
});

test('não adiciona a 501ª linha', async () => {
  const { document, tbody } = indexPage();
  document.getElementById('btnCreg').dispatch('click');
  document.getElementById('numRows').value = '500';
  document.getElementById('createRows').dispatch('click');
  await wait();

  document.getElementById('addRowBtn').dispatch('click');

  assert.equal(tbody.children.length, 500);
});

test('linhas de CJ e CREG começam com o prefixo editável do processo', async () => {
  for (const modo of ['Cj', 'Creg']) {
    const { document, tbody } = indexPage();
    document.getElementById(`btn${modo}`).dispatch('click');
    document.getElementById('numRows').value = '1';
    document.getElementById('createRows').dispatch('click');
    await wait();
    document.getElementById('addRowBtn').dispatch('click');

    for (const row of tbody.children) {
      const processo = row.querySelector('.col-processo input');
      assert.equal(processo.value, '20260002900');
      assert.equal(processo.disabled, false);
      assert.equal(processo.getAttribute('readonly'), null);
    }
  }
});

test('oferece backup após falha sem baixá-lo automaticamente', async () => {
  const avisos = [];
  const page = indexPage({
    api: async () => { throw new Error('rede indisponível'); },
    aviso: (...args) => avisos.push(args)
  });
  const { document } = page;
  await preencherCreg(page, '202600029000401');
  document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(document.downloads.length, 1);
  assert.match(document.downloads[0], /^Sorteio_CREG_\d{2}\.\d{2}\.\d{4}\.doc$/);
  assert.equal(document.getElementById('baixarBackup').hidden, false);
  assert.doesNotMatch(avisos.at(-1)[0], /foi baixado/i);

  document.getElementById('baixarBackup').click();
  assert.equal(document.downloads[1], document.downloads[0].replace(/\.doc$/, '.json'));
  assert.equal(document.activeElement, document.getElementById('btnVoltar'));
});

test('sem banco configurado também exige clique para baixar o backup', async () => {
  const avisos = [];
  const page = indexPage({
    supabaseUrl: '',
    aviso: (...args) => avisos.push(args)
  });
  const { document } = page;
  await preencherCreg(page, '202600029000402', 'Sem recurso');
  document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(document.downloads.length, 1);
  assert.match(document.downloads[0], /^Sorteio_CREG_\d{2}\.\d{2}\.\d{4}\.doc$/);
  assert.equal(document.getElementById('baixarBackup').hidden, false);
  assert.match(avisos.at(-1)[0], /pronto para baixar/i);
});

test('erro 401 não desmonta o sorteio nem força logout', async () => {
  const page = indexPage({
    api: async () => {
      throw Object.assign(new Error('não foi possível renovar a sessão'), { status: 401 });
    }
  });
  const { document } = page;
  await preencherCreg(page, '202600029000403');
  document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(document.getElementById('sorteadorContent').hidden, false);
  assert.equal(document.getElementById('resultadoSorteio').hidden, false);
  assert.equal(document.getElementById('baixarBackup').hidden, false);
  assert.equal(document.getElementById('btnVoltar').hidden, false);
  document.getElementById('baixarBackup').click();
  assert.equal(document.downloads[1], document.downloads[0].replace(/\.doc$/, '.json'));
});

test('bloqueia Voltar enquanto a persistência ainda pode responder', async () => {
  let rejeitar;
  const page = indexPage({
    api: () => new Promise((_, reject) => { rejeitar = reject; })
  });
  const { document } = page;
  await preencherCreg(page, '202600029000404');
  document.getElementById('sortear').dispatch('click');

  const voltar = document.getElementById('btnVoltar');
  assert.equal(voltar.disabled, true);
  voltar.click();
  assert.equal(document.getElementById('sorteadorContent').hidden, false);
  assert.equal(document.getElementById('modeSelector').hidden, true);

  rejeitar(new Error('rede indisponível'));
  await wait();
  assert.equal(voltar.disabled, false);
  assert.equal(document.getElementById('baixarBackup').hidden, false);
});

test('interessado do CREG chega ao banco; a CJ não tem a coluna', async () => {
  let corpo;
  const page = indexPage({ api: async (_tabela, opcoes) => { corpo = JSON.parse(opcoes.body); } });
  const { document, tbody } = page;
  await preencherCreg(page, '202600029000405');
  tbody.children[0].querySelector('.col-interessado input').value = '  Saneago  ';
  document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(corpo[0].interessado, 'Saneago');

  const cj = indexPage();
  cj.document.getElementById('btnCj').dispatch('click');
  cj.document.getElementById('numRows').value = '1';
  cj.document.getElementById('createRows').dispatch('click');
  await wait();
  assert.equal(cj.tbody.children[0].querySelector('.col-interessado input'), null);
  assert.equal(cj.document.getElementById('thInteressado').hidden, true);
});

test('interessado em branco vai como nulo, e não como texto vazio', async () => {
  let corpo;
  const page = indexPage({ api: async (_tabela, opcoes) => { corpo = JSON.parse(opcoes.body); } });
  await preencherCreg(page, '202600029000406');
  page.document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(corpo[0].interessado, null);
});

test('CREG recusa processo sem 15 dígitos antes do sorteio', async () => {
  const { document, tbody } = indexPage();
  document.getElementById('btnCreg').dispatch('click');
  document.getElementById('numRows').value = '1';
  document.getElementById('createRows').dispatch('click');
  await wait();

  const row = tbody.children[0];
  row.querySelector('.col-processo input').value = '1234';
  row.querySelector('.col-assunto select').value = 'Requerimento';
  row.querySelector('.col-decisao select').value = 'Não se aplica';
  document.getElementById('sortear').dispatch('click');

  assert.equal(document.getElementById('processFormMessage').hidden, false);
  assert.match(document.getElementById('processFormMessage').textContent, /15 dígitos/);
  assert.equal(document.activeElement, row.querySelector('.col-processo input'));
});

test('autenticação envia credenciais e devolve o par de tokens', async () => {
  let requisicao;
  const app = supabaseApp(async (url, options) => {
    requisicao = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-de-teste', refresh_token: 'refresh-de-teste' })
    };
  });

  assert.deepEqual(await app.autenticar('servidora@example.org', 'senha'), {
    access_token: 'access-de-teste', refresh_token: 'refresh-de-teste'
  });
  assert.match(requisicao.url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.deepEqual(JSON.parse(requisicao.options.body), {
    email: 'servidora@example.org', password: 'senha'
  });
});

test('consulta permissões no banco e aceita somente CJ e CREG sem duplicar', async () => {
  const pedidos = [];
  const page = supabaseApp(async () => {}, {}, async (caminho, opcoes) => {
    pedidos.push([caminho, opcoes]);
    return [{ orgao: 'CREG' }, { orgao: 'CJ' }, { orgao: 'CREG' }, { orgao: 'X' }];
  });

  assert.equal(typeof page.buscarOrgaosAutorizados, 'function');
  assert.deepEqual([...await page.buscarOrgaosAutorizados()].sort(), ['CJ', 'CREG']);
  assert.equal(pedidos[0][0], 'rpc/orgaos_autorizados');
  assert.equal(pedidos[0][1].method, 'POST');
  assert.equal(pedidos[0][1].body, '{}');
});

test('consulta de permissões vazia nega todos os órgãos', async () => {
  const page = supabaseApp(async () => {}, {}, async () => []);

  assert.equal(typeof page.buscarOrgaosAutorizados, 'function');
  assert.deepEqual([...await page.buscarOrgaosAutorizados()], []);
});

test('resposta ilegível na consulta de permissões falha em vez de negar acesso', async () => {
  // api() devolve null quando o corpo de um 200 não é JSON. Tratar isso como
  // conjunto vazio deslogaria um usuário autorizado por uma falha de
  // transporte; o erro leva à tela com "Tentar novamente".
  const page = supabaseApp(async () => {}, {}, async () => null);

  assert.equal(typeof page.buscarOrgaosAutorizados, 'function');
  await assert.rejects(() => page.buscarOrgaosAutorizados(),
    /não foi possível verificar suas permissões/i);
});

test('falha ao consultar permissões é propagada', async () => {
  const falha = new Error('rede indisponível');
  const page = supabaseApp(async () => {}, {}, async () => { throw falha; });

  assert.equal(typeof page.buscarOrgaosAutorizados, 'function');
  await assert.rejects(() => page.buscarOrgaosAutorizados(), falha);
});

test('visibilidade por permissões oculta somente os controles não autorizados', () => {
  const page = supabaseApp(async () => {});
  assert.equal(typeof page.aplicarVisibilidadePorOrgao, 'function');
  const controleCreg = page.document.createElement('button');
  controleCreg.dataset.orgao = 'CREG';
  const controleCj = page.document.createElement('button');
  controleCj.dataset.orgao = 'CJ';
  const controleSemOrgao = page.document.createElement('button');
  page.document.body.append(controleCreg, controleCj, controleSemOrgao);

  page.aplicarVisibilidadePorOrgao(new Set(['CREG']), page.document);
  assert.equal(controleCreg.hidden, false);
  assert.equal(controleCj.hidden, true);
  assert.equal(controleSemOrgao.hidden, false);

  page.aplicarVisibilidadePorOrgao(new Set(['CJ', 'CREG']), page.document);
  assert.equal(controleCreg.hidden, false);
  assert.equal(controleCj.hidden, false);
});

test('grupo com um colegiado só vira coluna única para centralizar o botão', () => {
  const page = supabaseApp(async () => {});
  const grupo = page.document.createElement('div');
  grupo.className = 'buttons-wrapper';
  const botaoCreg = page.document.createElement('button');
  botaoCreg.dataset.orgao = 'CREG';
  const botaoCj = page.document.createElement('button');
  botaoCj.dataset.orgao = 'CJ';
  grupo.append(botaoCreg, botaoCj);
  page.document.body.append(grupo);

  page.aplicarVisibilidadePorOrgao(new Set(['CREG']), page.document);
  assert.equal(grupo.classList.contains('single-choice'), true);

  page.aplicarVisibilidadePorOrgao(new Set(['CJ', 'CREG']), page.document);
  assert.equal(grupo.classList.contains('single-choice'), false);
});

test('erro sem permissão é identificado para bloquear usuário sem órgãos', () => {
  const page = supabaseApp(async () => {});

  assert.equal(typeof page.erroSemPermissao, 'function');
  const erro = page.erroSemPermissao();

  assert.equal(erro.status, 403);
  assert.equal(erro.semPermissao, true);
  assert.match(erro.message, /não possui acesso liberado/i);
});

test('HTML servido executa os bundles minificados de autorização por órgão', async () => {
  const requisicoes = [];
  const page = paginaServidaComBundles(async (url, options) => {
    requisicoes.push({ url, options });
    return { ok: true, status: 200, json: async () => [{ orgao: 'CREG' }] };
  });

  assert.equal(typeof page.app.buscarOrgaosAutorizados, 'function');
  assert.deepEqual([...await page.app.buscarOrgaosAutorizados()], ['CREG']);
  assert.match(requisicoes[0].url, /\/rpc\/orgaos_autorizados$/);
  assert.equal(typeof page.app.aplicarVisibilidadePorOrgao, 'function');
  page.app.aplicarVisibilidadePorOrgao(new Set(['CREG']));
  assert.equal(page.controleCj.hidden, true);
  assert.equal(page.controleCreg.hidden, false);
  assert.equal(page.app.resolverDestinoPermitido('acervo-cj', new Set(['CREG'])), './acervo-creg.html');

  await page.app.carregarPaginaAutenticada();

  assert.deepEqual(page.navegacoes, ['./acervo-creg.html']);
  assert.equal(page.document.head.children.length, 0, 'o bundle proibido não pode ser carregado');
});

test('401 renova a sessão, conserva a tela e repete a chamada', async () => {
  const requisicoes = [];
  const app = supabaseApp(async (url, options) => {
    requisicoes.push({ url, options });
    if (url.includes('grant_type=refresh_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-novo', refresh_token: 'refresh-novo' })
      };
    }
    if (options.headers.Authorization === 'Bearer access-antigo') {
      return { ok: false, status: 401 };
    }
    return { ok: true, status: 200, json: async () => ([{ id: 1 }]) };
  });
  app.salvarSessao({ access_token: 'access-antigo', refresh_token: 'refresh-antigo' });

  assert.deepEqual(await app.api('dados'), [{ id: 1 }]);
  assert.equal(requisicoes.length, 3);
  assert.match(requisicoes[1].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.deepEqual(JSON.parse(requisicoes[1].options.body), { refresh_token: 'refresh-antigo' });
  assert.equal(requisicoes[2].options.headers.Authorization, 'Bearer access-novo');
  assert.deepEqual(app.estadoSessao(), {
    accessToken: 'access-novo', refreshToken: 'refresh-novo'
  });
  assert.equal(app.storage.get('sorteio-sei.access-token'), 'access-novo');
  assert.equal(app.storage.get('sorteio-sei.refresh-token'), 'refresh-novo');
});

test('chamadas simultâneas compartilham uma única renovação', async () => {
  let renovacoes = 0;
  const app = supabaseApp(async (url, options) => {
    if (url.includes('grant_type=refresh_token')) {
      renovacoes++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-novo', refresh_token: 'refresh-novo' })
      };
    }
    if (options.headers.Authorization === 'Bearer access-antigo') {
      return { ok: false, status: 401 };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  app.salvarSessao({ access_token: 'access-antigo', refresh_token: 'refresh-antigo' });

  const respostas = await Promise.all([app.api('um'), app.api('dois')]);

  assert.deepEqual(respostas, [{ ok: true }, { ok: true }]);
  assert.equal(renovacoes, 1, 'refresh token rotacionado não pode ser reutilizado em paralelo');
});

test('falha ao renovar não apaga a sessão automaticamente', async () => {
  const app = supabaseApp(async (url) => {
    if (url.includes('grant_type=refresh_token')) {
      return { ok: false, status: 400, json: async () => ({ message: 'refresh inválido' }) };
    }
    return { ok: false, status: 401 };
  });
  app.salvarSessao({ access_token: 'access-antigo', refresh_token: 'refresh-antigo' });

  await assert.rejects(() => app.api('dados'), { status: 401 });
  assert.deepEqual(app.estadoSessao(), {
    accessToken: 'access-antigo', refreshToken: 'refresh-antigo'
  });
  assert.equal(app.storage.get('sorteio-sei.access-token'), 'access-antigo');
  assert.equal(app.storage.get('sorteio-sei.refresh-token'), 'refresh-antigo');
});

test('saída manual apaga os dois tokens da sessão', () => {
  const app = supabaseApp(async () => {});
  app.salvarSessao({ access_token: 'access', refresh_token: 'refresh' });

  app.encerrarSessao();

  assert.deepEqual(app.estadoSessao(), { accessToken: '', refreshToken: '' });
  assert.equal(app.storage.has('sorteio-sei.access-token'), false);
  assert.equal(app.storage.has('sorteio-sei.refresh-token'), false);
});

test('saída manual revoga a sessão atual antes de apagar os tokens locais', async () => {
  let requisicao;
  let concluirLogout;
  const resposta = new Promise(resolve => { concluirLogout = resolve; });
  const app = supabaseApp(async (url, options) => {
    requisicao = { url, options };
    return resposta;
  });
  app.salvarSessao({ access_token: 'access-atual', refresh_token: 'refresh-atual' });

  const logout = app.sair();

  assert.equal(app.estadoSessao().accessToken, 'access-atual',
    'os tokens precisam existir até o servidor receber a revogação');
  assert.match(requisicao.url, /\/auth\/v1\/logout\?scope=local$/);
  assert.equal(requisicao.options.method, 'POST');
  assert.equal(requisicao.options.headers.Authorization, 'Bearer access-atual');
  assert.ok(requisicao.options.headers.apikey);

  concluirLogout({ ok: true, status: 204 });
  await logout;

  assert.deepEqual(app.estadoSessao(), { accessToken: '', refreshToken: '' });
  assert.equal(app.storage.has('sorteio-sei.access-token'), false);
  assert.equal(app.storage.has('sorteio-sei.refresh-token'), false);
});

test('falha de rede no logout ainda apaga os tokens locais', async () => {
  const app = supabaseApp(async () => {
    throw new Error('sem rede');
  });
  app.salvarSessao({ access_token: 'access', refresh_token: 'refresh' });

  await assert.rejects(() => app.sair(), /sem rede/);

  assert.deepEqual(app.estadoSessao(), { accessToken: '', refreshToken: '' });
  assert.equal(app.storage.size, 0);
});

test('botão sair sempre substitui a página atual pelo login inicial', async () => {
  const app = supabaseApp(async () => ({ ok: true, status: 204 }), {
    'sorteio-sei.access-token': 'access',
    'sorteio-sei.refresh-token': 'refresh'
  });
  ['loginScreen', 'loginForm', 'loginEmail', 'loginSenha', 'loginErro'].forEach(id => {
    app.document.add(id, id === 'loginForm' ? 'form' : 'div');
  });
  app.document.add('btnEntrar', 'button').textContent = 'Entrar';
  const btnSair = app.document.add('btnSair', 'button');
  btnSair.textContent = 'Sair';

  app.ligarLogin(async () => {});
  btnSair.click();
  await wait();

  assert.deepEqual(app.navegacoes, ['./index.html']);
  assert.deepEqual(app.estadoSessao(), { accessToken: '', refreshToken: '' });
  assert.equal(app.storage.size, 0);
});

test('autenticação traduz credencial inválida sem expor resposta técnica', async () => {
  const app = supabaseApp(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error_description: 'Invalid login credentials' })
  }));

  await assert.rejects(() => app.autenticar('x@example.org', 'errada'), {
    message: 'E-mail ou senha inválidos.'
  });
});

test('envia apenas o julgamento que foi alterado', async () => {
  let enviado;
  const page = julgadosPage(async (path, options) => {
    if (path === 'rpc/registrar_votos') {
      enviado = JSON.parse(options.body).itens;
      return 1;
    }
    return [];
  });
  page.pendentesPorPauta.set('1|2026-08-21', [
    { id: 1, num_processo: '123', relator: 'CJ1', voto: 'Manter', status: '' },
    { id: 2, num_processo: '456', relator: 'CJ2', voto: '', status: '' }
  ]);
  page.abrirPauta('1|2026-08-21');

  const alterado = page.tbody.children[1].querySelector('.col-status select');
  alterado.value = 'Julgado';
  page.tbody.dispatch('change', { target: alterado });

  await page.salvar();

  assert.deepEqual(enviado, [{ id: 2, voto: '', status: 'Julgado' }]);
});

test('julgados revela o conselheiro no hover da cadeira', () => {
  // A coluna mostra "CJ1"; sem o de-para a secretaria teria de decorar o
  // número da cadeira. Relator fora do de-para (composição anterior, que ficou
  // pelo nome) não pode ganhar title vazio.
  const page = julgadosPage(async () => []);
  page.pendentesPorPauta.set('1|2026-08-21', [
    { id: 1, num_processo: '123', relator: 'CJ1', voto: '', status: '' },
    { id: 2, num_processo: '456', relator: 'Conselheiro De Antes', voto: '', status: '' }
  ]);
  page.abrirPauta('1|2026-08-21');

  const relator = linha => page.tbody.children[linha].children[1];
  assert.equal(relator(0).textContent, 'CJ1');
  assert.equal(relator(0).title, 'Paulo Otoni Ribeiro');
  assert.equal(relator(0)['aria-label'], 'CJ1 — Paulo Otoni Ribeiro');
  assert.equal(relator(1).textContent, 'Conselheiro De Antes');
  assert.equal(relator(1).title, undefined, 'title repetindo o rótulo é ruído');
});

test('preenche em massa só o que está em branco e marca a linha para salvar', async () => {
  let enviado;
  const page = julgadosPage(async (path, options) => {
    if (path === 'rpc/registrar_votos') {
      enviado = JSON.parse(options.body).itens;
      return 2;
    }
    return [];
  });
  page.pendentesPorPauta.set('1|2026-08-21', [
    { id: 1, num_processo: '123', relator: 'CJ1', voto: '', status: '' },
    { id: 2, num_processo: '456', relator: 'CJ2', voto: '', status: '' }
  ]);
  page.abrirPauta('1|2026-08-21');

  // Exceção escolhida à mão antes do clique: o botão não pode sobrescrever.
  const excecao = page.tbody.children[1].querySelector('.col-voto select');
  excecao.value = 'Anular';
  page.tbody.dispatch('change', { target: excecao });

  page.document.getElementById('btnTodosManter').click();
  page.document.getElementById('btnTodosJulgado').click();

  assert.equal(page.tbody.children[0].querySelector('.col-voto select').value, 'Manter');
  assert.equal(excecao.value, 'Anular');
  assert.equal(page.document.getElementById('contadorPendentes').textContent, 'Todos preenchidos.');

  await page.salvar();

  assert.deepEqual(enviado, [
    { id: 1, voto: 'Manter', status: 'Julgado' },
    { id: 2, voto: 'Anular', status: 'Julgado' }
  ]);
});

test('move o foco para o cadastro ao escolher uma modalidade', () => {
  const { document } = indexPage();
  document.getElementById('btnCreg').dispatch('click');

  assert.equal(document.activeElement, document.getElementById('numRows'));
});

test('move o foco para a modalidade após o login', () => {
  const page = indexPage();
  page.inicializarSorteio();

  assert.equal(page.document.activeElement, page.document.getElementById('modeSelectorTitle'));
});

test('avisa no card de pendências quando há julgados sem voto ou status', async () => {
  const page = indexPage({
    api: async caminho => caminho.includes('julgados_cj')
      ? [{ id: 1 }, { id: 2 }]
      : [{ id: 3 }]
  });
  await page.avisarPendenciasDeJulgamento();

  const card = page.document.getElementById('cardRegistrarPendencias');
  const badge = page.document.getElementById('pendenciasBadge');
  assert.equal(card.classList.contains('tem-pendencia'), true);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '3 pendentes');
  assert.equal(badge.getAttribute('aria-label'), '3 sessões aguardando voto e status');
});

test('sem pendência, o card de julgamento fica sem aviso', async () => {
  const page = indexPage({ api: async () => [] });
  await page.avisarPendenciasDeJulgamento();

  const card = page.document.getElementById('cardRegistrarPendencias');
  const badge = page.document.getElementById('pendenciasBadge');
  assert.equal(card.classList.contains('tem-pendencia'), false);
  assert.equal(badge.hidden, true);
});

test('falha ao checar pendências não quebra a tela, só fica sem o selo', async () => {
  const page = indexPage({ api: async () => { throw new Error('rede'); } });
  await page.avisarPendenciasDeJulgamento();

  const card = page.document.getElementById('cardRegistrarPendencias');
  assert.equal(card.classList.contains('tem-pendencia'), false);
});

test('move o foco para o título da pauta ao abri-la', () => {
  const page = julgadosPage(async () => []);
  page.pendentesPorPauta.set('1|2026-08-21', [
    { id: 1, num_processo: '123', relator: 'CJ1', voto: '', status: '' }
  ]);
  page.abrirPauta('1|2026-08-21');

  assert.equal(page.document.activeElement, page.document.getElementById('tituloPauta'));
});

test('move o foco para a lista após o login', async () => {
  const page = julgadosPage(async () => []);
  page.inicializarJulgados();
  await wait();

  assert.equal(page.document.activeElement, page.document.getElementById('listaPautasTitulo'));
});

// ── Painel do acervo ─────────────────────────────────────────────────────────
// As colunas do painel saem do dado, não do HTML: quem decide quais relatores
// aparecem é a função resumo_acervo_cj. Estes testes fixam esse contrato e os
// três estados da tela — matriz, vazio e falha.

function bootstrapPage(inicializar, pagina = 'acervo-cj', {
  buscarOrgaos = async () => new Set([pagina.endsWith('creg') ? 'CREG' : 'CJ']),
  aplicarVisibilidade = () => {},
  erroPermissao = () => Object.assign(new Error('sem permissão'), { semPermissao: true }),
  encerrarSessaoNoServidor = async () => {},
  carregar = async () => {},
  location = { replace() {} },
  // O papel de administrador: só a tela inicial e o painel o consultam.
  buscarAdmin = async () => new Set(),
  aplicarVisibilidadeAdmin = () => {}
} = {}) {
  const document = new Document();
  document.body.dataset.page = pagina;
  const sessionLoading = document.add('sessionLoading', 'div');
  sessionLoading.hidden = true;
  const loginScreen = document.add('loginScreen', 'div');
  loginScreen.hidden = true;
  const loginErro = document.add('loginErro', 'div');
  const btnSair = document.add('btnSair', 'button');
  btnSair.hidden = false;
  let aoEntrar;
  // As chaves são os data-page do <body>, os mesmos de PAGINAS no bootstrap.js.
  const inicializadores = {
    sorteio: 'inicializarSorteio',
    'julgados-cj': 'inicializarJulgados',
    'julgados-creg': 'inicializarJulgadosCreg',
    'acervo-cj': 'inicializarAcervo',
    'acervo-creg': 'inicializarAcervo',
    'historico-cj': 'inicializarHistorico',
    'historico-creg': 'inicializarHistorico'
  };

  const app = new Function('document', 'window', 'location', 'ASSET_VERSION', 'carregarScript',
    'criarIndicadorCarregamento', 'ligarLogin', 'buscarOrgaosAutorizados',
    'aplicarVisibilidadePorOrgao', 'erroSemPermissao', 'sair', 'redirecionarSemTransicao',
    'buscarOrgaosAdministrados', 'aplicarVisibilidadeAdmin',
    `${source('bootstrap.js')}\nreturn {
      resolverDestinoPermitido: typeof resolverDestinoPermitido === 'function' ? resolverDestinoPermitido : undefined,
      carregarPaginaAutenticada
    };`)(
    document, { [inicializadores[pagina]]: inicializar }, location, 'teste', carregar,
    texto => { const estado = document.createElement('div'); estado.textContent = texto; return estado; },
    callback => { aoEntrar = callback; }, buscarOrgaos, aplicarVisibilidade, erroPermissao,
    encerrarSessaoNoServidor, destino => location.replace(destino),
    buscarAdmin, aplicarVisibilidadeAdmin);

  return { ...app, document, sessionLoading, loginScreen, loginErro, btnSair, iniciar: () => aoEntrar() };
}

// O carregamento geral cobre o que acontece antes de a tela existir: a consulta
// de permissões e o download do script dela. As telas de julgados eram exceção
// — mostram o andamento dentro da própria lista — mas essa lista só é montada
// DEPOIS da consulta, e no intervalo a página ficava literalmente vazia.
test('julgados também mostra o carregamento geral até a permissão voltar', async () => {
  let responder;
  const page = bootstrapPage(async () => {}, 'julgados-cj', {
    buscarOrgaos: () => new Promise(resolve => { responder = resolve; })
  });

  const carregamento = page.iniciar();
  await wait();
  assert.equal(page.sessionLoading.hidden, false,
    'sem isto a transição entre páginas aterrissa numa página em branco');
  assert.equal(page.sessionLoading.children.length, 1);

  responder(new Set(['CJ']));
  await carregamento;
  assert.equal(page.sessionLoading.hidden, true,
    'a lista de pautas assume o andamento a partir daqui');
  assert.equal(page.sessionLoading.children.length, 0);
});

// Um `location.replace` é correção de rota, não destino: animá-lo daria a uma
// parada técnica a cerimônia de uma troca de página, e quem cai nela veria dois
// cross-fades e dois indicadores para uma intenção só.
test('redirecionamento por permissão não anima a troca de página', () => {
  const app = supabaseApp(async () => {});

  app.redirecionarSemTransicao('./acervo-cj.html');
  assert.deepEqual(app.navegacoes, ['./acervo-cj.html']);
  assert.equal(app.storage.get('sorteio-sei.pular-transicao'), '1',
    'a marca precisa atravessar a navegação: quem a lê é o documento seguinte');

  let puladas = 0;
  const evento = () => ({ viewTransition: { skipTransition() { puladas++; } } });
  app.dispararPagereveal(evento());
  assert.equal(puladas, 1, 'o documento seguinte cancela a transição já preparada');
  assert.equal(app.storage.get('sorteio-sei.pular-transicao'), undefined,
    'a marca é de uso único');

  app.dispararPagereveal(evento());
  assert.equal(puladas, 1, 'uma navegação normal continua animando');
});

test('sem suporte a transição de página o redirecionamento não quebra', () => {
  const app = supabaseApp(async () => {});
  app.redirecionarSemTransicao('./historico-creg.html');
  // Firefox ainda não faz transição entre documentos: `pagereveal` chega sem
  // viewTransition, e o redirecionamento não pode depender dela para funcionar.
  assert.doesNotThrow(() => app.dispararPagereveal({}));
  assert.deepEqual(app.navegacoes, ['./historico-creg.html']);
});

test('redireciona páginas de órgão para o equivalente permitido', () => {
  const page = bootstrapPage(async () => {});

  assert.equal(typeof page.resolverDestinoPermitido, 'function');
  assert.equal(page.resolverDestinoPermitido('acervo-cj', new Set(['CREG'])), './acervo-creg.html');
  assert.equal(page.resolverDestinoPermitido('julgados-creg', new Set(['CJ'])), './julgados-cj.html');
  assert.equal(page.resolverDestinoPermitido('historico-cj', new Set(['CREG'])), './historico-creg.html');
  assert.equal(page.resolverDestinoPermitido('acervo-cj', new Set(['CJ', 'CREG'])), null);
  assert.equal(page.resolverDestinoPermitido('sorteio', new Set(['CJ'])), null);
});

test('autoriza antes de carregar o módulo da página', async () => {
  let responder;
  let scriptsCarregados = 0;
  const page = bootstrapPage(async () => {}, 'acervo-cj', {
    buscarOrgaos: () => new Promise(resolve => { responder = resolve; }),
    carregar: async () => { scriptsCarregados++; }
  });

  const carregamento = page.iniciar();
  await wait();
  assert.equal(typeof responder, 'function', 'o gate deve iniciar a consulta de permissões');
  assert.equal(scriptsCarregados, 0, 'não pode carregar módulo antes da autorização');

  responder(new Set(['CJ']));
  await carregamento;
  assert.equal(scriptsCarregados, 1);
});

test('redireciona URL proibida sem carregar seu módulo', async () => {
  const destinos = [];
  let scriptsCarregados = 0;
  const page = bootstrapPage(async () => {}, 'historico-cj', {
    buscarOrgaos: async () => new Set(['CREG']),
    carregar: async () => { scriptsCarregados++; },
    location: { replace(destino) { destinos.push(destino); } }
  });

  await page.iniciar();

  assert.deepEqual(destinos, ['./historico-creg.html']);
  assert.equal(scriptsCarregados, 0);
});

test('nega usuário sem órgãos, revoga a sessão e não carrega o módulo', async () => {
  let encerrou = 0;
  let scriptsCarregados = 0;
  const page = bootstrapPage(async () => {}, 'acervo-cj', {
    buscarOrgaos: async () => new Set(),
    encerrarSessaoNoServidor: async () => { encerrou++; },
    carregar: async () => { scriptsCarregados++; }
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await page.iniciar();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(encerrou, 1, 'a negativa deve revogar a sessão no servidor, não só apagá-la da aba');
  assert.equal(page.loginScreen.hidden, false);
  assert.equal(page.btnSair.hidden, true);
  assert.match(page.loginErro.textContent, /sem permissão/i);
  assert.equal(scriptsCarregados, 0);
});

test('falha ao consultar permissões preserva a sessão e permite tentar novamente', async () => {
  let tentativas = 0;
  let encerrou = 0;
  let scriptsCarregados = 0;
  const page = bootstrapPage(async () => {}, 'acervo-cj', {
    buscarOrgaos: async () => {
      tentativas++;
      if (tentativas === 1) throw new Error('rede indisponível');
      return new Set(['CJ']);
    },
    encerrarSessaoNoServidor: async () => { encerrou++; },
    carregar: async () => { scriptsCarregados++; }
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await page.iniciar();
    assert.equal(page.sessionLoading.children.length, 1,
      'falha de rede deve manter o estado de carregamento com retentativa');
    const tentarNovamente = page.sessionLoading.children[0].children[1];
    assert.equal(tentarNovamente.textContent, 'Tentar novamente');
    tentarNovamente.click();
    await wait();
    await wait();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(encerrou, 0);
  assert.equal(page.loginScreen.hidden, true);
  assert.equal(page.btnSair.hidden, false);
  assert.equal(scriptsCarregados, 1);
});

test('a navegação por órgão marca os oito controles relevantes', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const controles = [...html.matchAll(/<(?:button|a)\b[^>]*(?:id="btn(?:Creg|Cj)"|href="\.\/(?:acervo|historico|julgados)-(?:cj|creg)\.html")[^>]*>/g)]
    .map(([controle]) => controle);
  const orgaos = controles.map(controle => controle.match(/data-orgao="(CJ|CREG)"/)?.[1]);

  assert.equal(controles.length, 8);
  assert.equal(orgaos.filter(orgao => orgao === 'CJ').length, 4);
  assert.equal(orgaos.filter(orgao => orgao === 'CREG').length, 4);
  assert.equal(orgaos.every(Boolean), true, 'nenhum destino CJ/CREG pode ficar sem data-orgao');
});

// A entrega do andamento é um bastão, não um cobertor: o carregamento geral
// cobre o que existe antes da tela (permissão, download do script) e passa a
// vez no instante em que o inicializador monta a moldura da tela — o que os
// quatro fazem de forma síncrona, antes de buscar dado algum. Segurá-lo além
// disso deixaria dois indicadores na tela ao mesmo tempo.
test('o carregamento geral passa a vez assim que a tela monta a própria moldura', async () => {
  for (const pagina of ['sorteio', 'julgados-cj', 'acervo-cj', 'historico-cj']) {
    let concluir;
    let visivelQuandoATelaMontou = null;
    // A função roda dentro de page.iniciar(), quando `page` já existe.
    const page = bootstrapPage(() => {
      // Aqui dentro é o instante em que a tela monta a moldura dela.
      visivelQuandoATelaMontou = !page.sessionLoading.hidden;
      return new Promise(resolve => { concluir = resolve; });
    }, pagina);
    const carregamento = page.iniciar();
    await wait();

    assert.equal(page.sessionLoading.hidden, true,
      `${pagina}: o indicador geral não pode competir com o da própria tela`);
    assert.equal(page.sessionLoading.children.length, 0, pagina);

    concluir();
    await carregamento;
    assert.equal(page.sessionLoading.hidden, true, pagina);
    assert.equal(visivelQuandoATelaMontou, true,
      `${pagina}: o indicador geral precisa estar na tela até a moldura existir`);
  }
});

test('julgados recupera o loading geral para apresentar falha de inicialização', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const page = bootstrapPage(async () => { throw new Error('indisponível'); }, 'julgados-cj');
    await page.iniciar();

    assert.equal(page.sessionLoading.hidden, false);
    assert.equal(page.sessionLoading.children[0].role, 'alert');
  } finally {
    console.error = originalConsoleError;
  }
});

function acervoPage(api, { imprimir = () => {}, colegiado = 'cj' } = {}) {
  const document = new Document();
  document.body.dataset.colegiado = colegiado;
  const loginOnlyCard = document.createElement('div');
  loginOnlyCard.dataset.loginOnly = '';
  document.body.append(loginOnlyCard);
  ['acervoPanel', 'acervoVazio', 'acervoTotal', 'acervoAtualizado']
    .forEach(id => document.add(id, 'div'));
  const erroDiv = document.add('acervoErro', 'div');
  erroDiv.appendChild(document.createElement('p'));
  document.add('acervoTable', 'table');
  document.add('btnAtualizar', 'button');
  const exportMenu = document.add('exportMenu', 'div');
  exportMenu.hidden = true;
  const btnExportar = document.add('btnExportar', 'button');
  const rotuloExportar = document.createElement('span');
  rotuloExportar.className = 'export-label';
  btnExportar.append(rotuloExportar);
  const exportOptions = document.add('exportOptions', 'div');
  exportOptions.hidden = true;
  for (const formato of ['pdf', 'excel']) {
    const opcao = document.createElement('button');
    opcao.setAttribute('role', 'menuitem');
    opcao.dataset.exportFormat = formato;
    exportOptions.append(opcao);
  }
  document.add('exportFeedback', 'div');
  document.add('btnTentarNovamente', 'button');

  // O card de detalhe. <dialog> nativo no navegador; aqui o mínimo que o código
  // usa — showModal/close/open — para o teste exercitar a lógica, não a API.
  const dialog = document.add('detalheDialog', 'dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  document.add('detalheTitulo', 'h2');
  document.add('detalheResumo', 'p');
  const detalheLoading = document.add('detalheLoading', 'div');
  detalheLoading.hidden = true;
  document.add('detalheCorpo', 'div');
  document.add('detalheTable', 'table');
  const detalheErro = document.add('detalheErro', 'div');
  detalheErro.hidden = true;
  detalheErro.appendChild(document.createElement('p'));
  document.add('btnFecharDetalhe', 'button');
  document.add('btnExportarDetalhe', 'button');
  const painelCarregando = document.add('painelCarregando', 'div');
  painelCarregando.hidden = true;
  // A tabela e seu contêiner rolável: a moldura entra antes dos dados e é este
  // contêiner que sai do ar enquanto o indicador ocupa o lugar dele.
  const tabelaScroll = document.createElement('div');
  tabelaScroll.className = 'table-scroll';
  document.body.append(tabelaScroll);
  document.getElementById('acervoPanel').hidden = true;
  document.getElementById('btnAtualizar').hidden = true;  // como no acervo-cj.html

  const app = new Function('document', 'window', 'api', 'criarIndicadorCarregamento', 'aguardarIndicador',
    `${source('acervo.js')}\nreturn { inicializarAcervo, carregarAcervo, exportar, criarExcel, criarExcelDetalhe, dadosTabulares, abrirDetalhe, exportarDetalhe };`)(
    document, { print: imprimir }, api, criarIndicadorCarregamento, aguardarIndicador);
  return { document, loginOnlyCard, dialog, painelCarregando, tabelaScroll, ...app };
}

const celulas = linha => linha.children.map(c => c.textContent);

test('acervo monta as colunas a partir dos relatores que o banco devolve', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ3', conselheiro: 'Dorivan de Souza Lima', processos: 3 },
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro', processos: 22 },
    { ordem: 2, faixa: 'Até 30 dias', relator: 'CJ3', conselheiro: 'Dorivan de Souza Lima', processos: 1 },
    { ordem: 2, faixa: 'Até 30 dias', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro', processos: 0 }
  ]);
  page.inicializarAcervo();
  await wait();

  const tabela = page.document.getElementById('acervoTable');
  const [thead, tbody, tfoot] = tabela.children;

  assert.deepEqual(celulas(thead.children[0]),
    ['Período', 'CJ1', 'CJ3', 'Total'],
    'o cabeçalho não veio das cadeiras do banco');

  assert.deepEqual(celulas(tbody.children[0]), ['Até 15 dias', '22', '3', '25']);
  // Zero vira travessão: coluna de "0" repetido esconde o número que importa.
  assert.deepEqual(celulas(tbody.children[1]), ['Até 30 dias', '—', '1', '1']);
  assert.deepEqual(celulas(tfoot.children[0]), ['Total', '22', '4', '26']);
  assert.equal(tbody.children[0].children[1].classList.contains('acervo-detalhe'), true,
    'célula numérica precisa expor o estado individual de hover');
  // Na linha "Até 30 dias" o travessão é a CJ1 (zero), primeira coluna de dado.
  assert.equal(tbody.children[1].children[1].classList.contains('acervo-detalhe'), false,
    'travessão não representa uma lista de processos para detalhar');
  assert.equal(tfoot.children[0].children[3].classList.contains('acervo-detalhe'), true,
    'o total geral também precisa expor o estado de hover');
  assert.equal(page.document.getElementById('acervoTotal').textContent,
    '26 processos aguardando julgamento');
  assert.equal(page.loginOnlyCard.hidden, true,
    'o cartão de autenticação precisa sair do layout depois do login');
  assert.equal(page.document.getElementById('btnAtualizar')['aria-busy'], undefined,
    'o botão não pode permanecer ocupado depois da resposta');
  assert.equal(page.document.getElementById('acervoPanel')['aria-busy'], undefined,
    'o painel não pode permanecer ocupado depois da resposta');
});

// A moldura do painel entra antes dos dados, e a tabela só depois. Quem decide
// isso é a transição entre páginas: ela entrega o quadro que existir no
// primeiro render, e um spinner centralizado numa página em branco é uma sala
// de espera onde deveria haver chegada. O painel com nome — título, escopo,
// rodapé — é um destino; a tabela preenche depois, dentro dele.
test('acervo entrega a moldura do painel antes dos dados, e a tabela só depois', async () => {
  let responder;
  const page = acervoPage(() => new Promise(resolve => { responder = resolve; }));
  const inicializacao = page.inicializarAcervo();
  await wait();

  assert.equal(page.document.getElementById('acervoPanel').hidden, false,
    'a moldura do painel é o que a transição entre páginas entrega');
  assert.equal(page.loginOnlyCard.hidden, true,
    'o loading geral sai: quem indica andamento agora é o indicador do painel');
  assert.equal(page.painelCarregando.hidden, false);
  assert.equal(page.painelCarregando.children[0].children[1].textContent, 'Carregando o acervo…');
  assert.equal(page.tabelaScroll.hidden, true,
    'a tabela fica fora do ar enquanto o indicador ocupa o lugar dela');
  assert.equal(page.document.getElementById('btnAtualizar').hidden, true,
    'Atualizar redesenharia uma tabela que ainda não existe');
  assert.equal(page.document.getElementById('exportMenu').hidden, true);

  responder([
    { ordem: 1, faixa: 'Até 15 dias', relator: 'Dorivan de Souza Lima', processos: 1 }
  ]);
  await inicializacao;

  assert.equal(page.painelCarregando.hidden, true);
  assert.equal(page.painelCarregando.children.length, 0);
  assert.equal(page.tabelaScroll.hidden, false);
  assert.equal(page.document.getElementById('acervoPanel').hidden, false);
  assert.equal(page.document.getElementById('btnAtualizar').hidden, false);
  assert.equal(page.document.getElementById('exportMenu').hidden, false);
});

test('acervo não oferece Atualizar antes de o painel existir', async () => {
  // Revelado cedo demais, o botão redesenha uma tabela ainda escondida: o
  // clique "funciona", nada muda na tela e a mensagem de erro continua lá.
  const page = acervoPage(async () => { throw new Error('rede fora'); });

  await assert.rejects(page.inicializarAcervo(), /rede fora/);
  assert.equal(page.document.getElementById('btnAtualizar').hidden, true);
});

test('falha inicial permanece no carregamento geral sem revelar painel incompleto', async () => {
  const page = acervoPage(async () => { throw new Error('rede fora'); });

  await assert.rejects(page.inicializarAcervo(), /rede fora/);
  assert.equal(page.document.getElementById('acervoPanel').hidden, true);
  assert.equal(page.loginOnlyCard.hidden, false);
  assert.equal(page.document.getElementById('btnAtualizar').disabled, false,
    'o botão de atualizar precisa voltar ao estado normal depois da falha');
});

test('acervo mantém o total vermelho desde Há 3 meses, inclusive quando zerado', async () => {
  const page = acervoPage(async () => [
    { ordem: 3, faixa: 'Até 45 dias', relator: 'Dorivan de Souza Lima', processos: 1 },
    { ordem: 4, faixa: 'Há 3 meses', relator: 'Dorivan de Souza Lima', processos: 2 },
    { ordem: 5, faixa: 'Entre 3 e 6 meses', relator: 'Dorivan de Souza Lima', processos: 0 }
  ]);
  page.inicializarAcervo();
  await wait();

  const linhas = page.document.getElementById('acervoTable').children[1].children;
  assert.equal(linhas[0].children[2].classList.contains('acervo-alerta'), false,
    'a faixa anterior a Há 3 meses deve manter o total verde');
  assert.equal(linhas[1].children[1].classList.contains('acervo-alerta'), false,
    'a célula do relator deve continuar branca');
  assert.equal(linhas[1].children[2].classList.contains('acervo-alerta'), true,
    'o total de Há 3 meses deve iniciar o vermelho permanente');
  assert.equal(linhas[1].children[2].classList.contains('acervo-detalhe'), true,
    'o alerta também deve preservar o hover do futuro detalhamento');
  assert.match(linhas[1].children[2]['aria-label'], /Alerta: 2 processos/);
  assert.doesNotMatch(linhas[1].children[2]['aria-label'], /ver os processos/,
    'o alerta rotula a célula; a ação rotula o botão — juntos viram uma frase só');
  assert.equal(linhas[2].children[2].classList.contains('acervo-alerta'), true,
    'faixa crítica zerada deve permanecer vermelha');
  assert.equal(linhas[2].children[2].classList.contains('acervo-detalhe'), false,
    'faixa zerada não deve sugerir detalhamento disponível');
  assert.equal(linhas[2].children[2]['aria-label'], undefined,
    'faixa zerada não deve anunciar uma ocorrência inexistente');
});

test('acervo propaga falha inicial sem forçar logout', async () => {
  const page = acervoPage(async () => {
    throw Object.assign(new Error('sessão expirada'), { status: 401 });
  });
  await assert.rejects(() => page.inicializarAcervo(), { status: 401 });

  assert.equal(page.document.getElementById('acervoErro').hidden, true,
    'o loading geral é quem apresenta a falha inicial sem desmontar a sessão');
});

test('acervo avisa quando não há processo parado', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ3', conselheiro: 'Dorivan de Souza Lima', processos: 0 }
  ]);
  page.inicializarAcervo();
  await wait();

  assert.equal(page.document.getElementById('acervoVazio').hidden, false);
  assert.equal(page.document.getElementById('acervoTotal').textContent,
    '0 processos aguardando julgamento');
});

test('acervo revela o conselheiro no hover da coluna', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro', processos: 2 },
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ5', conselheiro: 'Lorena Patricia de Oliveira', processos: 1 }
  ]);
  await page.inicializarAcervo();
  await wait();

  const [th1, th5] = page.document.getElementById('acervoTable')
    .children[0].children[0].children.slice(1, 3);
  assert.equal(th1.textContent, 'CJ1');
  assert.equal(th1.title, 'Paulo Otoni Ribeiro', 'a cadeira sozinha não diz quem é');
  assert.equal(th1['aria-label'], 'CJ1 — Paulo Otoni Ribeiro');
  assert.equal(th5.title, 'Lorena Patricia de Oliveira');
});

test('acervo não inventa hover quando a cadeira não tem de-para', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ9', conselheiro: 'CJ9', processos: 1 }
  ]);
  await page.inicializarAcervo();
  await wait();

  const th = page.document.getElementById('acervoTable').children[0].children[0].children[1];
  assert.equal(th.textContent, 'CJ9');
  assert.equal(th.title, undefined, 'title repetindo o rótulo é ruído');
});

test('Exportar abre um menu acessível com PDF e Excel', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', processos: 2 }
  ]);
  await page.inicializarAcervo();

  const botao = page.document.getElementById('btnExportar');
  const menu = page.document.getElementById('exportOptions');
  assert.equal(botao.disabled, false);
  botao.click();
  assert.equal(menu.hidden, false);
  assert.equal(botao['aria-expanded'], 'true');
  assert.equal(page.document.activeElement, menu.children[0],
    'o primeiro formato deve receber foco quando o menu abre');

  menu.dispatch('click', { target: menu.children[0] });
  assert.equal(menu.hidden, true);
  assert.equal(page.document.activeElement, botao,
    'o foco deve voltar ao botão depois que uma opção fecha o menu');
});

test('Excel representa a matriz atual em colunas e gera um XLSX real', async () => {
  const linhas = [
    { ordem: 1, faixa: 'Até & 15 dias', relator: 'CJ2', processos: 0 },
    { ordem: 1, faixa: 'Até & 15 dias', relator: 'CJ1', processos: 3 },
    { ordem: 4, faixa: 'Há 3 meses', relator: 'CJ2', processos: 4 },
    { ordem: 4, faixa: 'Há 3 meses', relator: 'CJ1', processos: 1 }
  ];
  const page = acervoPage(async () => linhas);
  await page.inicializarAcervo();

  assert.deepEqual(page.dadosTabulares(linhas), [
    ['Período', 'CJ1', 'CJ2', 'Total'],
    ['Até & 15 dias', 3, 0, 3],
    ['Há 3 meses', 1, 4, 5],
    ['Total', 4, 4, 8]
  ]);

  const arquivo = page.criarExcel(linhas);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const texto = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'XLSX precisa ser um pacote ZIP');
  assert.equal(arquivo.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(texto, /xl\/worksheets\/sheet1\.xml/);
  assert.match(texto, /ATÉ &amp; 15 DIAS/, 'rótulo deve manter o conteúdo e seguir a caixa alta do dashboard');
  assert.match(texto, /Acervo de processos - CJ/,
    'o título precisa dizer de qual colegiado é a planilha');
  assert.match(texto, /Visão gerencial do tempo de permanência/);
  assert.match(texto, /<t>8 processos aguardando julgamento<\/t>/,
    'o resumo não repete a data que a última linha já traz');
  assert.equal(texto.match(/Atualizado em:/g).length, 1,
    'a data de atualização aparece uma vez só na planilha');
  assert.match(texto, /showGridLines="0"/);
  assert.match(texto, /mergeCells count="4"/);
  assert.ok(texto.indexOf('<autoFilter ') < texto.indexOf('<mergeCells '),
    'autoFilter deve preceder mergeCells no schema OOXML aceito pelo Excel');
  assert.match(texto, /orientation="landscape" fitToWidth="1"/);
  assert.match(texto, /<c r="D5" s="7"><f>SUM\(B5:C5\)<\/f><v>3<\/v><\/c>/,
    'total da faixa deve ser fórmula com o verde claro do dashboard');
  assert.match(texto, /<c r="D6" s="8"><f>SUM\(B6:C6\)<\/f><v>5<\/v><\/c>/,
    'faixa crítica deve preservar o alerta vermelho do dashboard');
  // O estilo do total comum (7) e o do total crítico (8) precisam apontar para
  // a mesma borda: antes o comum usava a borda clara das células de contagem e
  // só as faixas críticas ganhavam o contorno escuro da coluna.
  const estilos = [...texto.matchAll(/<xf [^>]*borderId="(\d+)"[^>]*>(?:(?!<\/xf>).)*<\/xf>/g)].map(m => m[1]);
  assert.equal(estilos[7], estilos[8],
    'a coluna Total precisa da mesma borda em toda a sua altura');
  assert.match(texto, /<c r="B7" s="10"><f>SUM\(B5:B6\)<\/f><v>4<\/v><\/c>/,
    'rodapé deve ser auditável por fórmula');
  for (const cor of ['FF00534B', 'FF00453E', 'FFE0F0E8', 'FFF4DEDB', 'FFE9F3EF', 'FFBFE3D1']) {
    assert.match(texto, new RegExp(cor), `a paleta do dashboard precisa incluir ${cor}`);
  }
  assert.match(texto, /name val="Montserrat"/);
});

test('Excel do CREG se identifica e concorda com o nome do colegiado', async () => {
  const linhas = [{ ordem: 1, faixa: 'Até 15 dias', unidade: 'CREG1', processos: 1 }];
  const page = acervoPage(async () => linhas, { colegiado: 'creg' });
  await page.inicializarAcervo();

  const texto = new TextDecoder().decode(new Uint8Array(await page.criarExcel(linhas).arrayBuffer()));
  assert.match(texto, /Acervo de processos - CREG/,
    'o título precisa dizer de qual colegiado é a planilha');
  // 'à Câmara' e 'ao Conselho' não saem do mesmo molde: o subtítulo saía com a
  // preposição do CJ na planilha do CREG.
  assert.match(texto, /distribuídos ao Conselho Regulador\./);
  assert.doesNotMatch(texto, /distribuídos à Conselho/);
  assert.match(texto, /<t>1 processo aguardando julgamento<\/t>/,
    'um processo só não vira "1 processos"');
});

test('PDF usa o dashboard atual sem deixar mensagem de sucesso persistente', async () => {
  let impresso = 0;
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', processos: 2 }
  ], { imprimir: () => { impresso++; } });
  await page.inicializarAcervo();

  const geracao = page.exportar('pdf');
  assert.equal(page.document.getElementById('btnExportar')['aria-busy'], 'true');
  assert.equal(page.document.getElementById('btnExportar').querySelector('.export-label').textContent,
    'Gerando PDF…');
  assert.equal(page.document.getElementById('exportFeedback').textContent, '');
  await geracao;

  assert.equal(impresso, 1);
  assert.equal(page.document.getElementById('exportFeedback').textContent, '');
  assert.equal(page.document.getElementById('btnExportar').querySelector('.export-label').textContent,
    'Exportar');
  assert.equal(page.document.getElementById('btnExportar')['aria-busy'], undefined);
});

test('falha de exportação mostra uma mensagem clara e libera o botão', async () => {
  const page = acervoPage(async () => [
    { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', processos: 2 }
  ], { imprimir: () => { throw new Error('impressão bloqueada'); } });
  await page.inicializarAcervo();
  await page.exportar('pdf');

  const feedback = page.document.getElementById('exportFeedback');
  assert.match(feedback.textContent, /Não foi possível gerar o arquivo.*impressão bloqueada/);
  assert.equal(feedback.dataset.state, 'error');
  assert.equal(feedback.role, 'alert');
  assert.equal(feedback['aria-live'], 'assertive');
  assert.equal(page.document.getElementById('btnExportar').disabled, false);
});

test('sorteio da CJ mostra a cadeira e o conselheiro no hover', () => {
  const { document } = indexPage();
  document.getElementById('btnCj').dispatch('click');

  const pills = document.getElementById('pillsContainer').children;
  assert.deepEqual(pills.map(p => p.textContent), ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5'],
    'o sorteio precisa gravar a cadeira, que é o que acervo_cj guarda');
  assert.equal(pills[0].title, 'Paulo Otoni Ribeiro');
  assert.equal(pills[1].title, 'Deusdete Cardoso Belém');
  assert.equal(pills[2].title, 'Dorivan de Souza Lima');
  assert.equal(pills[3].title, 'Paulo Henrique Oliveira Marques');
  assert.equal(pills[4].title, 'Lorena Patricia de Oliveira');
  assert.equal(pills[0]['aria-label'], 'CJ1 — Paulo Otoni Ribeiro',
    'o leitor de tela precisa anunciar a pessoa, não soletrar a cadeira');
});

// ── Resultado do sorteio ─────────────────────────────────────────────────────
test('resultado da CJ mostra o conselheiro abaixo de cada cadeira', async () => {
  const page = indexPage();
  await preencherCj(page);
  page.document.getElementById('sortear').dispatch('click');
  await wait();

  const nomesPorCadeira = {
    CJ1: 'Paulo Otoni Ribeiro',
    CJ2: 'Deusdete Cardoso Belém',
    CJ3: 'Dorivan de Souza Lima',
    CJ4: 'Paulo Henrique Oliveira Marques',
    CJ5: 'Lorena Patricia de Oliveira'
  };
  const destinos = page.document.getElementById('resultTableBody').children
    .map(row => row.querySelector('.sorteado-unidade'));
  assert.equal(destinos.length, 5);
  for (const destino of destinos) {
    assert.equal(destino.children.length, 2, 'cadeira e nome precisam de linhas visuais próprias');
    assert.equal(destino.children[1].textContent, nomesPorCadeira[destino.children[0].textContent]);
  }

  const badges = page.document.getElementById('resumoContagem').children[0].children;
  assert.equal(badges.length, 5);
  badges.forEach((badge, indice) => {
    const cadeira = `CJ${indice + 1}`;
    assert.equal(badge.children.length, 2);
    assert.equal(badge.children[0].textContent, `${cadeira}: 1 processo`);
    assert.equal(badge.children[1].textContent, nomesPorCadeira[cadeira]);
  });
});

test('ata do sorteio da CJ identifica cadeira e conselheiro', async () => {
  const page = indexPage();
  await preencherCj(page);
  page.document.getElementById('sortear').dispatch('click');
  await wait();

  const ata = await page.blobs[0].text();
  for (const destino of [
    'CJ1 — Paulo Otoni Ribeiro',
    'CJ2 — Deusdete Cardoso Belém',
    'CJ3 — Dorivan de Souza Lima',
    'CJ4 — Paulo Henrique Oliveira Marques',
    'CJ5 — Lorena Patricia de Oliveira'
  ]) assert.match(ata, new RegExp(destino));
});

test('resultado do CREG continua exibindo somente o código da unidade', async () => {
  const page = indexPage();
  await preencherCreg(page, '202600029000900');
  page.document.getElementById('sortear').dispatch('click');
  await wait();

  const destino = page.document.getElementById('resultTableBody').children[0]
    .querySelector('.sorteado-unidade');
  assert.match(destino.textContent, /^CREG[1-4]$/);
  assert.equal(destino.children.length, 0);
  const badges = page.document.getElementById('resumoContagem').children[0].children;
  assert.ok(badges.every(badge => /^CREG[1-4]: \d+ processos?$/.test(badge.textContent)));
  assert.ok(badges.every(badge => badge.children.length === 0));
});

// ── Card de detalhe ───────────────────────────────────────────────────────────────────────────────
// Clicar num bloco com número abre a lista daquele recorte. O que o teste fixa
// é o contrato com o banco: quais filtros o card pede em cada tipo de célula.
const matriz = [
  { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro', processos: 2 },
  { ordem: 1, faixa: 'Até 15 dias', relator: 'CJ5', conselheiro: 'Lorena Patricia de Oliveira', processos: 0 },
  { ordem: 4, faixa: 'Há 3 meses', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro', processos: 1 },
  { ordem: 4, faixa: 'Há 3 meses', relator: 'CJ5', conselheiro: 'Lorena Patricia de Oliveira', processos: 0 }
];

const processosFalsos = [
  { num_processo: '202600029001111', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro',
    data_distribuicao: '2026-06-29', dias: 56 },
  { num_processo: '202600029002222', relator: 'CJ1', conselheiro: 'Paulo Otoni Ribeiro',
    data_distribuicao: '2026-08-14', dias: 10 }
];

async function acervoComDetalhe(aoPedirDetalhe) {
  const pedidos = [];
  const page = acervoPage(async (caminho, opcoes) => {
    if (caminho.includes('processos_acervo_cj')) {
      pedidos.push(JSON.parse(opcoes.body));
      return aoPedirDetalhe ? aoPedirDetalhe() : processosFalsos;
    }
    return matriz;
  });
  await page.inicializarAcervo();
  await wait();
  return { ...page, pedidos };
}

const celulaDe = (page, linha, coluna) =>
  page.document.getElementById('acervoTable').children[1].children[linha].children[coluna];

test('bloco com número abre o card; bloco zerado não', async () => {
  const page = await acervoComDetalhe();
  const bloco = celulaDe(page, 0, 1);
  assert.equal(bloco.dataset.rotulo, 'Até 15 dias · CJ1');
  // A célula continua célula: quem vira botão é um filho dela. Com role="button"
  // no <td>, a linha deixa de ter células e o leitor de tela perde a contagem.
  assert.equal(bloco.getAttribute('role'), null, 'o <td> não pode trocar de papel');
  assert.equal(bloco.children.length, 1);
  assert.equal(bloco.children[0].tagName, 'BUTTON');
  assert.equal(bloco.children[0].textContent, '2', 'o botão carrega o número da célula');
  assert.equal(bloco.children[0]['aria-label'], 'Até 15 dias · CJ1: ver os processos');
  assert.equal(celulaDe(page, 0, 2).dataset.rotulo, undefined,
    'travessão não representa processo nenhum para listar');
});

test('cada tipo de célula pede o recorte certo ao banco', async () => {
  const page = await acervoComDetalhe();
  const tabela = page.document.getElementById('acervoTable');

  await page.abrirDetalhe(celulaDe(page, 0, 1));                       // célula
  await page.abrirDetalhe(celulaDe(page, 0, 3));                       // total da linha
  await page.abrirDetalhe(tabela.children[2].children[0].children[1]); // total da coluna
  await page.abrirDetalhe(tabela.children[2].children[0].children[3]); // total geral

  assert.deepEqual(page.pedidos, [
    { p_ordem: 1, p_relator: 'CJ1' },
    { p_ordem: 1, p_relator: null },
    { p_ordem: null, p_relator: 'CJ1' },
    { p_ordem: null, p_relator: null }
  ], 'nulo é "não filtre por isso" — é o que faz os totais serem clicáveis');
});

test('o card lista os processos e habilita a exportação', async () => {
  const page = await acervoComDetalhe();
  await page.abrirDetalhe(celulaDe(page, 0, 1));

  assert.equal(page.dialog.open, true, 'o card precisa abrir em modo modal');
  assert.equal(page.document.getElementById('detalheTitulo').textContent, 'Até 15 dias · CJ1');
  assert.match(page.document.getElementById('detalheResumo').textContent, /^2 processos/);

  const linhas = page.document.getElementById('detalheTable').children[1].children;
  assert.deepEqual(linhas.map(tr => tr.children.map(c => c.textContent)), [
    ['202600029001111', 'CJ1', '29/06/2026', '56'],
    ['202600029002222', 'CJ1', '14/08/2026', '10']
  ]);
  assert.equal(page.document.getElementById('btnExportarDetalhe').disabled, false);

  const cadeira = linhas[0].children[1];
  assert.equal(cadeira.title, 'Paulo Otoni Ribeiro');
  assert.equal(cadeira['aria-label'], 'CJ1 — Paulo Otoni Ribeiro',
    'só no title, o nome do conselheiro existe para o mouse e não para o leitor de tela');
});

test('o card fecha e a falha aparece dentro dele', async () => {
  const page = await acervoComDetalhe(() => { throw new Error('rede fora'); });
  await page.abrirDetalhe(celulaDe(page, 0, 1));

  assert.equal(page.dialog.open, true, 'fechar o card esconderia a mensagem de erro');
  const erro = page.document.getElementById('detalheErro');
  assert.equal(erro.hidden, false);
  assert.match(erro.children[0].textContent, /rede fora/);
  assert.equal(page.document.getElementById('btnExportarDetalhe').disabled, true,
    'não há o que exportar quando a lista não chegou');
});

test('falha de sessão mantém o card e mostra o erro sem deslogar', async () => {
  const page = await acervoComDetalhe(() => {
    throw Object.assign(new Error('sessão expirada'), { status: 401 });
  });
  await page.abrirDetalhe(celulaDe(page, 0, 1));

  assert.equal(page.dialog.open, true);
  assert.equal(page.document.getElementById('detalheErro').hidden, false);
  assert.match(page.document.getElementById('detalheErro').children[0].textContent, /sessão expirada/);
});

test('o Excel do card é um .xlsx válido com os processos', async () => {
  const page = await acervoComDetalhe();
  await page.abrirDetalhe(celulaDe(page, 0, 1));
  const blob = page.criarExcelDetalhe(processosFalsos, 'Até 15 dias · CJ1');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'assinatura ZIP');
  const texto = new TextDecoder().decode(bytes);
  assert.match(texto, /xl\/worksheets\/sheet1\.xml/);
  assert.match(texto, /202600029001111/, 'o número do processo precisa estar na planilha');
  assert.match(texto, /29\/06\/2026/, 'a data vai formatada, não como serial');
});

test('resposta atrasada não sobrescreve o card aberto depois dela', async () => {
  const pendentes = [];
  const page = await acervoComDetalhe(() => new Promise(resolve => pendentes.push(resolve)));

  const primeira = page.abrirDetalhe(celulaDe(page, 0, 1));  // Até 15 dias · CJ1
  const segunda = page.abrirDetalhe(celulaDe(page, 0, 3));   // Até 15 dias · todas as cadeiras

  pendentes[1]([]);                 // o segundo bloco responde primeiro
  await segunda;
  pendentes[0](processosFalsos);    // e o primeiro chega atrasado, depois dele
  await primeira;

  assert.match(page.document.getElementById('detalheResumo').textContent, /^0 processos/,
    'a lista tem de ser a do bloco que está no título, não a da resposta que chegou por último');
  assert.equal(page.document.getElementById('btnExportarDetalhe').disabled, true,
    'exportar aqui geraria um arquivo de um recorte que a pessoa não está vendo');
});

test('falha ao exportar o card avisa dentro do próprio card', async () => {
  const page = await acervoComDetalhe();
  await page.abrirDetalhe(celulaDe(page, 0, 1));

  const criar = page.document.createElement.bind(page.document);
  page.document.createElement = tag => {
    if (tag === 'a') throw new Error('download bloqueado');
    return criar(tag);
  };
  page.exportarDetalhe();

  const erro = page.document.getElementById('detalheErro');
  assert.equal(erro.hidden, false,
    'falha silenciosa é indistinguível de um download que o navegador engoliu');
  assert.match(erro.children[0].textContent, /Não foi possível gerar o arquivo.*download bloqueado/);
});

test('zero dias passados sai como 0 no Excel, não como o travessão do painel', async () => {
  const page = await acervoComDetalhe();
  const blob = page.criarExcelDetalhe([{ num_processo: '202600029003333', relator: 'CJ1',
    conselheiro: 'Paulo Otoni Ribeiro', data_distribuicao: '2026-08-24', dias: 0 }], 'Até 15 dias · CJ1');
  const xml = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

  // No painel o travessão significa "nenhum processo". Aqui o zero é um
  // processo distribuído hoje: reusar aquele formato apagaria a linha.
  const estilo = xml.match(/<c r="E5" s="(\d+)"><v>0<\/v><\/c>/)?.[1];
  assert.ok(estilo, 'a célula de dias passados precisa existir na linha do processo');
  const formatos = [...xml.match(/<cellXfs count="\d+">(.*?)<\/cellXfs>/)[1]
    .matchAll(/<xf numFmtId="(\d+)"/g)].map(m => m[1]);
  assert.equal(formatos[Number(estilo)], '3',
    'o formato 164 desenha zero como travessão; dias passados precisa do #,##0');
});

test('o card abre em estado de loading antes da resposta da API', async () => {
  let resolver;
  const promessa = new Promise(resolve => { resolver = resolve; });
  const page = await acervoComDetalhe(() => promessa);

  const abertura = page.abrirDetalhe(celulaDe(page, 0, 1));
  assert.equal(page.dialog.open, true, 'o modal precisa abrir imediatamente');
  assert.equal(page.document.getElementById('detalheLoading').hidden, false,
    'o indicador de loading do card deve estar visível');
  assert.equal(page.document.getElementById('detalheCorpo').hidden, true,
    'a tabela do card fica oculta durante o carregamento');
  assert.equal(page.document.getElementById('detalheLoading').children.length, 1);
  assert.equal(page.document.getElementById('detalheLoading').children[0].children[1].textContent,
    'Carregando processos…');

  resolver(processosFalsos);
  await abertura;

  assert.equal(page.document.getElementById('detalheLoading').hidden, true,
    'o indicador de loading sai quando os dados chegam');
  assert.equal(page.document.getElementById('detalheCorpo').hidden, false,
    'o corpo com a tabela entra após o carregamento');
});

// O indicador de carregamento é combinado com o CSS: entra em 150ms
// (spinner-fade-in) e, uma vez na tela, fica um tempo mínimo. Sem esse mínimo o
// card de uma consulta rápida — o do histórico, que pede uma rodada só —
// acendia e apagava o spinner no mesmo piscar, enquanto o do acervo, mais
// lento, o mostrava por inteiro: a mesma tela parecia ter animações
// diferentes.

test('resposta mais rápida que a entrada do indicador não atrasa o card', async () => {
  const inicio = Date.now();
  await aguardarIndicador(Date.now());
  assert.ok(Date.now() - inicio < 100,
    'nada chegou a aparecer na tela: esperar só atrasaria o card');
});

test('indicador que já apareceu fica o tempo mínimo antes de sair', async () => {
  const inicio = Date.now();
  // 200ms de consulta: passou dos 150ms da entrada, então o spinner está na
  // tela e some no meio da animação se o card não o segurar.
  await aguardarIndicador(Date.now() - 200);
  const espera = Date.now() - inicio;
  assert.ok(espera >= 300, `o indicador precisa completar o mínimo; esperou ${espera}ms`);
  assert.ok(espera < 700, `a espera não pode ultrapassar o mínimo; esperou ${espera}ms`);
});

test('indicador que já cumpriu o mínimo sai assim que os dados chegam', async () => {
  const inicio = Date.now();
  await aguardarIndicador(Date.now() - 5000);
  assert.ok(Date.now() - inicio < 100,
    'consulta longa já mostrou o indicador por tempo de sobra');
});

// ── Histórico de sorteios ────────────────────────────────────────────────────
// Uma tela por colegiado, como o painel do acervo. A lista vem pronta e
// ordenada do banco (historico_sorteios); esta tela desenha uma linha por
// rodada. Estes testes fixam esse contrato — a ordem, a rodada sem carimbo, o
// vocabulário de cada colegiado — e o recorte que cada linha pede ao abrir o
// card.

function historicoPage(api, colegiado = 'creg') {
  const document = new Document();
  document.body.dataset.colegiado = colegiado;
  const loginOnlyCard = document.createElement('div');
  loginOnlyCard.dataset.loginOnly = '';
  document.body.append(loginOnlyCard);
  ['historicoPanel', 'historicoVazio', 'historicoVazioTexto',
   'historicoTotal', 'historicoAtualizado'].forEach(id => document.add(id, 'div'));
  const erroDiv = document.add('historicoErro', 'div');
  erroDiv.appendChild(document.createElement('p'));
  document.add('historicoTable', 'table');
  document.add('btnAtualizar', 'button');
  document.add('btnTentarNovamente', 'button');

  const dialog = document.add('detalheDialog', 'dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  document.add('detalheTitulo', 'h2');
  document.add('detalheResumo', 'p');
  const detalheLoading = document.add('detalheLoading', 'div');
  detalheLoading.hidden = true;
  document.add('detalheCorpo', 'div');
  document.add('detalheTable', 'table');
  const detalheErro = document.add('detalheErro', 'div');
  detalheErro.hidden = true;
  detalheErro.appendChild(document.createElement('p'));
  document.add('btnFecharDetalhe', 'button');
  document.add('btnExportarDetalhe', 'button');
  const painelCarregando = document.add('painelCarregando', 'div');
  painelCarregando.hidden = true;
  // A tabela e seu contêiner rolável: a moldura entra antes dos dados e é este
  // contêiner que sai do ar enquanto o indicador ocupa o lugar dele.
  const tabelaScroll = document.createElement('div');
  tabelaScroll.className = 'table-scroll';
  document.body.append(tabelaScroll);
  document.getElementById('historicoPanel').hidden = true;
  document.getElementById('btnAtualizar').hidden = true;  // como nas páginas

  const app = new Function('document', 'api', 'criarIndicadorCarregamento', 'aguardarIndicador',
    `${source('historico.js')}\nreturn { inicializarHistorico, carregarHistorico, abrirDetalhe,
      criarDocxDetalhe, exportarDetalheDocx };`)(
    document, api, criarIndicadorCarregamento, aguardarIndicador);
  return { document, loginOnlyCard, dialog, painelCarregando, tabelaScroll, ...app };
}

// A série começa em 27/08/2026, para os dois colegiados: o primeiro sorteio
// feito na tela — os 81 processos do Conselho que processos_sorteados gravou e
// que hoje vivem em acervo_creg. Quem corta é o banco; aqui chega o resultado.
const sorteiosCreg = [
  { data_sorteio: '2026-08-27', sorteado_em: '2026-08-27T14:07:26.154+00:00',
    processos: 81, destinos: ['CREG2', 'CREG3', 'CREG4'], distribuicao: [
      { destino: 'CREG2', processos: 27 },
      { destino: 'CREG3', processos: 27 },
      { destino: 'CREG4', processos: 27 }
    ] }
];

// Rodadas posteriores ao marco. A segunda e a terceira vêm sem `sorteado_em`: a
// coluna é opcional no acervo, e uma carga em lote pode deixá-la vazia.
const sorteiosCj = [
  { data_sorteio: '2026-09-28', sorteado_em: '2026-09-28T17:32:00+00:00', processos: 34,
    destinos: ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5'], distribuicao: [
      { destino: 'CJ1', processos: 7 },
      { destino: 'CJ2', processos: 7 },
      { destino: 'CJ3', processos: 7 },
      { destino: 'CJ4', processos: 7 },
      { destino: 'CJ5', processos: 6 }
    ] },
  { data_sorteio: '2026-09-14', sorteado_em: null, processos: 54,
    destinos: ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5'] },
  { data_sorteio: '2026-08-31', sorteado_em: null, processos: 42,
    destinos: ['CJ2', 'CJ3', 'CJ4', 'CJ5'] }
];

const linhas = page => page.document.getElementById('historicoTable').children[1].children;

test('acervo and historico panels show the consultation time', async () => {
  const acervo = acervoPage(async () => [
    { ordem: 1, faixa: 'Faixa', relator: 'CJ1', processos: 1 }
  ]);
  const historico = historicoPage(async () => sorteiosCreg, 'creg');

  await acervo.inicializarAcervo();
  await historico.inicializarHistorico();

  const formatoAtualizacao = /^Atualizado em: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/;
  assert.match(acervo.document.getElementById('acervoAtualizado').textContent, formatoAtualizacao);
  assert.match(historico.document.getElementById('historicoAtualizado').textContent, formatoAtualizacao);
});

test('acervo detail and Excel exports show the consultation time', async () => {
  const dados = [{ ordem: 1, faixa: 'Faixa', relator: 'CJ1', processos: 1 }];
  const geral = acervoPage(async () => dados);
  await geral.inicializarAcervo();

  const detalhe = await acervoComDetalhe();
  await detalhe.abrirDetalhe(celulaDe(detalhe, 0, 1));

  const formatoAtualizacao = /Atualizado em: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/;
  assert.match(detalhe.document.getElementById('detalheResumo').textContent, formatoAtualizacao);

  const geralTexto = new TextDecoder().decode(new Uint8Array(
    await geral.criarExcel(dados).arrayBuffer()));
  assert.match(geralTexto, formatoAtualizacao);

  const detalheTexto = new TextDecoder().decode(new Uint8Array(
    await detalhe.criarExcelDetalhe(processosFalsos, 'Faixa - CJ1').arrayBuffer()));
  assert.match(detalheTexto, formatoAtualizacao);
});

const acaoDe = (page, linha) => linhas(page)[linha].children.at(-1).children[0];
const dataDe = linha => linha.children[0].children.map(s => s.textContent);
const destinosDe = linha => linha.children[3].querySelectorAll('.historico-destino').map(item => ({
  destino: item.querySelector('.historico-destino-sigla')?.textContent,
  processos: item.querySelector('.historico-destino-contagem')?.textContent
}));
const destinoBotaoDe = (linha, sigla) => linha.children[3].querySelectorAll('.historico-destino')
  .find(item => item.querySelector('.historico-destino-sigla')?.textContent === sigla);

test('histórico lista uma rodada por linha, na ordem que o banco devolveu', async () => {
  const page = historicoPage(async () => sorteiosCj, 'cj');
  await page.inicializarHistorico();

  const [thead] = page.document.getElementById('historicoTable').children;
  assert.deepEqual(celulas(thead.children[0]),
    ['Data', 'Horário', 'Processos', 'Cadeiras', 'Detalhes'],
    'na Câmara quem recebe o processo é a cadeira');

  assert.equal(linhas(page).length, 3);
  assert.deepEqual(dataDe(linhas(page)[0]), ['28/09/2026', 'Segunda-feira']);
  assert.deepEqual(dataDe(linhas(page)[2]), ['31/08/2026', 'Segunda-feira']);
  assert.equal(linhas(page)[0].children[2].textContent, '34');

  assert.equal(page.document.getElementById('historicoTotal').textContent,
    '3 sorteios · 130 processos');
});

test('no Conselho a coluna é a unidade, e o sorteio de 27/08 abre o histórico', async () => {
  const page = historicoPage(async () => sorteiosCreg, 'creg');
  await page.inicializarHistorico();

  const [thead] = page.document.getElementById('historicoTable').children;
  assert.deepEqual(celulas(thead.children[0]),
    ['Data', 'Horário', 'Processos', 'Unidades', 'Detalhes']);

  assert.equal(linhas(page).length, 1);
  assert.deepEqual(dataDe(linhas(page)[0]), ['27/08/2026', 'Quinta-feira']);
  assert.equal(linhas(page)[0].children[2].textContent, '81');
  assert.equal(page.document.getElementById('historicoTotal').textContent,
    '1 sorteio · 81 processos');
});

test('histórico mostra a quantidade de processos por destino em CREG e CJ', async () => {
  const creg = historicoPage(async () => sorteiosCreg, 'creg');
  await creg.inicializarHistorico();
  assert.deepEqual(destinosDe(linhas(creg)[0]), [
    { destino: 'CREG2', processos: '27' },
    { destino: 'CREG3', processos: '27' },
    { destino: 'CREG4', processos: '27' }
  ]);
  assert.equal(linhas(creg)[0].children[3].getAttribute('aria-label'),
    'CREG2: 27 processos; CREG3: 27 processos; CREG4: 27 processos');

  const cj = historicoPage(async () => sorteiosCj, 'cj');
  await cj.inicializarHistorico();
  assert.deepEqual(destinosDe(linhas(cj)[0]), [
    { destino: 'CJ1', processos: '7' },
    { destino: 'CJ2', processos: '7' },
    { destino: 'CJ3', processos: '7' },
    { destino: 'CJ4', processos: '7' },
    { destino: 'CJ5', processos: '6' }
  ]);
  assert.deepEqual(destinosDe(linhas(cj)[1]), [
    { destino: 'CJ1', processos: undefined },
    { destino: 'CJ2', processos: undefined },
    { destino: 'CJ3', processos: undefined },
    { destino: 'CJ4', processos: undefined },
    { destino: 'CJ5', processos: undefined }
  ], 'durante o rollout, a resposta antiga continua mostrando as cadeiras');
});

test('rodada sem carimbo mostra o dia sem inventar horário', async () => {
  const page = historicoPage(async () => sorteiosCj, 'cj');
  await page.inicializarHistorico();

  // A carimbada mostra hora e minuto, no relógio de quem lê.
  assert.match(linhas(page)[0].children[1].textContent, /^\d{2}:\d{2}$/);

  const hora = linhas(page)[1].children[1];
  assert.equal(hora.textContent, '—', 'sem carimbo, a coluna fica com o travessão');
  assert.equal(hora['aria-label'], 'Horário não registrado');
});

test('a tela diz de quando é a série, com a lista cheia ou vazia', async () => {
  // Sem essa frase, a Câmara — que ainda não sorteou depois do marco — abre uma
  // tela em branco que parece defeito, e quem procura um sorteio de julho não
  // descobre por que não o encontra.
  const vazia = historicoPage(async () => [], 'cj');
  await vazia.inicializarHistorico();
  const texto = vazia.document.getElementById('historicoVazioTexto').textContent;
  assert.match(texto, /a partir de 27\/08\/2026/);
  // Com o artigo: 'A Câmara' e 'O Conselho' não saem do mesmo molde, e sem ele
  // a frase começaria em "Câmara de Julgamento não distribuiu".
  assert.match(texto, /A Câmara de Julgamento não distribuiu/,
    'o vazio precisa dizer de qual colegiado é, com concordância');
  assert.equal(vazia.document.getElementById('historicoVazio').hidden, false);
  assert.equal(vazia.document.getElementById('historicoTable').children.length, 0,
    'sem rodada nenhuma, nem o cabeçalho da tabela deve sobrar');

  const cheia = historicoPage(async () => sorteiosCreg, 'creg');
  await cheia.inicializarHistorico();
  assert.match(cheia.document.getElementById('historicoVazioTexto').textContent,
    /O Conselho Regulador não distribuiu/);
  assert.equal(cheia.document.getElementById('historicoVazio').hidden, true);
});

test('cada página pede ao banco o histórico do seu colegiado', async () => {
  const pedidos = [];
  const registrar = async (caminho, opcoes) => {
    pedidos.push([caminho, JSON.parse(opcoes.body)]);
    return [];
  };
  await historicoPage(registrar, 'cj').inicializarHistorico();
  await historicoPage(registrar, 'creg').inicializarHistorico();

  assert.deepEqual(pedidos, [
    ['rpc/historico_sorteios', { p_colegiado: 'CJ' }],
    ['rpc/historico_sorteios', { p_colegiado: 'CREG' }]
  ]);
});

test('histórico entrega a moldura do painel antes dos dados, como o acervo', async () => {
  let responder;
  const page = historicoPage(() => new Promise(resolve => { responder = resolve; }), 'creg');
  const carregamento = page.inicializarHistorico();
  await wait();

  assert.equal(page.document.getElementById('historicoPanel').hidden, false);
  assert.equal(page.painelCarregando.hidden, false);
  assert.equal(page.painelCarregando.children[0].children[1].textContent, 'Carregando o histórico…');
  assert.equal(page.tabelaScroll.hidden, true);
  assert.equal(page.document.getElementById('btnAtualizar').hidden, true,
    'Atualizar redesenharia uma tabela que ainda não existe');

  responder(sorteiosCreg);
  await carregamento;

  assert.equal(page.loginOnlyCard.hidden, true);
  assert.equal(page.painelCarregando.hidden, true);
  assert.equal(page.tabelaScroll.hidden, false);
  assert.equal(page.document.getElementById('historicoPanel').hidden, false);
  assert.equal(page.document.getElementById('btnAtualizar').hidden, false);
});

test('histórico avisa quando o colegiado ainda não sorteou pelo sistema', async () => {
  const page = historicoPage(async () => []);
  await page.inicializarHistorico();

  assert.equal(page.document.getElementById('historicoVazio').hidden, false);
  assert.equal(page.document.getElementById('historicoTotal').textContent,
    '0 sorteios · 0 processos');
});

test('histórico propaga falha inicial sem forçar logout', async () => {
  const page = historicoPage(async () => { throw Object.assign(new Error('sessão'), { status: 401 }); });
  await assert.rejects(page.inicializarHistorico(), /sessão/);
  assert.equal(page.document.getElementById('historicoPanel').hidden, true,
    'a falha inicial fica com o carregamento geral, que sabe distinguir o 401');
});

test('falha ao atualizar não deixa o total anunciando uma tabela vazia', async () => {
  let falhar = false;
  const page = historicoPage(async () => {
    if (falhar) throw new Error('indisponível');
    return sorteiosCreg;
  });
  await page.inicializarHistorico();

  falhar = true;
  assert.equal(await page.carregarHistorico(), false);
  assert.equal(page.document.getElementById('historicoTable').children.length, 0);
  assert.equal(page.document.getElementById('historicoTotal').textContent, '');
  assert.equal(page.document.getElementById('historicoErro').hidden, false);
  assert.match(page.document.getElementById('historicoErro').children[0].textContent,
    /indisponível/);
  assert.equal(page.document.getElementById('btnAtualizar').disabled, false,
    'o botão precisa voltar para permitir nova tentativa');
});

const processosCj = [
  { ordem: 1, num_processo: '202600029000101', destino: 'CJ3', responsavel: 'Dorivan de Souza Lima',
    assunto: 'Auto de Infração', decisao: 'Sim', interessado: null },
  { ordem: 2, num_processo: '202600029000102', destino: 'CJ1', responsavel: 'CJ1',
    assunto: 'Auto de Infração', decisao: 'Não', interessado: null }
];

test('o botão leva ao banco exatamente a rodada da sua linha', async () => {
  const pedidos = [];
  const paraCj = historicoPage(async (caminho, opcoes) => {
    if (caminho === 'rpc/historico_sorteios') return sorteiosCj;
    pedidos.push([caminho, JSON.parse(opcoes.body)]);
    return processosCj;
  }, 'cj');
  await paraCj.inicializarHistorico();
  await paraCj.abrirDetalhe(acaoDe(paraCj, 1));  // a rodada sem carimbo

  const paraCreg = historicoPage(async (caminho, opcoes) => {
    if (caminho === 'rpc/historico_sorteios') return sorteiosCreg;
    pedidos.push([caminho, JSON.parse(opcoes.body)]);
    return [];
  }, 'creg');
  await paraCreg.inicializarHistorico();
  await paraCreg.abrirDetalhe(acaoDe(paraCreg, 0));

  assert.deepEqual(pedidos, [
    // Rodada sem carimbo: precisa chegar como null, senão o `is not distinct
    // from` do banco não casa com linha nenhuma e o card abre vazio.
    ['rpc/processos_sorteio', { p_colegiado: 'CJ', p_data: '2026-09-14', p_sorteado_em: null }],
    ['rpc/processos_sorteio', { p_colegiado: 'CREG', p_data: '2026-08-27',
      p_sorteado_em: '2026-08-27T14:07:26.154+00:00' }]
  ]);
});

test('clicar num destino abre o card já filtrado só para aquela unidade ou cadeira', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();

  const pill = destinoBotaoDe(linhas(page)[0], 'CJ1');
  await page.abrirDetalhe(pill);

  assert.equal(page.document.getElementById('detalheTitulo').textContent,
    'Sorteio de 28/09/2026 — CJ1',
    'o título precisa dizer qual destino está filtrado, não só a rodada');
  const [, tbody] = page.document.getElementById('detalheTable').children;
  assert.equal(tbody.children.length, 1,
    'só o processo de CJ1 aparece; a resposta inteira da rodada não vaza para o card');
  assert.deepEqual(celulas(tbody.children[0]),
    ['2', '202600029000102', 'CJ1', 'Auto de Infração', 'Não']);
  assert.match(page.document.getElementById('detalheResumo').textContent,
    /^Câmara de Julgamento · 1 processo · às \d{2}:\d{2}$/,
    'o resumo conta só os processos filtrados, não o total da rodada');
});

test('o card da Câmara mostra a defesa e o conselheiro da época', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();
  await page.abrirDetalhe(acaoDe(page, 0));

  assert.equal(page.dialog.open, true);
  assert.equal(page.document.getElementById('detalheTitulo').textContent, 'Sorteio de 28/09/2026');
  assert.match(page.document.getElementById('detalheResumo').textContent,
    /^Câmara de Julgamento · 2 processos · às \d{2}:\d{2}$/);

  const [thead, tbody] = page.document.getElementById('detalheTable').children;
  assert.deepEqual(celulas(thead.children[0]),
    ['Ordem', 'Nº do Processo', 'Cadeira', 'Assunto', 'Defesa'],
    'na Câmara a coluna de decisão é a defesa, e não há interessado');
  assert.deepEqual(celulas(tbody.children[0]),
    ['1', '202600029000101', 'CJ3', 'Auto de Infração', 'Sim']);

  // A cadeira sozinha não diz quem é; o ocupante da época vem na mesma resposta.
  assert.equal(tbody.children[0].children[2].title, 'Dorivan de Souza Lima');
  assert.equal(tbody.children[0].children[2]['aria-label'], 'CJ3 — Dorivan de Souza Lima');
  // Cadeira sem de-para no período sai pelo próprio rótulo, sem hover vazio.
  assert.equal(tbody.children[1].children[2].title, undefined);
});

test('o card do Conselho mostra o interessado e o recurso', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCreg : [
      { ordem: 1, num_processo: '202600029000792', destino: 'CREG3', responsavel: null,
        assunto: 'Outros', decisao: 'Não se aplica', interessado: null },
      { ordem: null, num_processo: '202600029001295', destino: 'CREG4', responsavel: null,
        assunto: 'Auto de Infração', decisao: 'Sem recurso', interessado: 'Concessionária X' }
    ], 'creg');
  await page.inicializarHistorico();
  await page.abrirDetalhe(acaoDe(page, 0));

  const [thead, tbody] = page.document.getElementById('detalheTable').children;
  assert.deepEqual(celulas(thead.children[0]),
    ['Ordem', 'Nº do Processo', 'Unidade', 'Interessado', 'Assunto', 'Recurso']);
  assert.deepEqual(celulas(tbody.children[0]),
    ['1', '202600029000792', 'CREG3', '—', 'Outros', 'Não se aplica']);
  // Rodada gravada sem a ordem do sorteio: travessão, e não um número inventado
  // a partir da posição na lista.
  assert.equal(tbody.children[1].children[0].textContent, '—');
  assert.match(page.document.getElementById('detalheResumo').textContent,
    /^Conselho Regulador · 2 processos · às \d{2}:\d{2}$/);
});

test('falha ao abrir a rodada aparece dentro do card, sem deslogar', async () => {
  const page = historicoPage(async caminho => {
    if (caminho === 'rpc/historico_sorteios') return sorteiosCreg;
    throw Object.assign(new Error('sessão expirada'), { status: 401 });
  }, 'creg');
  await page.inicializarHistorico();
  await page.abrirDetalhe(acaoDe(page, 0));

  assert.equal(page.dialog.open, true, 'o card permanece aberto para mostrar o erro');
  assert.equal(page.document.getElementById('detalheErro').hidden, false);
  assert.match(page.document.getElementById('detalheErro').children[0].textContent,
    /sessão expirada/);
  assert.equal(page.document.getElementById('historicoPanel').hidden, false,
    'a lista já carregada não pode sumir por causa do card');
});

test('resposta atrasada não sobrescreve a rodada aberta depois dela', async () => {
  const respostas = [];
  const page = historicoPage(async caminho => {
    if (caminho === 'rpc/historico_sorteios') return sorteiosCj;
    return new Promise(resolve => respostas.push(resolve));
  }, 'cj');
  await page.inicializarHistorico();

  const lenta = page.abrirDetalhe(acaoDe(page, 0));
  const rapida = page.abrirDetalhe(acaoDe(page, 2));

  respostas[1]([{ ordem: 1, num_processo: '202600029000999', destino: 'CJ2',
    responsavel: null, assunto: 'Auto de Infração', decisao: 'Sim', interessado: null }]);
  await rapida;
  respostas[0](processosCj);
  await lenta;

  assert.equal(page.document.getElementById('detalheTitulo').textContent, 'Sorteio de 31/08/2026');
  const tbody = page.document.getElementById('detalheTable').children[1];
  assert.deepEqual(tbody.children.map(l => l.children[1].textContent), ['202600029000999'],
    'a resposta da rodada abandonada não pode reescrever o card');
});

// ── Exportar a ata em .docx ──────────────────────────────────────────────────
// O documento segue o padrão visual das atas que a AGR publica: cabeçalho
// institucional em texto (sem imagem, sem número de ata), o parágrafo de
// abertura e a tabela — sem as colunas de Assunto/Decisão, que existem na tela
// mas não na ata oficial.

test('botão de exportar só habilita quando o card tem processos para exportar', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();

  const abertura = page.abrirDetalhe(acaoDe(page, 0));
  assert.equal(page.document.getElementById('btnExportarDetalhe').disabled, true,
    'enquanto a lista ainda está sendo buscada não há o que exportar');
  await abertura;
  assert.equal(page.document.getElementById('btnExportarDetalhe').disabled, false);
});

test('card sem processos ou com falha mantém a exportação desabilitada', async () => {
  const semProcessos = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCreg : [], 'creg');
  await semProcessos.inicializarHistorico();
  await semProcessos.abrirDetalhe(acaoDe(semProcessos, 0));
  assert.equal(semProcessos.document.getElementById('btnExportarDetalhe').disabled, true);

  const comFalha = historicoPage(async caminho => {
    if (caminho === 'rpc/historico_sorteios') return sorteiosCreg;
    throw new Error('indisponível');
  }, 'creg');
  await comFalha.inicializarHistorico();
  await comFalha.abrirDetalhe(acaoDe(comFalha, 0));
  assert.equal(comFalha.document.getElementById('btnExportarDetalhe').disabled, true,
    'não há o que exportar quando a lista não chegou');
});

test('a ata em .docx é um pacote válido, sem número de ata, com o cabeçalho do colegiado', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();

  const blob = page.criarDocxDetalhe(processosCj, '2026-09-28');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'docx precisa ser um pacote ZIP');
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const texto = new TextDecoder().decode(bytes);
  assert.match(texto, /word\/document\.xml/);
  assert.match(texto, /AGÊNCIA GOIANA DE REGULAÇÃO, CONTROLE E FISCALIZAÇÃO DE SERVIÇOS PÚBLICOS/);
  assert.match(texto, /CÂMARA DE JULGAMENTO/);
  assert.doesNotMatch(texto, /ATA N/i, 'a ata exportada não numera a sessão, diferente da ata oficial');
  assert.match(texto, /Aos 28 dias do mês de setembro de 2026/,
    'a data do parágrafo de abertura é a da própria rodada, não a de hoje');
  assert.doesNotMatch(texto, /Resolução Normativa|Decreto/,
    'sem esses dados no sistema, o texto genérico não pode inventar um número');
});

test('a tabela da ata traz o w:tblGrid que o Word exige, com uma coluna por cabeçalho', async () => {
  // Sem <w:tblGrid> logo depois do <w:tblPr>, o CT_Tbl é inválido e o Word abre
  // a ata oferecendo reparar o arquivo. Grepar o XML não pega isso: o documento
  // continua tendo todo o texto certo.
  const larguraUtil = 11906 - 1701 - 1133;   // pgSz menos as margens do sectPr
  for (const [colegiado, processos, colunas] of [
    ['cj', processosCj, 3],
    ['creg', [{ ordem: 1, num_processo: 'P1', destino: 'CREG1', interessado: 'A' }], 4]
  ]) {
    const page = historicoPage(async () => [], colegiado);
    const texto = new TextDecoder().decode(new Uint8Array(
      await page.criarDocxDetalhe(processos, '2026-08-27').arrayBuffer()));

    assert.match(texto, /<\/w:tblPr><w:tblGrid>/,
      `${colegiado}: o w:tblGrid tem de vir imediatamente depois do w:tblPr`);
    const grade = texto.match(/<w:tblGrid>(.*?)<\/w:tblGrid>/)?.[1] || '';
    assert.ok(texto.indexOf('</w:tblGrid>') < texto.indexOf('<w:tr>'),
      `${colegiado}: o w:tblGrid tem de vir antes da primeira linha`);

    const larguras = [...grade.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(([, w]) => Number(w));
    assert.equal(larguras.length, colunas,
      `${colegiado}: uma w:gridCol por coluna, senão o Word remonta a tabela`);
    assert.equal(larguras.reduce((a, b) => a + b, 0), larguraUtil,
      `${colegiado}: as colunas têm de somar a largura útil da página`);
    assert.ok(larguras.every(w => w > 0), `${colegiado}: coluna de largura zero`);
  }
});

test('ata do CJ lista Ordem, Nº do Processo e o RELATOR — não o código da cadeira', async () => {
  const page = historicoPage(async () => [], 'cj');
  const texto = new TextDecoder().decode(new Uint8Array(
    await page.criarDocxDetalhe(processosCj, '2026-09-28').arrayBuffer()));

  assert.match(texto, /<w:t[^>]*>Ordem<\/w:t>/);
  assert.match(texto, /<w:t[^>]*>Nº do Processo<\/w:t>/);
  assert.match(texto, /<w:t[^>]*>Relator<\/w:t>/);
  assert.doesNotMatch(texto, /<w:t[^>]*>Assunto<\/w:t>/, 'a ata oficial não tem essa coluna');
  assert.doesNotMatch(texto, /<w:t[^>]*>Defesa<\/w:t>/);
  // processosCj[0].destino é 'CJ3' (a cadeira); quem aparece na ata é
  // 'Dorivan de Souza Lima', o responsável pela cadeira na data do sorteio.
  assert.match(texto, /Dorivan de Souza Lima/);
  assert.doesNotMatch(texto, /<w:t[^>]*>CJ3<\/w:t>/, 'a ata do CJ não mostra o código da cadeira');
});

test('ata do CREG lista Interessado e Unidade, sem agrupar quando é um recorte só', async () => {
  const page = historicoPage(async () => [], 'creg');
  const processos = [
    { ordem: 1, num_processo: '202600029000792', destino: 'CREG3', interessado: 'Concessionária X' }
  ];
  const texto = new TextDecoder().decode(new Uint8Array(
    await page.criarDocxDetalhe(processos, '2026-08-27').arrayBuffer()));

  assert.match(texto, /<w:t[^>]*>Interessado<\/w:t>/);
  assert.match(texto, /<w:t[^>]*>Unidade<\/w:t>/);
  assert.match(texto, /Concessionária X/);
  assert.match(texto, /CREG3/);
});

test('ata do CREG agrupa por unidade quando o sorteio tem mais de um destino', async () => {
  const page = historicoPage(async () => [], 'creg');
  // Fora de ordem de sorteio de propósito: CREG4 aparece antes da CREG1 na
  // resposta, mas a ata oficial mostra todas as linhas da CREG1 primeiro.
  const processos = [
    { ordem: 1, num_processo: 'P1', destino: 'CREG4', interessado: 'A' },
    { ordem: 2, num_processo: 'P2', destino: 'CREG1', interessado: 'B' },
    { ordem: 3, num_processo: 'P3', destino: 'CREG4', interessado: 'C' },
    { ordem: 4, num_processo: 'P4', destino: 'CREG1', interessado: 'D' }
  ];
  const texto = new TextDecoder().decode(new Uint8Array(
    await page.criarDocxDetalhe(processos, '2026-08-27').arrayBuffer()));

  const ordemEncontrada = [...texto.matchAll(/P\d/g)].map(m => m[0]);
  assert.deepEqual(ordemEncontrada, ['P2', 'P4', 'P1', 'P3'],
    'CREG1 (ordem 2 e 4) precisa vir antes da CREG4 (ordem 1 e 3), como na ata oficial');
});

test('ata do CREG põe a linha sem ordem no fim do grupo, como a tela e a RPC', async () => {
  const page = historicoPage(async () => [], 'creg');
  // Gravação que não registrou a ordem: a RPC devolve `order by 1 nulls last, 2`,
  // e a ata precisa dizer o mesmo. `Number(null) || 0` a colocaria em primeiro.
  const processos = [
    { ordem: 2, num_processo: 'P2', destino: 'CREG1', interessado: 'B' },
    { ordem: null, num_processo: 'P9', destino: 'CREG1', interessado: 'X' },
    { ordem: null, num_processo: 'P5', destino: 'CREG1', interessado: 'Y' },
    { ordem: 1, num_processo: 'P1', destino: 'CREG1', interessado: 'A' }
  ];
  const texto = new TextDecoder().decode(new Uint8Array(
    await page.criarDocxDetalhe(processos, '2026-08-27').arrayBuffer()));

  const ordemEncontrada = [...texto.matchAll(/P\d/g)].map(m => m[0]);
  assert.deepEqual(ordemEncontrada, ['P1', 'P2', 'P5', 'P9'],
    'sem ordem vai para o fim, com o número do processo como desempate');
});

test('ata do CJ mantém a ordem de sorteio, sem agrupar por relator', async () => {
  const page = historicoPage(async () => [], 'cj');
  const processos = [
    { ordem: 1, num_processo: 'P1', destino: 'CJ3', responsavel: 'Dorivan de Souza Lima' },
    { ordem: 2, num_processo: 'P2', destino: 'CJ1', responsavel: 'Paulo Otoni Ribeiro' },
    { ordem: 3, num_processo: 'P3', destino: 'CJ3', responsavel: 'Dorivan de Souza Lima' }
  ];
  const texto = new TextDecoder().decode(new Uint8Array(
    await page.criarDocxDetalhe(processos, '2026-09-28').arrayBuffer()));

  const ordemEncontrada = [...texto.matchAll(/P\d/g)].map(m => m[0]);
  assert.deepEqual(ordemEncontrada, ['P1', 'P2', 'P3'],
    'a ata do CJ segue a ordem pura do sorteio, igual à tela');
});

test('exportar baixa o .docx com o nome da rodada e, quando filtrado, do destino', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();

  await page.abrirDetalhe(acaoDe(page, 0));
  page.exportarDetalheDocx();
  assert.deepEqual(page.document.downloads, ['historico-cj-2026-09-28.docx']);

  const pill = destinoBotaoDe(linhas(page)[0], 'CJ1');
  await page.abrirDetalhe(pill);
  page.exportarDetalheDocx();
  assert.deepEqual(page.document.downloads, ['historico-cj-2026-09-28.docx', 'historico-cj-2026-09-28-CJ1.docx']);
});

test('falha ao exportar a ata avisa dentro do próprio card', async () => {
  const page = historicoPage(async caminho =>
    caminho === 'rpc/historico_sorteios' ? sorteiosCj : processosCj, 'cj');
  await page.inicializarHistorico();
  await page.abrirDetalhe(acaoDe(page, 0));

  const criar = page.document.createElement.bind(page.document);
  page.document.createElement = tag => {
    if (tag === 'a') throw new Error('download bloqueado');
    return criar(tag);
  };
  page.exportarDetalheDocx();

  const erro = page.document.getElementById('detalheErro');
  assert.equal(erro.hidden, false);
  assert.match(erro.children[0].textContent, /Não foi possível gerar o arquivo.*download bloqueado/);
});

// ── Painel administrativo ────────────────────────────────────────────────────
// A tela é a primeira que grava por cima de dado alheio, então o que os testes
// perseguem é o que a distingue das outras: quem enxerga o painel, que a
// gravação exige duas etapas, e que o corpo enviado ao banco carrega SÓ o que
// de fato mudou — mandar campo intocado junto reescreveria valor que ninguém
// pediu para mexer.
// `botaoCarregando` é o alternarBotaoCarregando que a tela recebe. Mudo por
// padrão; o de verdade, do supabase.js, entra onde o teste lê o rótulo do botão.
function adminPage({ api = async () => null, aviso = () => {}, botaoCarregando = () => {} } = {}) {
  const document = new Document();
  const avisos = [];
  const registrarAviso = (texto, tipo) => { avisos.push({ texto, tipo }); aviso(texto, tipo); };

  ['seletorOrgaoCard', 'seletorOrgao', 'adminOrgaoAtual', 'abas', 'adminPainel', 'painelConteudo', 'painelTitulo',
   'painelDescricao', 'painelCarregando', 'painelErro', 'painelVazio', 'painelVazioTitulo',
   'painelVazioTexto', 'painelErroDetalhe', 'painelStatus', 'painelHint', 'tabelaInstrucao',
   'edicaoResumo', 'edicaoTitulo', 'edicaoCampos',
   'edicaoEtapaCampos', 'edicaoEtapaConfirmacao', 'edicaoDelta', 'edicaoImpacto',
   'edicaoImpactoTitulo', 'edicaoImpactoLista', 'edicaoErro', 'edicaoEtapaRotulo']
    .forEach(id => document.add(id, 'div'));
  ['btnTentarNovamente', 'btnMaisAntigas', 'btnVoltar', 'btnVoltarInicio', 'btnAvancarEdicao',
   'btnCancelarEdicao', 'btnFecharEdicao'].forEach(id => document.add(id, 'button'));
  document.add('painelTable', 'table');
  document.add('edicaoMotivo', 'input');

  const dialogo = document.add('edicaoDialog', 'dialog');
  dialogo.aberto = false;
  dialogo.showModal = () => { dialogo.aberto = true; };
  dialogo.close = () => { dialogo.aberto = false; dialogo.dispatch('close'); };

  const form = document.add('edicaoForm', 'form');
  // O <form> real resolve elements[nome]; aqui a busca é pelos descendentes,
  // que é o que o navegador faz por baixo.
  form.elements = new Proxy({}, {
    get(_, nome) {
      return document.getElementById('edicaoCampos')
        .descendants().find(no => no.name === nome) || undefined;
    }
  });

  document.getElementById('painelErro').appendChild(document.createElement('p'));
  document.getElementById('edicaoErro').appendChild(document.createElement('p'));

  const seletor = document.getElementById('seletorOrgao');
  ['CREG', 'CJ'].forEach(orgao => {
    const botao = document.createElement('button');
    botao.dataset.orgaoAdmin = orgao;
    botao.hidden = true;
    seletor.appendChild(botao);
  });
  const abas = document.getElementById('abas');
  ['sessoes', 'sorteios', 'auditoria'].forEach(nome => {
    const botao = document.createElement('button');
    botao.id = `aba-${nome}`;
    botao.dataset.aba = nome;
    abas.appendChild(botao);
  });
  document.body.append(seletor, abas, document.getElementById('edicaoCampos'));

  const app = new Function('document', 'api', 'aviso', 'criarIndicadorCarregamento',
    'alternarBotaoCarregando', 'rotularCadeira',
    `${source('admin.js')}\nreturn { inicializarAdmin, VOCABULARIO };`)(
    document, api, registrarAviso, () => document.createElement('div'), botaoCarregando, rotularCadeira);

  const botaoDeOrgao = orgao => seletor.children.find(b => b.dataset.orgaoAdmin === orgao);
  const botaoDeAba = nome => abas.children.find(b => b.dataset.aba === nome);
  const linhasDaTabela = () => document.getElementById('painelTable').children[1]?.children || [];
  const acao = (indice, rotulo) => {
    const celula = linhasDaTabela()[indice].children.find(c => c.dataset.label === 'Ações');
    return celula.children[0].children.find(b => b.textContent === rotulo);
  };
  const campo = nome => document.getElementById('edicaoCampos')
    .descendants().find(no => no.name === nome);

  return { ...app, document, avisos, dialogo, form, botaoDeOrgao, botaoDeAba,
           linhasDaTabela, acao, campo };
}

const SESSOES = [{ data_sessao: '2026-07-09', pauta: 24, processos: 2, pendentes: 1 }];
const PROCESSOS_SESSAO = [
  { id: 41, num_processo: '202600000000001', pauta: 24, voto: 'Manter', status: 'Julgado',
    destino: 'CJ3', data_distribuicao: '2026-06-18', acervo_id: 7,
    atualizado_por: null, atualizado_em: null }
];
const SORTEIOS = [{ data_distribuicao: '2026-06-18', sorteado_em: null, origem: 'sorteio',
                    processos: 1, destinos: ['CJ3'] }];
const PROCESSOS_ACERVO = [
  // `decisao` é o texto que a tabela mostra (com o legado de `recurso` quando a
  // defesa é nula) e `defesa` é a coluna booleana que o formulário edita: são
  // duas colunas da resposta, e confundi-las era o defeito.
  { id: 7, ordem: 1, num_processo: '202600000000001', destino: 'CJ3',
    assunto: 'Auto de Infração', decisao: 'Sim', defesa: true, interessado: null,
    origem: 'sorteio', julgados: 1 }
];

function apiDoPainel(chamadas, respostas = {}) {
  return async (caminho, opcoes) => {
    chamadas.push({ caminho, corpo: JSON.parse(opcoes.body) });
    if (caminho in respostas) {
      const resposta = respostas[caminho];
      return typeof resposta === 'function' ? resposta() : resposta;
    }
    if (caminho === 'rpc/admin_sessoes') return SESSOES;
    if (caminho === 'rpc/admin_processos_sessao') return PROCESSOS_SESSAO;
    if (caminho === 'rpc/admin_sorteios') return SORTEIOS;
    if (caminho === 'rpc/admin_processos_acervo') return PROCESSOS_ACERVO;
    if (caminho === 'rpc/admin_julgados_do_acervo') {
      return [{ id: 41, num_processo: '202600000000001', data_sessao: '2026-07-09',
                pauta: 24, voto: 'Manter', status: 'Julgado', destino: 'CJ3',
                data_distribuicao: '2026-06-18' }];
    }
    return { alterados: {}, propagados: [] };
  };
}

test('o seletor mostra so os orgaos que o usuario administra', async () => {
  const page = adminPage({ api: apiDoPainel([]) });
  await page.inicializarAdmin(new Set(['CREG']));

  assert.equal(page.botaoDeOrgao('CREG').hidden, false);
  assert.equal(page.botaoDeOrgao('CJ').hidden, true,
    'quem administra só o Conselho não pode ver a opção da Câmara');
  assert.equal(page.document.getElementById('seletorOrgaoCard').hidden, true,
    'com um órgão só, o seletor não é escolha');
});

test('com os dois orgaos o seletor aparece e comeca pela Camara', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ', 'CREG']));

  assert.equal(page.document.getElementById('seletorOrgaoCard').hidden, false);
  assert.equal(chamadas[0].corpo.p_colegiado, 'CJ');
  assert.equal(page.document.getElementById('adminOrgaoAtual').textContent, 'Câmara de Julgamento',
    'o contexto do colegiado precisa continuar visível fora do seletor');

  page.botaoDeOrgao('CREG').dispatch('click');
  await wait();
  assert.equal(chamadas.at(-1).corpo.p_colegiado, 'CREG',
    'trocar de órgão tem de recarregar a lista pelo colegiado novo');
  assert.equal(page.document.getElementById('adminOrgaoAtual').textContent, 'Conselho Regulador');
});

test('cada aba consulta a sua propria porta do banco', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_sessoes');

  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_sorteios');

  page.botaoDeAba('auditoria').dispatch('click');
  await wait();
  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_auditoria');
  assert.equal(page.document.getElementById('painelConteudo').getAttribute('aria-labelledby'),
    page.botaoDeAba('auditoria').id,
    'o painel precisa anunciar qual aba lhe dá nome');
  assert.equal(page.document.getElementById('painelHint').textContent,
    'Nenhuma linha pode ser alterada aqui.',
    'a auditoria não deve sugerir uma ação que suas linhas não oferecem');
  // O texto da dica deixou de ser escrito pelo JS e passou a viver no HTML —
  // quem a mostra agora é a medição de rolagem real, não a aba. O que continua
  // sendo decisão de runtime é a visão da tabela, e é dela que dependem a
  // ausência de coluna fixa e o formato tabular que a auditoria mantém.
  assert.equal(page.document.getElementById('painelTable').dataset.visao, 'auditoria',
    'a auditoria não vira cartão nem ganha coluna de ações fixa');
});

test('abas administrativas seguem o padrao de teclado e mantem um unico foco', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));

  assert.equal(page.botaoDeAba('sessoes').getAttribute('tabindex'), '0');
  assert.equal(page.botaoDeAba('sorteios').getAttribute('tabindex'), '-1');
  assert.equal(page.botaoDeAba('auditoria').getAttribute('tabindex'), '-1');

  page.botaoDeAba('sessoes').dispatch('keydown', { key: 'ArrowRight' });
  await wait();
  assert.equal(page.document.activeElement, page.botaoDeAba('sorteios'));
  assert.equal(page.botaoDeAba('sorteios').getAttribute('aria-selected'), 'true');
  assert.equal(page.botaoDeAba('sorteios').getAttribute('tabindex'), '0');
  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_sorteios');

  page.botaoDeAba('sorteios').dispatch('keydown', { key: 'End' });
  await wait();
  assert.equal(page.document.activeElement, page.botaoDeAba('auditoria'));

  page.botaoDeAba('auditoria').dispatch('keydown', { key: 'Home' });
  await wait();
  assert.equal(page.document.activeElement, page.botaoDeAba('sessoes'));
});

test('tabela administrativa explica a rolagem e mantem as acoes acessiveis', () => {
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../assets/css/index.css', import.meta.url), 'utf8');

  assert.match(html, /class="table-scroll admin-table-wrap"[^>]*aria-describedby="tabelaInstrucao"/);
  // A dica descreve a rolagem, e só ela: quando a tabela vira cartão não há o
  // que explicar — a pessoa está vendo o cartão. Quem liga e desliga a dica é a
  // medição de rolagem real em admin.js, não o breakpoint.
  assert.match(html, /id="tabelaInstrucao"[^>]*hidden[^>]*>[^<]*Deslize horizontalmente/i);
  assert.match(css, /\.admin-table-wrap:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.admin-table\s*\{[^}]*table-layout:\s*fixed/s,
    'larguras previsíveis impedem que o conteúdo abra vãos diferentes entre colunas');
  const larguraMinimaSessao = Number(css.match(
    /\.admin-table\[data-visao='processos-sessao'\]\s*\{[^}]*min-width:\s*(\d+)px/
  )?.[1]);
  const percentualVinculo = Number(css.match(
    /\.admin-table\[data-visao='processos-sessao'\] thead th:nth-child\(6\)\s*\{[^}]*width:\s*([\d.]+)%/
  )?.[1]);
  assert.ok(larguraMinimaSessao * percentualVinculo / 100 >= 212,
    'a coluna Vínculo precisa conter o selo completo sem invadir Atualizado por');
  assert.match(css,
    /\.admin-table th\.col-acoes,\s*\.admin-table td\.col-acoes\s*\{[^}]*text-align:\s*center/s,
    'cabeçalho e botões devem compartilhar o centro da coluna');
  assert.match(css,
    /\.admin-table\[data-visao='processos-sorteio'\]\[data-orgao='CREG'\][^}]+nth-child\(7\)[^{]*\{[^}]*width:/s,
    'o interessado do CREG precisa de uma faixa própria, sem comprimir os cabeçalhos finais');
  assert.match(css,
    /@media screen and \(max-width: 960px\)[\s\S]*?\.admin-table\[data-visao[^}]+tbody tr\s*\{[^}]*display:\s*grid/s);
  assert.match(css,
    /@media screen and \(max-width: 960px\)[\s\S]*?tbody td\.col-acoes\s*\{[^}]*grid-column:\s*3/s,
    'a posição responsiva precisa seguir a função da célula, não sua ordem no DOM');
});

test('tabelas administrativas nomeiam a coluna e as operacoes sem abreviacoes ambiguas', async () => {
  const page = adminPage({ api: apiDoPainel([]) });
  await page.inicializarAdmin(new Set(['CJ']));

  const cabecalho = page.document.getElementById('painelTable').children[0].children[0];
  assert.equal(page.document.getElementById('painelTable').dataset.visao, 'sessoes');
  assert.equal(page.linhasDaTabela()[0].children[0].dataset.label, 'Data');
  assert.equal(page.linhasDaTabela()[0].children[1].dataset.label, 'Ações');
  assert.deepEqual(cabecalho.children.map(celula => celula.textContent),
    ['Data', 'Ações', 'Pauta', 'Processos', 'Pendentes'],
    'a ação deve ficar junto do identificador da linha, não isolada na borda direita');
  assert.ok([0, 2, 3, 4].every(indice => cabecalho.children[indice].classList.contains('col-centro')),
    'as cinco colunas da listagem devem formar eixos visuais equidistantes');
  assert.ok(cabecalho.children[1].classList.contains('col-acoes'));

  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();
  assert.equal(page.document.getElementById('painelTable').dataset.visao, 'processos-sessao');
  const cabecalhoDetalhe = page.document.getElementById('painelTable').children[0].children[0];
  assert.deepEqual(cabecalhoDetalhe.children.map(celula => celula.textContent),
    ['Processo', 'Ações', 'Relator', 'Voto', 'Status', 'Vínculo', 'Atualizado por']);
  assert.ok(cabecalhoDetalhe.children.at(-1).classList.contains('col-centro'),
    'o cabeçalho Atualizado por precisa compartilhar o eixo central dos valores');
  assert.ok(page.linhasDaTabela().every(linha => linha.children.at(-1).classList.contains('col-centro')),
    'os valores de Atualizado por precisam ficar centralizados sob o cabeçalho');
  const botoes = page.linhasDaTabela()[0].children[1].children[0].children;
  assert.deepEqual(botoes.map(botao => botao.textContent),
    ['Corrigir dados', 'Corrigir número', 'Religar ao acervo']);
});

test('tabela administrativa identifica o colegiado para dimensionar colunas exclusivas', async () => {
  const page = adminPage({ api: apiDoPainel([]) });
  await page.inicializarAdmin(new Set(['CJ', 'CREG']));

  const tabela = page.document.getElementById('painelTable');
  assert.equal(tabela.dataset.orgao, 'CJ');

  page.botaoDeOrgao('CREG').dispatch('click');
  await wait();
  assert.equal(tabela.dataset.orgao, 'CREG',
    'o CREG precisa reservar espaço para a coluna adicional de interessado');
});

test('pendencias e estados importantes aparecem como sinais visuais, nao como numeros soltos', async () => {
  const page = adminPage({ api: apiDoPainel([]) });
  await page.inicializarAdmin(new Set(['CJ']));

  const pendencias = page.linhasDaTabela()[0].children[4].children[0];
  assert.equal(pendencias.textContent, '1 pendente');
  assert.ok(pendencias.classList.contains('admin-badge-alerta'));

  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();
  const status = page.linhasDaTabela()[0].children[4].children[0];
  assert.equal(status.textContent, 'Julgado');
  assert.ok(status.classList.contains('admin-badge-sucesso'));
});

test('a navegacao e por data: abrir a sessao pede os processos daquele dia', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));

  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_processos_sessao');
  assert.equal(chamadas.at(-1).corpo.p_data_sessao, '2026-07-09');
  assert.equal(page.document.getElementById('btnVoltar').hidden, false);
});

test('da lista do painel da para voltar ao inicio; dentro de um detalhe quem volta e o Voltar', async () => {
  const page = adminPage({ api: apiDoPainel([]) });
  await page.inicializarAdmin(new Set(['CJ']));
  const inicio = page.document.getElementById('btnVoltarInicio');
  const voltar = page.document.getElementById('btnVoltar');

  // Na lista: a única saída da tela é o Início, e ele precisa estar à vista —
  // era o que faltava, e deixava o painel sem caminho de volta ao index.html.
  assert.equal(inicio.hidden, false, 'sem o Início a tela não tem saída');
  assert.equal(voltar.hidden, true, 'não há detalhe aberto para o Voltar desfazer');

  // Dentro de um detalhe os dois trocam de lugar, como em julgados.js: uma
  // volta de cada vez, e a de dentro tem precedência sobre a de fora.
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();
  assert.equal(voltar.hidden, false);
  assert.equal(inicio.hidden, true);

  // E ao fechar o detalhe o Início reassume.
  voltar.dispatch('click');
  await wait();
  assert.equal(inicio.hidden, false);
  assert.equal(voltar.hidden, true);
});

test('gravar exige duas etapas: a primeira so monta a confirmacao', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  assert.equal(page.dialogo.aberto, true);
  assert.equal(page.document.getElementById('edicaoEtapaRotulo').textContent, 'Etapa 1 de 2');

  page.campo('voto').value = 'Anular';
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes, 'a primeira etapa não pode gravar nada');
  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, false);
  assert.equal(page.document.getElementById('edicaoEtapaRotulo').textContent, 'Etapa 2 de 2');
  assert.match(page.document.getElementById('edicaoDelta').children[0].textContent,
    /Voto: Manter → Anular/);
});

test('confirmacao movel preserva a identificacao do registro', () => {
  const css = readFileSync(new URL('../assets/css/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css,
    /\.admin-dialog \.detalhe-resumo\s*\{\s*display:\s*none;?\s*\}/,
    'a segunda etapa precisa continuar dizendo qual processo sera alterado');
});

test('o corpo enviado leva so o campo que mudou', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('voto').value = 'Anular';
  page.document.getElementById('edicaoMotivo').value = 'ata confere Anular';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  const gravacao = chamadas.find(c => c.caminho === 'rpc/admin_corrigir_julgado_cj');
  assert.deepEqual(gravacao.corpo.p_campos, { voto: 'Anular' },
    'status, pauta e data não mudaram: mandá-los junto reescreveria valor intocado');
  assert.equal(gravacao.corpo.p_id, 41);
  assert.equal(gravacao.corpo.p_motivo, 'ata confere Anular');
  assert.equal(page.dialogo.aberto, false);
  assert.equal(page.avisos.at(-1).tipo, 'sucesso');
});

test('deixar o campo em branco desfaz o registro, com null explicito', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('status').value = '';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  const gravacao = chamadas.find(c => c.caminho === 'rpc/admin_corrigir_julgado_cj');
  assert.deepEqual(gravacao.corpo.p_campos, { status: null },
    'chave presente com null é o que o banco lê como "apagar"');
});

test('confirmar sem ter mudado nada e recusado antes de sair da tela', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes);
  assert.equal(page.document.getElementById('edicaoErro').hidden, false);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /Nenhuma alteração/);
});

test('corrigir o acervo mostra os julgados que vao junto; redistribuir nao', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.document.getElementById('edicaoImpacto').hidden, false);
  assert.match(page.document.getElementById('edicaoImpactoLista').children[0].textContent,
    /Sessão de 09\/07\/2026/);

  page.dialogo.close();
  page.acao(0, 'Redistribuir').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.document.getElementById('edicaoImpacto').hidden, true,
    'redistribuição preserva os julgados: listá-los sugeriria o contrário');
});

test('corrigir e redistribuir batem em portas diferentes do banco', async () => {
  for (const [rotulo, porta] of [['Corrigir dados', 'rpc/admin_corrigir_acervo_cj'],
                                 ['Redistribuir', 'rpc/admin_redistribuir_cj']]) {
    const chamadas = [];
    const page = adminPage({ api: apiDoPainel(chamadas) });
    await page.inicializarAdmin(new Set(['CJ']));
    page.botaoDeAba('sorteios').dispatch('click');
    await wait();
    page.acao(0, 'Abrir distribuição').dispatch('click');
    await wait();

    page.acao(0, rotulo).dispatch('click');
    page.campo('relator').value = 'CJ4';
    page.form.dispatch('submit');
    await wait();
    page.form.dispatch('submit');
    await wait();

    assert.ok(chamadas.some(c => c.caminho === porta),
      `${rotulo} deveria chamar ${porta}`);
  }
});

test('cadeira fora do padrao e recusada antes de chegar ao banco', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CREG1';
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /Relator inválido/);
});

test('o numero do processo e corrigivel de dentro da sessao, com escopo', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '202600000009999';
  page.campo('escopo').value = 'tudo';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  const gravacao = chamadas.find(c => c.caminho === 'rpc/admin_corrigir_processo_cj');
  assert.equal(gravacao.corpo.p_num_atual, '202600000000001');
  assert.equal(gravacao.corpo.p_num_novo, '202600000009999');
  assert.equal(gravacao.corpo.p_escopo, 'tudo');
});

test('numero com menos de 15 digitos nem sai da tela', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '12345';
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent, /15 dígitos/);
});

test('erro do banco vira aviso e mantem o dialogo aberto para corrigir', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_corrigir_julgado_cj': () => {
        throw new Error('acesso administrativo ao orgao CJ nao autorizado');
      }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('voto').value = 'Anular';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.dialogo.aberto, true, 'fechar apagaria o que a pessoa digitou');
  assert.equal(page.avisos.at(-1).tipo, 'erro');
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /nao autorizado/);
});

test('falha ao carregar a lista oferece nova tentativa em vez de tela vazia', async () => {
  let falhar = true;
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_sessoes': () => {
        if (falhar) throw new Error('sem rede');
        return SESSOES;
      }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));

  assert.equal(page.document.getElementById('painelErro').hidden, false);
  // A frase principal diz o que fazer; a mensagem crua da exceção desceu para a
  // linha de detalhe técnico, porque ela costumava ecoar a própria frase — "não
  // foi possível carregar os dados (não foi possível consultar o serviço)".
  assert.match(page.document.getElementById('painelErro').children[0].textContent,
    /tente novamente/i);
  assert.match(page.document.getElementById('painelErroDetalhe').textContent,
    /sem rede/, 'o detalhe técnico continua disponível para quem for investigar');

  falhar = false;
  page.document.getElementById('btnTentarNovamente').dispatch('click');
  await wait();
  assert.equal(page.document.getElementById('painelErro').hidden, true);
  assert.equal(page.linhasDaTabela().length, 1);
});

test('a lista vazia explica o que falta, e nao fica em branco', async () => {
  const page = adminPage({ api: apiDoPainel([], { 'rpc/admin_sessoes': [] }) });
  await page.inicializarAdmin(new Set(['CJ']));

  assert.equal(page.document.getElementById('painelVazio').hidden, false);
  assert.match(page.document.getElementById('painelVazioTexto').textContent, /pauta da AGR/);
});

test('o Conselho usa o proprio vocabulario no formulario', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_processos_acervo': [{ id: 9, ordem: 1, num_processo: '202600000000002',
        destino: 'CREG2', assunto: 'Requerimento', decisao: 'Com recurso',
        interessado: 'Fulano', origem: 'sorteio', julgados: 0 }],
      'rpc/admin_sorteios': [{ data_distribuicao: '2026-06-18', sorteado_em: null,
        origem: 'sorteio', processos: 1, destinos: ['CREG2'] }]
    })
  });
  await page.inicializarAdmin(new Set(['CREG']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  assert.ok(page.campo('unidade'), 'no Conselho o destino é a unidade, não o relator');
  assert.ok(page.campo('recurso'), 'a 6ª coluna do Conselho é Recurso, não Defesa');
  assert.ok(page.campo('interessado'), 'interessado só existe no Conselho');
  assert.equal(page.campo('defesa'), undefined);

  page.campo('unidade').value = 'CREG3';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();
  assert.ok(chamadas.some(c => c.caminho === 'rpc/admin_corrigir_acervo_creg'));
});

// ── Regressões do painel ─────────────────────────────────────────
// Tudo abaixo nasceu de defeito encontrado em revisão, não de requisito novo.

// O truncamento em 10 caracteres serve à data — carimbo do banco contra
// <input type="date"> — e valia para todo campo. No Conselho, onde
// 'Indeferimento' e 'Prejudicado' passam de 10, ele fazia a tela ver alteração
// onde não houve.
test('voto longo do Conselho nao vira alteracao inventada', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_sessoes': [{ data_sessao: '2026-07-09', pauta: 24, processos: 1, pendentes: 0 }],
      'rpc/admin_processos_sessao': [{ id: 55, num_processo: '202600000000002', pauta: 24,
        voto: 'Indeferimento', status: 'Prejudicado', destino: 'CREG2',
        data_distribuicao: '2026-06-18', acervo_id: 9,
        atualizado_por: null, atualizado_em: null }]
    })
  });
  await page.inicializarAdmin(new Set(['CREG']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes,
    'nada mudou: reescrever atualizado_por por uma edição que não houve é o defeito');
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /Nenhuma alteração/);
});

// A consulta de impacto é assíncrona e o botão continua sendo o submit do
// <form>: sem trava, o segundo envio reentrava com o delta já montado e caía
// direto na gravação, pulando a etapa que existe para ser lida.
test('segundo envio durante a consulta de impacto nao pula a confirmacao', async () => {
  const chamadas = [];
  let liberar;
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_julgados_do_acervo': () => new Promise(resolve => { liberar = () => resolve([]); })
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, true,
    'a etapa 1 só termina quando o impacto responde');
  assert.equal(chamadas.filter(c => c.caminho === 'rpc/admin_julgados_do_acervo').length, 1);
  assert.ok(!chamadas.some(c => c.caminho === 'rpc/admin_corrigir_acervo_cj'),
    'gravar sem passar pela confirmação é exatamente o que a trava impede');

  liberar();
  await wait();
  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, false);
});

// Quem religa é o gatilho de derivação, DURANTE a escrita: na confirmação isso
// ainda não aconteceu, e a função devolve o que fez em `alterados`/`propagados`.
// Descartar o retorno deixava a divergência para verificacao_cj.sql.
test('o aviso da gravacao conta o que o banco fez por baixo', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_corrigir_julgado_cj': { alterados: { acervo_id: { antes: 7, depois: 12 } } }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('data_sessao').value = '2026-07-10';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  assert.match(page.avisos.at(-1).texto, /religou o julgado a outra distribuição/);
  assert.equal(page.avisos.at(-1).tipo, 'sucesso');
});

test('o aviso da correcao de acervo diz quantos julgados foram junto', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_corrigir_acervo_cj': { alterados: {}, propagados: [41] }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  assert.match(page.avisos.at(-1).texto, /1 julgado seguiu a correção/);
});

// admin_sessoes agrupa por (data, pauta). Sem o número no detalhe, duas pautas
// do mesmo dia abriam a mesma tabela, com o total somado das duas.
test('abrir a sessao leva a pauta junto da data', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  const consulta = chamadas.find(c => c.caminho === 'rpc/admin_processos_sessao');
  assert.equal(consulta.corpo.p_data_sessao, '2026-07-09');
  assert.equal(consulta.corpo.p_pauta, 24);
  assert.match(page.document.getElementById('painelTitulo').textContent, /pauta 24/,
    'o título precisa dizer QUAL das pautas do dia está aberta');
});

// A sessão sem número existe, e `is not distinct from` é o que a alcança: um
// p_pauta ausente no corpo faria o banco cair no default e devolver outra coisa.
test('sessao sem numero de pauta manda null explicito', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_sessoes': [{ data_sessao: '2026-07-09', pauta: null, processos: 1, pendentes: 0 }]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  const consulta = chamadas.find(c => c.caminho === 'rpc/admin_processos_sessao');
  assert.ok('p_pauta' in consulta.corpo);
  assert.equal(consulta.corpo.p_pauta, null);
  assert.doesNotMatch(page.document.getElementById('painelTitulo').textContent, /pauta/);
});

// Os dois lugares onde chave crua de banco escapava para a tela.
test('origem e campo derivado aparecem por extenso, nao pelo valor cru', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_sorteios': [{ data_distribuicao: '2026-06-18', sorteado_em: null,
        origem: 'planilha', processos: 1, destinos: ['CJ3'] }],
      'rpc/admin_auditoria': [{ id: 1, operacao: 'religar_julgado', tabela: 'julgados_cj',
        registro_id: 41, antes: { acervo_id: 7 }, depois: { acervo_id: 12 },
        motivo: null, feito_por: 'admin@goias.gov.br', feito_em: '2026-09-08T12:00:00Z' }]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));

  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  const origem = page.linhasDaTabela()[0].children.find(c => c.dataset.label === 'Origem');
  assert.equal(origem.children[0].textContent, 'Planilha importada',
    'planilha é a importação legada inteira, e caía no valor cru minúsculo');

  page.botaoDeAba('auditoria').dispatch('click');
  await wait();
  const alteracao = page.linhasDaTabela()[0].children.find(c => c.dataset.label === 'Alteração');
  assert.match(alteracao.children[0].children[0].textContent, /^Distribuição vinculada: /,
    'toda religação observa acervo_id: sem rótulo, a operação mais comum saía crua');
});

// ── Regressões do painel · segunda revisão ───────────────────────────────────

// O gatilho reescreve acervo_id em TODA correção de julgado (data_sessao entra
// sempre no UPDATE, e `update of` dispara pela presença da coluna), então
// `alterados.acervo_id` não significa que a data mudou — e o vínculo pode ter
// CAÍDO. Anunciar isso como "religou o julgado a outra distribuição" vendia como
// sucesso a perda do vínculo.
test('vinculo perdido na correcao do julgado sai como atencao, nao como religacao', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_corrigir_julgado_cj': { alterados: { acervo_id: { antes: 7, depois: null } } }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('voto').value = 'Anular';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();

  assert.match(page.avisos.at(-1).texto, /SEM distribuição vinculada/);
  assert.equal(page.avisos.at(-1).tipo, 'atencao');
  assert.doesNotMatch(page.avisos.at(-1).texto, /religou/);
});

// A data futura era barrada só no banco, e a resposta que chegava à tela era a
// frase crua do Postgres ('sessao no futuro: 2027-01-01') — a única regra desta
// classe sem frase em português.
test('data futura e recusada na tela, com frase em portugues', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  assert.ok(page.campo('data_sessao').getAttribute('max'),
    'o campo precisa declarar o limite que o banco aplica');
  page.campo('data_sessao').value = '2099-01-01';
  const antes = chamadas.length;
  page.form.dispatch('submit');
  await wait();

  assert.equal(chamadas.length, antes);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /não pode ser futura/);
});

// A tabela da sessão oferece "Religar ao acervo" em toda linha, e desenhava
// igual o julgado que está vinculado e o que não está — que é justamente o caso
// que a operação existe para resolver. acervo_id já vinha na resposta.
test('a sessao mostra quais julgados estao sem distribuicao vinculada', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_processos_sessao': [
        { id: 41, num_processo: '202600000000001', pauta: 24, voto: 'Manter', status: 'Julgado',
          destino: 'CJ3', data_distribuicao: '2026-06-18', acervo_id: 7,
          atualizado_por: null, atualizado_em: null },
        { id: 42, num_processo: '202600000000002', pauta: 24, voto: null, status: null,
          destino: null, data_distribuicao: null, acervo_id: null,
          atualizado_por: null, atualizado_em: null }
      ]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  const vinculo = indice => page.linhasDaTabela()[indice].children
    .find(c => c.dataset.label === 'Vínculo').children[0];
  assert.match(vinculo(0).textContent, /Distribuição de 18\/06\/2026/);
  assert.equal(vinculo(1).textContent, 'Sem distribuição');
  assert.ok(vinculo(1).classList.contains('admin-badge-alerta'));

  // E a confirmação de religar precisa dizer de onde o julgado sai hoje: o texto
  // fixo "como estão hoje no julgado → rederivados do acervo" servia igual para
  // os dois casos, inclusive para o religar que não muda nada.
  page.acao(1, 'Religar ao acervo').dispatch('click');
  page.form.dispatch('submit');
  await wait();
  assert.match(page.document.getElementById('edicaoDelta').children[0].textContent,
    /Distribuição vinculada: nenhuma/);
});

// Renumerar alcança TODA distribuição e TODO julgado com aquele número, e o
// diálogo apresentava a operação como a edição da linha clicada: sem preview,
// sem contagem, e descartando os ids que a função devolve.
test('corrigir o numero mostra os registros alcancados e conta os renumerados', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_registros_do_processo': [
        { origem_registro: 'acervo', registro_id: 7, data_referencia: '2026-06-18',
          pauta: null, destino: 'CJ3', vinculado: null },
        { origem_registro: 'julgados', registro_id: 41, data_referencia: '2026-07-09',
          pauta: 24, destino: 'CJ3', vinculado: true }
      ],
      'rpc/admin_corrigir_processo_cj': { acervo: [7], julgados: [41], desvinculados: [] }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '202600000009999';
  page.form.dispatch('submit');
  await wait();

  const impacto = page.document.getElementById('edicaoImpactoLista');
  assert.equal(page.document.getElementById('edicaoImpacto').hidden, false,
    'a renumeração não pode ser confirmada sem dizer quantos registros alcança');
  assert.equal(impacto.children.length, 2);
  assert.match(impacto.children[0].textContent, /Distribuição de 18\/06\/2026/);
  assert.match(impacto.children[1].textContent, /sessão de 09\/07\/2026/);
  // O alcance é escolha, não mudança de valor: "Alcance: — → tudo" emprestava a
  // forma de um antes→depois a algo que nunca teve um antes, e mostrava o valor
  // cru do enum do banco.
  assert.equal(page.document.getElementById('edicaoDelta').children[1].textContent,
    'Alcance: Distribuições e julgados');

  page.form.dispatch('submit');
  await wait();
  assert.match(page.avisos.at(-1).texto, /1 distribuição renumerada e 1 julgado renumerado/);
});

test('renumerar so os julgados avisa que o vinculo com o acervo cai', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_registros_do_processo': [
        { origem_registro: 'acervo', registro_id: 7, data_referencia: '2026-06-18',
          pauta: null, destino: 'CJ3', vinculado: null },
        { origem_registro: 'julgados', registro_id: 41, data_referencia: '2026-07-09',
          pauta: 24, destino: 'CJ3', vinculado: true }
      ],
      'rpc/admin_corrigir_processo_cj': { acervo: [], julgados: [41], desvinculados: [41] }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '202600000009999';
  page.campo('escopo').value = 'julgados';
  page.form.dispatch('submit');
  await wait();

  const itens = page.document.getElementById('edicaoImpactoLista').children
    .map(item => item.textContent);
  assert.equal(itens.length, 2, 'só o julgado é alcançado, mais o aviso do vínculo');
  assert.ok(itens.some(texto => /perdem o vínculo/.test(texto)));

  page.form.dispatch('submit');
  await wait();
  assert.match(page.avisos.at(-1).texto, /sem distribuição vinculada/);
  assert.equal(page.avisos.at(-1).tipo, 'atencao');
});

// O select de escopo mostrava 'tudo', 'acervo' e 'julgados' — valor cru do banco
// como rótulo visível, no arquivo que traduz todo valor de banco antes de exibir.
test('o escopo da renumeracao e escolhido por frase, e envia o valor do banco', async () => {
  const chamadas = [];
  const page = adminPage({ api: apiDoPainel(chamadas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  const escopo = page.campo('escopo');
  const opcoes = escopo.children.filter(opcao => opcao.value !== '');
  assert.deepEqual(opcoes.map(opcao => opcao.value), ['tudo', 'acervo', 'julgados']);
  assert.deepEqual(opcoes.map(opcao => opcao.textContent),
    ['Distribuições e julgados', 'Somente as distribuições', 'Somente os julgados']);

  escopo.value = 'acervo';
  page.campo('num_novo').value = '202600000009999';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();
  assert.equal(chamadas.find(c => c.caminho === 'rpc/admin_corrigir_processo_cj').corpo.p_escopo,
    'acervo');
});

// A "antes" da defesa saía de `decisao`, que CAI no texto legado de `recurso`
// quando a coluna booleana é nula: a confirmação prometia uma mudança diferente
// da que a auditoria registra.
test('a defesa editada vem da coluna armazenada, nao do texto legado', async () => {
  const chamadas = [];
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      'rpc/admin_processos_acervo': [{ id: 7, ordem: 1, num_processo: '202600000000001',
        destino: 'CJ3', assunto: 'Auto de Infração', decisao: 'Sim', defesa: null,
        interessado: null, origem: 'planilha', julgados: 0 }]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  assert.equal(page.campo('defesa').value, '',
    'defesa nula é campo vazio: o "Sim" da tabela é o legado de recurso');

  page.campo('defesa').value = 'Não';
  page.form.dispatch('submit');
  await wait();
  assert.match(page.document.getElementById('edicaoDelta').children[0].textContent,
    /Defesa: \(vazio\) → Não/);
  page.form.dispatch('submit');
  await wait();
  assert.deepEqual(chamadas.find(c => c.caminho === 'rpc/admin_corrigir_acervo_cj').corpo.p_campos,
    { defesa: false });
});

// A auditoria pedia 100 linhas e rotulava o resultado como se fosse o total.
test('a auditoria pagina e diz quando ha registros anteriores', async () => {
  const chamadas = [];
  const pagina = tamanho => Array.from({ length: tamanho }, (_, i) => ({
    id: 1000 - i, operacao: 'corrigir_julgado', tabela: 'julgados_cj', registro_id: 41,
    num_processo: '202600000000001', antes: { voto: 'Manter' }, depois: { voto: 'Anular' },
    motivo: null, feito_por: 'admin@goias.gov.br', feito_em: '2026-09-08T12:00:00Z'
  }));
  let primeira = true;
  const page = adminPage({
    api: apiDoPainel(chamadas, {
      // 101 na primeira resposta: o registro extra é o sinal de que há mais.
      'rpc/admin_auditoria': () => {
        if (primeira) { primeira = false; return pagina(101); }
        return pagina(3);
      }
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('auditoria').dispatch('click');
  await wait();

  const botao = page.document.getElementById('btnMaisAntigas');
  assert.equal(page.linhasDaTabela().length, 100, 'o registro extra não entra na tabela');
  assert.match(page.document.getElementById('painelStatus').textContent,
    /Há registros além destes/);
  assert.equal(botao.hidden, false);
  assert.equal(chamadas.at(-1).corpo.p_limite, 101);
  assert.equal(chamadas.at(-1).corpo.p_antes_de, null);

  botao.dispatch('click');
  await wait();
  assert.equal(chamadas.at(-1).corpo.p_antes_de, 901,
    'a página seguinte parte do último id já lido');
  assert.equal(page.linhasDaTabela().length, 103, 'a busca anterior acrescenta, não substitui');
  assert.match(page.document.getElementById('painelStatus').textContent, /rastro completo/);
  assert.equal(botao.hidden, true);
});

// Chave interna não identifica nada para quem opera o sistema.
test('cada linha da auditoria diz de qual processo se trata', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_auditoria': [{ id: 1, operacao: 'corrigir_julgado', tabela: 'julgados_cj',
        registro_id: 3417, num_processo: '202600000000001', antes: { voto: 'Manter' },
        depois: { voto: 'Anular' }, motivo: null, feito_por: 'admin@goias.gov.br',
        feito_em: '2026-09-08T12:00:00Z' }]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('auditoria').dispatch('click');
  await wait();

  const registro = page.linhasDaTabela()[0].children.find(c => c.dataset.label === 'Registro');
  assert.deepEqual(registro.children[0].children.map(no => no.textContent),
    ['Julgado nº 3417', 'processo 202600000000001']);
});

// Falhar ao trocar de aba deixava o cabeçalho e o data-visao da aba anterior na
// tela: a pessoa lia "não foi possível carregar" sob o título de outro lugar.
test('falha ao trocar de aba nao deixa o titulo da aba anterior', async () => {
  const page = adminPage({
    api: apiDoPainel([], { 'rpc/admin_auditoria': () => { throw new Error('sem rede'); } })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('auditoria').dispatch('click');
  await wait();

  assert.equal(page.document.getElementById('painelErro').hidden, false);
  assert.equal(page.document.getElementById('painelTitulo').textContent,
    'Auditoria das correções');
  assert.equal(page.document.getElementById('painelTable').dataset.visao, 'auditoria');
});

// `dialogoAtual` é zerado pelo ouvinte de `close`, e passo() continuava depois de
// dois await: fechar a janela durante a consulta de impacto estourava um
// TypeError dentro de uma cadeia assíncrona sem catch.
test('fechar o dialogo durante a consulta de impacto nao estoura', async () => {
  let liberar;
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_julgados_do_acervo': () => new Promise(resolve => { liberar = () => resolve([]); })
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();

  page.dialogo.close();
  liberar();
  await wait();
  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, true,
    'a janela foi fechada: não há etapa 2 para montar');
});

test('o painel so entra em cena para quem tem papel de administrador', () => {
  const bootstrap = readFileSync(new URL('../assets/js/bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /exigeAdmin: true/,
    'admin.html precisa entrar por papel, e não por órgão');
  assert.match(bootstrap, /if \(paginaAtual\.exigeAdmin\) \{[^}]*orgaosAdmin\.size === 0\) throw erroSemPermissao/s,
    'sem papel de administrador, o módulo não pode carregar');
  // No próprio painel a consulta é o porteiro, e buscar o módulo antes dela seria
  // baixá-lo para quem não entra. Na tela inicial ela nem é aguardada (ver os
  // dois testes seguintes).
  assert.ok(bootstrap.indexOf('orgaosAdmin = await buscarOrgaosAdministrados')
    < bootstrap.indexOf('await carregarScript('),
    'no painel o papel precisa ser verificado antes de baixar o módulo');

  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /data-admin/, 'o cartão do painel na tela inicial precisa do marcador');
  assert.match(index, /id="cardAdmin"[^>]*hidden/,
    'o cartão nasce escondido: só aparece depois da consulta de papel');
});

function telaInicialComAtalhoAdmin(inicializar, opcoes) {
  const page = bootstrapPage(inicializar, 'sorteio', opcoes);
  const cartao = page.document.createElement('section');
  cartao.dataset.admin = '';
  page.document.body.appendChild(cartao);
  return page;
}

// Na tela inicial o papel de administrador decide só se um cartão aparece.
// Aguardar a consulta — antes ou logo depois do download do script — segurava
// "Preparando o sorteio…" até a resposta, e com a rede lenta isso era o
// tempo-limite inteiro.
test('a consulta do atalho administrativo nao segura a tela inicial', async () => {
  let responder;
  let iniciou = false;
  const aplicados = [];
  const page = telaInicialComAtalhoAdmin(async () => { iniciou = true; }, {
    buscarAdmin: () => new Promise(resolve => { responder = resolve; }),
    aplicarVisibilidadeAdmin: orgaos => aplicados.push([...orgaos])
  });

  await page.iniciar();
  assert.equal(iniciou, true, 'a tela inicial começa sem esperar a consulta de papel');
  assert.equal(page.sessionLoading.hidden, true);
  assert.deepEqual(aplicados, [], 'sem resposta, o atalho continua como nasceu: escondido');

  responder(new Set(['CJ']));
  await wait();
  assert.deepEqual(aplicados, [['CJ']], 'o atalho aparece quando a resposta chega');
});

// Fora do painel a consulta decide só se um atalho aparece: uma falha ali não
// pode derrubar a tela inicial inteira.
test('falha na consulta do atalho administrativo so mantem o cartao escondido', async () => {
  let iniciou = false;
  const aplicados = [];
  const page = telaInicialComAtalhoAdmin(async () => { iniciou = true; }, {
    buscarAdmin: async () => { throw new Error('rpc indisponível'); },
    aplicarVisibilidadeAdmin: orgaos => aplicados.push([...orgaos])
  });

  await page.iniciar();
  await wait();
  assert.equal(iniciou, true);
  assert.equal(page.sessionLoading.hidden, true, 'a falha não vira erro de carregamento');
  assert.deepEqual(aplicados, [[]]);
});

// Fechar a janela no meio da gravação e abrir outra deixava a espera da
// primeira mandando na segunda: ao terminar, fechava a janela nova no meio do
// preenchimento e devolvia ao botão o rótulo "Confirmar e gravar" na etapa 1.
test('gravacao lenta de uma janela fechada nao fecha a janela seguinte', async () => {
  let concluir;
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_corrigir_julgado_cj': () => new Promise(resolve => { concluir = resolve; })
    }),
    botaoCarregando: alternarBotaoCarregando
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('voto').value = 'Anular';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();
  page.dialogo.close();

  page.acao(0, 'Corrigir dados').dispatch('click');
  const botao = page.document.getElementById('btnAvancarEdicao');
  assert.equal(botao.disabled, false, 'a janela nova não herda o botão ocupado da anterior');

  concluir({ alterados: {} });
  await wait();
  assert.equal(page.dialogo.aberto, true, 'a gravação antiga não pode fechar a janela nova');
  assert.equal(page.document.getElementById('edicaoEtapaRotulo').textContent, 'Etapa 1 de 2');
  assert.equal(botao.textContent, 'Revisar alteração',
    'o rótulo da etapa 2 da janela antiga não pode voltar na etapa 1 da nova');
  assert.equal(botao.disabled, false);
  assert.equal(page.avisos.at(-1).tipo, 'sucesso', 'a gravação aconteceu e continua sendo anunciada');
});

// A trava de envio era da página: enquanto a gravação da janela fechada não
// voltava, o botão da janela nova não fazia nada — e o erro, quando voltava,
// aparecia no formulário da nova.
test('falha lenta de uma janela fechada nao trava nem suja a janela seguinte', async () => {
  let falhar;
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_corrigir_julgado_cj': () => new Promise((_, rejeitar) => { falhar = rejeitar; })
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('voto').value = 'Anular';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  await wait();
  page.dialogo.close();

  page.acao(0, 'Religar ao acervo').dispatch('click');
  page.form.dispatch('submit');
  await wait();
  assert.equal(page.document.getElementById('edicaoEtapaRotulo').textContent, 'Etapa 2 de 2',
    'a janela nova avança sem esperar a gravação da anterior');

  falhar(new Error('sem rede'));
  await wait();
  assert.equal(page.dialogo.aberto, true);
  assert.equal(page.document.getElementById('edicaoErro').hidden, true,
    'o erro da janela antiga não aparece no formulário da nova');
  assert.equal(page.avisos.at(-1).tipo, 'erro', 'a falha continua sendo anunciada');
});

// Renumerar só as distribuições também derruba o vínculo dos julgados — o banco
// devolve quais em `desvinculados` —, e a revisão só avisava no escopo inverso.
test('renumerar so as distribuicoes avisa que o vinculo dos julgados cai', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_registros_do_processo': [
        { origem_registro: 'acervo', registro_id: 7, data_referencia: '2026-06-18',
          pauta: null, destino: 'CJ3', vinculado: null },
        { origem_registro: 'julgados', registro_id: 41, data_referencia: '2026-07-09',
          pauta: 24, destino: 'CJ3', vinculado: true }
      ]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '202600000009999';
  page.campo('escopo').value = 'acervo';
  page.form.dispatch('submit');
  await wait();

  const itens = page.document.getElementById('edicaoImpactoLista').children
    .map(item => item.textContent);
  assert.equal(itens.length, 2, 'só a distribuição é alcançada, mais o aviso do vínculo');
  assert.match(itens[0], /Distribuição de 18\/06\/2026/);
  assert.match(itens[1], /sem renumerar os julgados.*perdem o vínculo/);
});

// A lista da etapa 2 tinha título fixo, "Julgados que serão alterados junto", e
// a renumeração a reaproveita para listar distribuições.
test('o titulo da lista de impacto diz o que ela lista', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_registros_do_processo': [
        { origem_registro: 'acervo', registro_id: 7, data_referencia: '2026-06-18',
          pauta: null, destino: 'CJ3', vinculado: null }
      ]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();
  const titulo = page.document.getElementById('edicaoImpactoTitulo');

  page.acao(0, 'Corrigir número').dispatch('click');
  page.campo('num_novo').value = '202600000009999';
  page.form.dispatch('submit');
  await wait();
  assert.equal(titulo.textContent, 'Registros alcançados pela renumeração');

  page.dialogo.close();
  page.acao(0, 'Corrigir dados').dispatch('click');
  page.campo('relator').value = 'CJ4';
  page.form.dispatch('submit');
  await wait();
  assert.equal(page.document.getElementById('edicaoImpacto').hidden, false);
  assert.equal(titulo.textContent, 'Julgados que serão alterados junto',
    'a janela seguinte não herda o título da anterior');
});
