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
  removeAttribute(name) { delete this[name]; }
  getBoundingClientRect() { return { width: 100 }; }
  scrollIntoView() {}
  focus() { this.document.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === '[data-login-only]') return Object.hasOwn(this.dataset, 'loginOnly');
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

function supabaseApp(fetch) {
  const document = new Document();
  const window = { addEventListener() {} };
  const navigator = {};
  const location = { protocol: 'http:' };
  const sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  return new Function('document', 'window', 'navigator', 'location', 'sessionStorage', 'fetch',
    `${source('supabase.js')}\nreturn { autenticar };`)(
    document, window, navigator, location, sessionStorage, fetch);
}

function indexPage({ api = async () => null, aviso = () => {},
  supabaseUrl = 'url', supabaseKey = 'key', token = 'token' } = {}) {
  const document = new Document();
  const add = (id, tag) => document.add(id, tag);
  const tbody = add('processTableBody', 'tbody');
  add('resultTableBody', 'tbody');
  ['numRows', 'createRows', 'sortear', 'addRowBtn', 'btnCreg', 'btnCj', 'btnVoltar',
    'modeSelector', 'sorteadorContent', 'thRecurso', 'pillsContainer', 'txtModo',
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
    `${source('index.js')}\nreturn { inicializarSorteio };`)(
    document, { matchMedia: () => ({ matches: true }) }, { getRandomValues: values => values.fill(0) },
    { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob, () => 0,
    callback => callback(), supabaseUrl, supabaseKey, token, api,
    () => document.createElement('div'), () => {}, aviso);
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
    `${source('julgados.js')}\nreturn { abrirPauta, salvar, inicializarJulgados, pendentesPorPauta };`)(
    document, registrar, () => {}, () => {}, () => document.createElement('div'));
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

test('mantém o backup acessível depois de reautenticar por erro 401', async () => {
  let page;
  page = indexPage({
    api: async () => {
      page.document.getElementById('sorteadorContent').hidden = true;
      throw Object.assign(new Error('sessão expirada'), { status: 401 });
    }
  });
  const { document } = page;
  await preencherCreg(page, '202600029000403');
  document.getElementById('sortear').dispatch('click');
  await wait();

  assert.equal(document.getElementById('sorteadorContent').hidden, true);
  assert.equal(document.getElementById('btnVoltar').hidden, true);
  page.inicializarSorteio();

  assert.equal(document.getElementById('sorteadorContent').hidden, false);
  assert.equal(document.getElementById('resultadoSorteio').hidden, false);
  assert.equal(document.getElementById('baixarBackup').hidden, false);
  assert.equal(document.getElementById('btnVoltar').hidden, false);
  assert.equal(document.activeElement, document.getElementById('baixarBackup'));
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

test('autenticação envia credenciais ao endpoint esperado e devolve o token', async () => {
  let requisicao;
  const app = supabaseApp(async (url, options) => {
    requisicao = { url, options };
    return { ok: true, status: 200, json: async () => ({ access_token: 'token-de-teste' }) };
  });

  assert.equal(await app.autenticar('servidora@example.org', 'senha'), 'token-de-teste');
  assert.match(requisicao.url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.deepEqual(JSON.parse(requisicao.options.body), {
    email: 'servidora@example.org', password: 'senha'
  });
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

function bootstrapPage(inicializar) {
  const document = new Document();
  document.body.dataset.page = 'acervo';
  const sessionLoading = document.add('sessionLoading', 'div');
  sessionLoading.hidden = true;
  let aoEntrar;

  new Function('document', 'window', 'ASSET_VERSION', 'carregarScript',
    'criarIndicadorCarregamento', 'ligarLogin', source('bootstrap.js'))(
    document, { inicializarAcervo: inicializar }, 'teste', async () => {},
    texto => { const estado = document.createElement('div'); estado.textContent = texto; return estado; },
    callback => { aoEntrar = callback; });

  return { sessionLoading, iniciar: () => aoEntrar() };
}

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

function acervoPage(api) {
  const document = new Document();
  const loginOnlyCard = document.createElement('div');
  loginOnlyCard.dataset.loginOnly = '';
  document.body.append(loginOnlyCard);
  ['acervoPanel', 'acervoVazio', 'acervoTotal', 'acervoAtualizado']
    .forEach(id => document.add(id, 'div'));
  const erroDiv = document.add('acervoErro', 'div');
  erroDiv.appendChild(document.createElement('p'));
  document.add('acervoTable', 'table');
  document.add('btnAtualizar', 'button');
  document.add('btnImprimir', 'button');
  document.add('btnTentarNovamente', 'button');
  document.getElementById('acervoPanel').hidden = true;

  const app = new Function('document', 'window', 'api',
    `${source('acervo.js')}\nreturn { inicializarAcervo, carregarAcervo };`)(
    document, { print() {} }, api);
  return { document, loginOnlyCard, ...app };
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
  assert.equal(linhas[2].children[2].classList.contains('acervo-alerta'), true,
    'faixa crítica zerada deve permanecer vermelha');
  assert.equal(linhas[2].children[2].classList.contains('acervo-detalhe'), false,
    'faixa zerada não deve sugerir detalhamento disponível');
  assert.equal(linhas[2].children[2]['aria-label'], undefined,
    'faixa zerada não deve anunciar uma ocorrência inexistente');
});

test('acervo não anuncia falha de conexão quando a sessão expirou', async () => {
  const page = acervoPage(async () => {
    throw Object.assign(new Error('sessão expirada'), { status: 401 });
  });
  page.inicializarAcervo();
  await wait();

  assert.equal(page.document.getElementById('acervoErro').hidden, true,
    'a tela de login já explica o que houve; dois diagnósticos se contradizem');
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
