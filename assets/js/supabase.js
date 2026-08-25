// Configuração e login do Supabase, compartilhados pelas páginas do sistema
// (index.html e julgados.html). Carregue este arquivo antes do script da página.
//
// SUPABASE_KEY aceita tanto a chave "publishable" (sb_publishable_...) quanto a
// "anon" legada. Ambas são públicas por natureza; quem protege as tabelas é a
// RLS (ver schema.sql). A chave "service_role"/"secret" NUNCA deve vir para cá.
const SUPABASE_URL = 'https://giipnmpfclfudkzflwsv.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_WYv2jjJhPscl7FlUljaRrQ_EFZ5xXpw';
const ASSET_VERSION = '2b29df4a3b';
const TEMPO_LIMITE_REDE = 20000;

// O token fica somente na aba atual: navegar entre as páginas preserva a sessão,
// mas fechar a aba a encerra. Senhas nunca são armazenadas.
const SESSION_TOKEN_KEY = 'sorteio-sei.access-token';
let accessToken = '';

function salvarSessao(token) {
  accessToken = token;
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch (_) {
    // Sem armazenamento disponível, a sessão continua válida até a próxima navegação.
  }
}

function restaurarSessao() {
  try {
    accessToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
  } catch (_) {
    accessToken = '';
  }
  return Boolean(accessToken);
}

function encerrarSessao() {
  accessToken = '';
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch (_) {
    // A sessão em memória já foi descartada.
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
  return dados.access_token;
}

// Devolve a página à tela de login. Cada página instala a sua em ligarLogin;
// até lá é um no-op, porque não há formulário para mostrar.
let exigirLogin = () => {};

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
  const resp = await fetchComTimeout(`${baseUrl()}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...opcoes.headers
    }
  });

  if (resp.ok) return resp.status === 204 ? null : resp.json().catch(() => null);

  // O token do Supabase expira em cerca de uma hora. Devolver a tela de login
  // aqui, e não em cada chamada, garante que nenhuma página fique com aparência
  // de logada depois que a sessão morreu.
  if (resp.status === 401) {
    exigirLogin('Sua sessão expirou. Entre novamente para continuar.');
    throw Object.assign(new Error('sessão expirada — entre novamente'), { status: 401 });
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
  const loginOnlyCard = loginScreen.closest('[data-login-only]');

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

  // Sair descarta o token e limpa o que estava em andamento.
  btnSair.addEventListener('click', () => {
    encerrarSessao();
    location.reload();
  });

  // Quando a sessão cai, a tela de login voltava por cima do que estava aberto:
  // a página mostrava o formulário e, logo abaixo, o resultado do sorteio ou a
  // lista de pautas da sessão que acabou de expirar. Além de confuso, deixava o
  // trabalho da pessoa anterior na tela para quem chegasse depois. Cada página
  // marca com data-sessao o que só existe para quem está autenticado.
  const conteudoDaSessao = document.querySelectorAll('[data-sessao]');

  exigirLogin = mensagem => {
    encerrarSessao();
    conteudoDaSessao.forEach(el => { el.hidden = true; });
    if (loginOnlyCard) loginOnlyCard.hidden = false;
    loginScreen.hidden = false;
    btnSair.hidden = true;
    loginErro.textContent = mensagem;
    loginEmail.focus();
  };

  if (restaurarSessao()) {
    loginScreen.hidden = true;
    btnSair.hidden = false;
    Promise.resolve(aoEntrar()).catch(err => {
      exigirLogin('Não foi possível restaurar a sessão. Entre novamente.');
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

function aviso(texto, tipo = 'sucesso') {
  const { titulo: rotulo, classe, assertivo } = TIPOS_AVISO[tipo] || TIPOS_AVISO.sucesso;

  let regiao = document.getElementById('toastRegion');
  if (!regiao) {
    regiao = document.createElement('div');
    regiao.id = 'toastRegion';
    regiao.className = 'toast-region';
    regiao.setAttribute('aria-label', 'Notificações');
    document.body.appendChild(regiao);
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
}

// Limpeza única: versões anteriores registravam um service worker que servia
// assets do cache indefinidamente e acabava misturando CSS antigo com JS novo.
// A versão dos assets agora é o hash do conteúdo, então o cache do navegador
// basta. ponytail: remover este bloco depois que os usuários carregarem esta
// versão ao menos uma vez (algumas semanas).
function removerCacheAntigo() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations()
    .then(registros => Promise.all(registros.map(registro => registro.unregister())))
    .catch(() => {});
  if ('caches' in window) {
    caches.keys()
      .then(nomes => Promise.all(nomes
        .filter(nome => nome.startsWith('sorteio-sei-assets-'))
        .map(nome => caches.delete(nome))))
      .catch(() => {});
  }
}

window.addEventListener('load', removerCacheAntigo, { once: true });
