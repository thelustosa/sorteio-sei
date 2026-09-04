// Configuração e login do Supabase, compartilhados pelas páginas do sistema
// (index.html, julgados-cj.html, julgados-creg.html, acervo-cj.html, acervo-creg.html
// e historico.html).
// Carregue este arquivo antes do script da página.
//
// SUPABASE_KEY aceita tanto a chave "publishable" (sb_publishable_...) quanto a
// "anon" legada. Ambas são públicas por natureza; quem protege as tabelas é a
// RLS (ver schema.sql). A chave "service_role"/"secret" NUNCA deve vir para cá.
const SUPABASE_URL = 'https://giipnmpfclfudkzflwsv.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_WYv2jjJhPscl7FlUljaRrQ_EFZ5xXpw';
const ASSET_VERSION = '3381eed4f1';
const TEMPO_LIMITE_REDE = 20000;

// Quem ocupa cada cadeira da CJ. Espelha a tabela cadeiras_cj do banco (um
// teste compara as duas listas), e mora aqui — e não na página do sorteio —
// porque as três telas mostram a cadeira e precisam do nome para o hover.
// O que é gravado é sempre a CADEIRA; o nome existe só para apresentação.
const CADEIRAS_CJ = {
  CJ1: 'Paulo Otoni Ribeiro',
  CJ2: 'Deusdete Cardoso Belém',
  CJ3: 'Dorivan de Souza Lima',
  CJ4: 'Paulo Henrique Oliveira Marques',
  CJ5: 'Lorena Patricia de Oliveira'
};

// Rótulo de uma cadeira nas tabelas: mostra "CJ3" e revela o conselheiro no
// hover e no leitor de tela. Valor que não é cadeira (histórico de composições
// anteriores, que ficou pelo nome) passa intacto e sem title vazio.
function rotularCadeira(el, valor) {
  const nome = CADEIRAS_CJ[valor];
  if (!nome) return el;
  el.title = nome;
  el.setAttribute('aria-label', `${valor} — ${nome}`);
  return el;
}

// O token fica somente na aba atual: navegar entre as páginas preserva a sessão,
// mas fechar a aba a encerra. Senhas nunca são armazenadas.
const SESSION_ACCESS_TOKEN_KEY = 'sorteio-sei.access-token';
const SESSION_REFRESH_TOKEN_KEY = 'sorteio-sei.refresh-token';
let accessToken = '';
let refreshToken = '';
let renovacaoEmAndamento = null;

function salvarSessao(sessao) {
  accessToken = sessao.access_token || accessToken;
  refreshToken = sessao.refresh_token || refreshToken;
  try {
    sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, accessToken);
    sessionStorage.setItem(SESSION_REFRESH_TOKEN_KEY, refreshToken);
  } catch (_) {
    // Sem armazenamento disponível, a sessão continua válida até a próxima navegação.
  }
  document.documentElement?.classList?.add('has-session');
}

function restaurarSessao() {
  try {
    accessToken = sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY) || '';
    refreshToken = sessionStorage.getItem(SESSION_REFRESH_TOKEN_KEY) || '';
  } catch (_) {
    accessToken = '';
    refreshToken = '';
  }
  const temSessao = Boolean(accessToken);
  document.documentElement?.classList?.toggle('has-session', temSessao);
  return temSessao;
}

function encerrarSessao() {
  accessToken = '';
  refreshToken = '';
  try {
    sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_REFRESH_TOKEN_KEY);
  } catch (_) {
    // A sessão em memória já foi descartada.
  }
  document.documentElement?.classList?.remove('has-session');
}

async function revogarSessaoAtual() {
  if (!accessToken) return;

  const resp = await fetchComTimeout(`${baseUrl()}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  // Um 401 significa que a sessão já não existe no servidor, portanto o
  // resultado desejado do logout também foi alcançado.
  if (!resp.ok && resp.status !== 401) {
    throw new Error('Não foi possível encerrar a sessão no servidor.');
  }
}

async function sair() {
  try {
    await revogarSessaoAtual();
  } finally {
    // Mesmo sem rede, não deixa credenciais utilizáveis nesta aba.
    encerrarSessao();
  }
}

// Aceita a URL com ou sem o sufixo /rest/v1 e com ou sem barra final.
function baseUrl() {
  return SUPABASE_URL.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

async function fetchComTimeout(url, opcoes = {}) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TEMPO_LIMITE_REDE);

  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('O servidor demorou mais de 20 segundos para responder. Tente novamente.');
    }
    throw err;
  } finally {
    clearTimeout(temporizador);
  }
}

const scriptsCarregados = new Map();

function carregarScript(caminho) {
  if (scriptsCarregados.has(caminho)) return scriptsCarregados.get(caminho);

  const carregamento = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = caminho;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => {
      scriptsCarregados.delete(caminho);
      script.remove();
      reject(new Error('Falha ao carregar os recursos da página.'));
    }, { once: true });
    document.head.appendChild(script);
  });

  scriptsCarregados.set(caminho, carregamento);
  return carregamento;
}

async function autenticar(email, senha) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Banco de dados não configurado. Procure o responsável pela manutenção.');
  }

  const resp = await fetchComTimeout(`${baseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });

  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detalhe = dados.error_description || dados.msg || dados.message || '';
    if (/invalid login|invalid_grant/i.test(detalhe)) throw new Error('E-mail ou senha inválidos.');
    if (/disabled/i.test(detalhe)) throw new Error('O acesso por e-mail está desativado no servidor. Procure o responsável pela manutenção.');
    if (/not confirmed/i.test(detalhe)) throw new Error('Usuário ainda não confirmado. Procure o responsável pela manutenção.');
    throw new Error(detalhe || 'Não foi possível entrar. Tente novamente.');
  }
  return dados;
}

async function executarRenovacao() {
  if (!refreshToken) {
    throw Object.assign(
      new Error('Não foi possível renovar a sessão. Use Sair e entre novamente.'),
      { status: 401 });
  }

  const resp = await fetchComTimeout(`${baseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const dados = await resp.json().catch(() => ({}));

  if (!resp.ok || !dados.access_token) {
    throw Object.assign(
      new Error('Não foi possível renovar a sessão. Use Sair e entre novamente.'),
      { status: 401 });
  }

  // O Supabase pode rotacionar o refresh token. salvarSessao conserva o atual
  // quando a resposta traz apenas um access token e atualiza os dois quando
  // recebe o novo par.
  salvarSessao(dados);
}

function renovarSessao() {
  // Páginas como o dashboard disparam mais de uma chamada juntas. Compartilhar
  // a renovação evita tentar reutilizar simultaneamente um refresh token que o
  // servidor acabou de rotacionar.
  if (!renovacaoEmAndamento) {
    renovacaoEmAndamento = executarRenovacao()
      .finally(() => { renovacaoEmAndamento = null; });
  }
  return renovacaoEmAndamento;
}

// Estados de carregamento compartilhados: a interface nunca depende de texto
// solto para explicar uma operação que ainda está em andamento.
function criarIndicadorCarregamento(texto) {
  const estado = document.createElement('div');
  estado.className = 'loading-state';
  estado.setAttribute('role', 'status');
  estado.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const rotulo = document.createElement('span');
  rotulo.textContent = texto;
  estado.append(spinner, rotulo);
  return estado;
}

function alternarBotaoCarregando(botao, carregando, texto) {
  if (!botao) return;

  if (carregando) {
    botao.dataset.rotuloOriginal = botao.textContent.trim();
    botao.style.minWidth = `${Math.ceil(botao.getBoundingClientRect().width)}px`;
    botao.disabled = true;
    botao.classList.add('is-loading');
    botao.setAttribute('aria-busy', 'true');

    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner loading-spinner-light';
    spinner.setAttribute('aria-hidden', 'true');
    const rotulo = document.createElement('span');
    rotulo.textContent = texto;
    botao.replaceChildren(spinner, rotulo);
    return;
  }

  botao.disabled = false;
  botao.classList.remove('is-loading');
  botao.removeAttribute('aria-busy');
  botao.textContent = botao.dataset.rotuloOriginal || botao.textContent;
  botao.style.removeProperty('min-width');
  delete botao.dataset.rotuloOriginal;
}

// Chamada REST autenticada. Devolve o JSON da resposta (ou null quando vazia).
// O erro carrega o status HTTP para quem precisa distinguir um caso específico.
async function api(caminho, opcoes = {}) {
  const requisitar = () => fetchComTimeout(`${baseUrl()}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...opcoes.headers
    }
  });

  let resp = await requisitar();

  // Access tokens são curtos. Renova o par de tokens e repete a chamada uma
  // única vez, mantendo a interface e o trabalho em andamento. Só o botão Sair
  // encerra a sessão local.
  if (resp.status === 401) {
    await renovarSessao();
    resp = await requisitar();
  }

  if (resp.ok) return resp.status === 204 ? null : resp.json().catch(() => null);

  if (resp.status === 401) {
    throw Object.assign(
      new Error('Não foi possível validar a sessão. Use Sair e entre novamente.'),
      { status: 401 });
  }

  // O PostgREST devolve o erro em JSON; a mensagem sozinha é o que serve para o
  // funcionário ler, sem o resto do envelope.
  const corpo = await resp.text();
  let detalhe = corpo;
  try {
    detalhe = JSON.parse(corpo).message || corpo;
  } catch (_) {
    // Resposta não era JSON: fica o texto cru mesmo.
  }

  throw Object.assign(new Error(detalhe || `HTTP ${resp.status}`), { status: resp.status });
}

const ORGAOS_CONHECIDOS = new Set(['CJ', 'CREG']);

async function buscarOrgaosAutorizados() {
  const linhas = await api('rpc/orgaos_autorizados', {
    method: 'POST',
    body: '{}'
  });
  return new Set((linhas || [])
    .map(linha => linha.orgao)
    .filter(orgao => ORGAOS_CONHECIDOS.has(orgao)));
}

function aplicarVisibilidadePorOrgao(orgaos, raiz = document) {
  raiz.querySelectorAll('[data-orgao]').forEach(elemento => {
    elemento.hidden = !orgaos.has(elemento.dataset.orgao);
  });

  // Quem só tem um colegiado veria o botão restante preso à metade esquerda da
  // grade de dois, com um vazio do lado. A classe troca a grade por uma coluna
  // só e centraliza a escolha única.
  raiz.querySelectorAll('.buttons-wrapper').forEach(grupo => {
    const visiveis = [...grupo.children].filter(botao => !botao.hidden);
    grupo.classList.toggle('single-choice', visiveis.length === 1);
  });
}

function erroSemPermissao() {
  return Object.assign(
    new Error('Seu usuário não possui acesso liberado. Procure o responsável pela manutenção.'),
    { status: 403, semPermissao: true }
  );
}

// Liga o formulário de login padrão da página. Chama aoEntrar() quando der certo.
// Depende dos ids loginScreen/loginForm/loginEmail/loginSenha/loginErro/btnEntrar/btnSair.
function ligarLogin(aoEntrar) {
  const loginScreen = document.getElementById('loginScreen');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginSenha = document.getElementById('loginSenha');
  const loginErro = document.getElementById('loginErro');
  const btnEntrar = document.getElementById('btnEntrar');
  const btnSair = document.getElementById('btnSair');
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginErro.textContent = '';
    alternarBotaoCarregando(btnEntrar, true, 'Entrando…');

    try {
      salvarSessao(await autenticar(loginEmail.value.trim(), loginSenha.value));
      loginForm.reset();
      loginScreen.hidden = true;
      btnSair.hidden = false;
      await aoEntrar();
    } catch (err) {
      loginErro.textContent = err.message === 'Failed to fetch'
        ? 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.'
        : err.message;
    } finally {
      alternarBotaoCarregando(btnEntrar, false);
    }
  });

  // Revoga a sessão atual no servidor antes de descartar os tokens locais.
  btnSair.addEventListener('click', async () => {
    alternarBotaoCarregando(btnSair, true, 'Saindo…');
    try {
      await sair();
    } catch (err) {
      console.error(err);
    } finally {
      // Substitui a página protegida no histórico para que o logout sempre
      // termine no login inicial, independentemente da tela de origem.
      location.replace('./index.html');
    }
  });

  if (restaurarSessao()) {
    loginScreen.hidden = true;
    btnSair.hidden = false;
    Promise.resolve(aoEntrar()).catch(err => {
      aviso(`Não foi possível restaurar os dados da página (${err.message}).`, 'erro');
      console.error(err);
    });
  }
}

// A severidade vinha embutida como emoji no início do texto e era lida de volta
// por regex — canal frágil, que já classificava "nada para salvar" como falha.
// Agora é um parâmetro explícito.
const TIPOS_AVISO = {
  sucesso: { titulo: 'Concluído', classe: 'toast-sucesso', assertivo: false },
  atencao: { titulo: 'Atenção', classe: 'toast-alerta', assertivo: true },
  erro: { titulo: 'Não foi possível concluir', classe: 'toast-alerta', assertivo: true }
};

const TRACADO_AVISO = {
  sucesso: 'm5 12 4 4L19 6',
  alerta: 'M12 8v4m0 4h.01M5.1 19h13.8a1 1 0 0 0 .9-1.5L12.9 5a1 1 0 0 0-1.8 0L4.2 17.5a1 1 0 0 0 .9 1.5Z'
};

function posicionarRegiaoDeAvisos(regiao) {
  const telaEstreita = window.matchMedia?.('(max-width: 600px)').matches;
  if (telaEstreita) {
    regiao.style.top = 'auto';
    regiao.style.bottom = '16px';
    return;
  }

  // Alinha o topo do aviso com o topo do conteúdo (a borda superior do card),
  // e não com a barra verde: depois do sorteio a página rola até o resultado e
  // o aviso ficava flutuando acima do card.
  const conteudo = document.querySelector('main');
  const topoConteudo = conteudo
    && conteudo.getBoundingClientRect().top + parseFloat(getComputedStyle(conteudo).paddingTop);
  regiao.style.top = `${Number.isFinite(topoConteudo) ? Math.max(12, topoConteudo) : 20}px`;
  regiao.style.bottom = 'auto';
}

function aviso(texto, tipo = 'sucesso') {
  const { titulo: rotulo, classe, assertivo } = TIPOS_AVISO[tipo] || TIPOS_AVISO.sucesso;

  let regiao = document.getElementById('toastRegion');
  if (!regiao) {
    regiao = document.createElement('div');
    regiao.id = 'toastRegion';
    regiao.className = 'toast-region';
    regiao.setAttribute('aria-label', 'Notificações');
    const navegacao = document.querySelector('.green-bar');
    if (navegacao) navegacao.insertAdjacentElement('afterend', regiao);
    else document.body.appendChild(regiao);

    const reposicionar = () => {
      if (regiao.firstChild) posicionarRegiaoDeAvisos(regiao);
    };
    window.addEventListener('resize', reposicionar);
    window.addEventListener('scroll', reposicionar, { passive: true });
  }

  // Um aviso por vez. Cada ação do sistema produz exatamente um resultado, então
  // o aviso anterior descreve um estado que já passou: deixá-lo na tela é como
  // manter "nada para salvar" depois de um salvamento que deu certo. O erro dura
  // 60s para dar tempo de ler, e era justamente ele que sobrevivia à própria
  // causa. O temporizador antigo continua agendado e vira um no-op, porque
  // remover um nó já removido não faz nada.
  regiao.replaceChildren();

  const msg = document.createElement('div');
  msg.className = `toast ${classe}`;
  msg.setAttribute('role', assertivo ? 'alert' : 'status');
  msg.setAttribute('aria-live', assertivo ? 'assertive' : 'polite');

  const icone = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icone.classList.add('toast-icon');
  icone.setAttribute('viewBox', '0 0 24 24');
  icone.setAttribute('fill', 'none');
  icone.setAttribute('stroke', 'currentColor');
  icone.setAttribute('stroke-width', '2');
  icone.setAttribute('stroke-linecap', 'round');
  icone.setAttribute('stroke-linejoin', 'round');
  icone.setAttribute('aria-hidden', 'true');
  const tracado = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tracado.setAttribute('d', assertivo ? TRACADO_AVISO.alerta : TRACADO_AVISO.sucesso);
  icone.appendChild(tracado);

  const conteudo = document.createElement('div');
  conteudo.className = 'toast-content';
  const titulo = document.createElement('strong');
  titulo.className = 'toast-title';
  titulo.textContent = rotulo;
  const detalhe = document.createElement('span');
  detalhe.className = 'toast-detail';
  detalhe.textContent = texto;
  conteudo.append(titulo, detalhe);

  const fechar = document.createElement('button');
  fechar.type = 'button';
  fechar.className = 'toast-dismiss';
  fechar.setAttribute('aria-label', 'Fechar notificação');
  fechar.textContent = 'Fechar';

  const remover = () => msg.remove();
  const temporizador = setTimeout(remover, assertivo ? 60000 : 8000);
  fechar.addEventListener('click', () => {
    clearTimeout(temporizador);
    remover();
  });

  msg.append(icone, conteudo, fechar);
  regiao.appendChild(msg);
  posicionarRegiaoDeAvisos(regiao);
}
