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
  const window = { addEventListener() {} };
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
      CADEIRAS_CJ, rotularCadeira, criarIndicadorCarregamento,
      estadoSessao: () => ({ accessToken, refreshToken })
    };`)(document, window, navigator, location, sessionStorage, fetch, apiSubstituta);
  return { ...app, document, navegacoes, storage };
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
    document, { inicializarAcervo() {} }, {}, { replace(destino) { navegacoes.push(destino); } },
    { getItem() { return null; }, setItem() {}, removeItem() {} }, fetch);

  return { app, controleCj, controleCreg, document, navegacoes };
}

// O de-para das cadeiras mora no supabase.js, que toda página carrega antes do
// seu próprio script. As telas o enxergam como global; aqui ele é injetado, e
// vem do arquivo de verdade para que uma divergência apareça como falha.
const { CADEIRAS_CJ, rotularCadeira, criarIndicadorCarregamento } = supabaseApp(async () => {});

function indexPage({ api = async () => null, aviso = () => {},
  supabaseUrl = 'url', supabaseKey = 'key', token = 'token' } = {}) {
  const document = new Document();
  const add = (id, tag) => document.add(id, tag);
  const tbody = add('processTableBody', 'tbody');
  add('resultTableBody', 'tbody');
  ['numRows', 'createRows', 'sortear', 'addRowBtn', 'btnCreg', 'btnCj', 'btnVoltar',
    'modeSelector', 'sorteadorContent', 'thRecurso', 'thInteressado', 'pillsContainer', 'txtModo',
    'processEntry', 'processSetupHint', 'processFormMessage', 'resultadoSorteio',
    'sortControls', 'resumoContagem', 'resultadoStatus', 'thUnidadeResult',
    'modeSelectorTitle', 'resultadoSorteioTitle', 'baixarBackup'].forEach(id => add(id, id.includes('Btn') || id.startsWith('btn') || id === 'createRows' || id === 'sortear' || id === 'baixarBackup' ? 'button' : 'div'));
  document.getElementById('sorteadorContent').hidden = true;
  document.getElementById('processEntry').hidden = true;
  document.getElementById('sortear').hidden = true;
  document.getElementById('resultadoSorteio').hidden = true;
  document.getElementById('numRows').value = '3';

  const app = new Function('document', 'window', 'crypto', 'URL', 'Blob', 'setTimeout', 'requestAnimationFrame',
    'SUPABASE_URL', 'SUPABASE_KEY', 'accessToken', 'api', 'criarIndicadorCarregamento', 'alternarBotaoCarregando', 'aviso',
    'CADEIRAS_CJ', 'rotularCadeira',
    `${source('index.js')}\nreturn { inicializarSorteio };`)(
    document, { matchMedia: () => ({ matches: true }) }, { getRandomValues: values => values.fill(0) },
    { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob, () => 0,
    callback => callback(), supabaseUrl, supabaseKey, token, api,
    () => document.createElement('div'), () => {}, aviso, CADEIRAS_CJ, rotularCadeira);
  return { document, tbody, ...app };
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
  encerrar = () => {},
  carregar = async () => {},
  location = { replace() {} }
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
    'aplicarVisibilidadePorOrgao', 'erroSemPermissao', 'encerrarSessao',
    `${source('bootstrap.js')}\nreturn {
      resolverDestinoPermitido: typeof resolverDestinoPermitido === 'function' ? resolverDestinoPermitido : undefined,
      carregarPaginaAutenticada
    };`)(
    document, { [inicializadores[pagina]]: inicializar }, location, 'teste', carregar,
    texto => { const estado = document.createElement('div'); estado.textContent = texto; return estado; },
    callback => { aoEntrar = callback; }, buscarOrgaos, aplicarVisibilidade, erroPermissao, encerrar);

  return { ...app, sessionLoading, loginScreen, loginErro, btnSair, iniciar: () => aoEntrar() };
}

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

test('nega usuário sem órgãos antes de carregar o módulo', async () => {
  let encerrou = 0;
  let scriptsCarregados = 0;
  const page = bootstrapPage(async () => {}, 'acervo-cj', {
    buscarOrgaos: async () => new Set(),
    encerrar: () => { encerrou++; },
    carregar: async () => { scriptsCarregados++; }
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await page.iniciar();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(encerrou, 1);
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
    encerrar: () => { encerrou++; },
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

test('bootstrap mantém o loading geral até a inicialização assíncrona terminar', async () => {
  let concluir;
  const page = bootstrapPage(() => new Promise(resolve => { concluir = resolve; }));
  const carregamento = page.iniciar();
  await wait();

  assert.equal(page.sessionLoading.hidden, false);
  assert.equal(page.sessionLoading.children.length, 1);

  concluir();
  await carregamento;
  assert.equal(page.sessionLoading.hidden, true,
    'o loading não pode sair enquanto dados e interface ainda estão sendo preparados');
});

test('julgados prioriza o loading menor enquanto busca as pautas', async () => {
  let concluir;
  const page = bootstrapPage(() => new Promise(resolve => { concluir = resolve; }), 'julgados-cj');
  const carregamento = page.iniciar();
  await wait();

  assert.equal(page.sessionLoading.hidden, true,
    'o loading geral não pode competir com o indicador local das pautas');
  assert.equal(page.sessionLoading.children.length, 0);

  concluir();
  await carregamento;
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
  const detalheCorpo = document.add('detalheCorpo', 'div');
  document.add('detalheTable', 'table');
  const detalheErro = document.add('detalheErro', 'div');
  detalheErro.hidden = true;
  detalheErro.appendChild(document.createElement('p'));
  document.add('btnFecharDetalhe', 'button');
  document.add('btnExportarDetalhe', 'button');
  document.getElementById('acervoPanel').hidden = true;
  document.getElementById('btnAtualizar').hidden = true;  // como no acervo-cj.html

  const app = new Function('document', 'window', 'api', 'criarIndicadorCarregamento',
    `${source('acervo.js')}\nreturn { inicializarAcervo, carregarAcervo, exportar, criarExcel, criarExcelDetalhe, dadosTabulares, abrirDetalhe, exportarDetalhe };`)(
    document, { print: imprimir }, api, criarIndicadorCarregamento);
  return { document, loginOnlyCard, dialog, ...app };
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

test('acervo só revela o dashboard depois que os dados estão prontos', async () => {
  let responder;
  const page = acervoPage(() => new Promise(resolve => { responder = resolve; }));
  const inicializacao = page.inicializarAcervo();
  await wait();

  assert.equal(page.document.getElementById('acervoPanel').hidden, true,
    'cabeçalho e rodapé do dashboard não devem aparecer sem os dados');
  assert.equal(page.loginOnlyCard.hidden, false,
    'o contêiner do loading geral precisa permanecer visível');

  responder([
    { ordem: 1, faixa: 'Até 15 dias', relator: 'Dorivan de Souza Lima', processos: 1 }
  ]);
  await inicializacao;

  assert.equal(page.document.getElementById('acervoPanel').hidden, false);
  assert.equal(page.loginOnlyCard.hidden, true,
    'o loading geral deve sair junto com a entrada do dashboard completo');
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

// ── Card de detalhe ──────────────────────────────────────────────────────────
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
  ['historicoPanel', 'historicoVazio', 'historicoVazioTexto', 'historicoInicio',
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
  document.getElementById('historicoPanel').hidden = true;
  document.getElementById('btnAtualizar').hidden = true;  // como nas páginas

  const app = new Function('document', 'api', 'criarIndicadorCarregamento',
    `${source('historico.js')}\nreturn { inicializarHistorico, carregarHistorico, abrirDetalhe,
      criarDocxDetalhe, exportarDetalheDocx };`)(
    document, api, criarIndicadorCarregamento);
  return { document, loginOnlyCard, dialog, ...app };
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
  assert.equal(vazia.document.getElementById('historicoInicio').textContent,
    'Série iniciada em 27/08/2026');
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
  assert.equal(cheia.document.getElementById('historicoInicio').textContent,
    'Série iniciada em 27/08/2026');
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

test('histórico só revela o painel depois que os dados estão prontos', async () => {
  let responder;
  const page = historicoPage(() => new Promise(resolve => { responder = resolve; }), 'creg');
  const carregamento = page.inicializarHistorico();
  await wait();

  assert.equal(page.document.getElementById('historicoPanel').hidden, true);
  assert.equal(page.document.getElementById('btnAtualizar').hidden, true,
    'Atualizar redesenharia uma tabela ainda escondida');

  responder(sorteiosCreg);
  await carregamento;

  assert.equal(page.loginOnlyCard.hidden, true);
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
