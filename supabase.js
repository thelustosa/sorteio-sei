// Configuração e login do Supabase, compartilhados pelas páginas do sistema
// (index.html e julgados.html). Carregue este arquivo antes do script da página.
//
// SUPABASE_KEY aceita tanto a chave "publishable" (sb_publishable_...) quanto a
// "anon" legada. Ambas são públicas por natureza; quem protege as tabelas é a
// RLS (ver schema.sql). A chave "service_role"/"secret" NUNCA deve vir para cá.
const SUPABASE_URL = 'https://giipnmpfclfudkzflwsv.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_WYv2jjJhPscl7FlUljaRrQ_EFZ5xXpw';

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

async function autenticar(email, senha) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Banco de dados não configurado. Procure o responsável pela manutenção.');
  }

  const resp = await fetch(`${baseUrl()}/auth/v1/token?grant_type=password`, {
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

// Chamada REST autenticada. Devolve o JSON da resposta (ou null quando vazia).
// O erro carrega o status HTTP para quem precisa distinguir um caso específico.
async function api(caminho, opcoes = {}) {
  const resp = await fetch(`${baseUrl()}/rest/v1/${caminho}`, {
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

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginErro.textContent = '';
    btnEntrar.disabled = true;
    btnEntrar.textContent = 'Entrando…';

    try {
      salvarSessao(await autenticar(loginEmail.value.trim(), loginSenha.value));
      loginForm.reset();
      loginScreen.style.display = 'none';
      btnSair.hidden = false;
      await aoEntrar();
    } catch (err) {
      loginErro.textContent = err.message === 'Failed to fetch'
        ? 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.'
        : err.message;
    } finally {
      btnEntrar.disabled = false;
      btnEntrar.textContent = 'Entrar';
    }
  });

  // Sair descarta o token e limpa o que estava em andamento.
  btnSair.addEventListener('click', () => {
    encerrarSessao();
    location.reload();
  });

  exigirLogin = mensagem => {
    encerrarSessao();
    loginScreen.style.display = 'flex';
    btnSair.hidden = true;
    loginErro.textContent = mensagem;
    loginEmail.focus();
  };

  if (restaurarSessao()) {
    loginScreen.style.display = 'none';
    btnSair.hidden = false;
    Promise.resolve(aoEntrar()).catch(err => {
      exigirLogin('Não foi possível restaurar a sessão. Entre novamente.');
      console.error(err);
    });
  }
}

function aviso(texto, alerta = false) {
  const msg = document.createElement('div');
  msg.className = alerta ? 'toast alerta' : 'toast';
  msg.setAttribute('role', alerta ? 'alert' : 'status');
  msg.setAttribute('aria-live', alerta ? 'assertive' : 'polite');
  msg.textContent = texto;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), alerta ? 60000 : 8000);
}
