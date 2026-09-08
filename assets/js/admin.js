// Painel administrativo: correção dos registros já gravados.
//
// É a porta que registrar_votos anunciou quando explicou por que campo em
// branco não apaga decisão gravada — "DESFAZER é decisão administrativa, e vai
// ter porta própria". Aqui ela existe, e só para quem tem papel de admin.
//
// A navegação é por DATA, nunca por número de processo. Quando o próprio
// número está errado — que é um dos defeitos a corrigir — procurar por ele não
// acharia nada. Por isso as duas portas são "a sessão do dia tal" e "o sorteio
// do dia tal", e o número é editável de dentro delas.
//
// Nada é gravado sem duas etapas: o formulário monta a alteração, e a tela de
// confirmação mostra o que muda de quê para quê. Na correção de acervo mostra
// também os julgados que vão junto, lidos de admin_julgados_do_acervo.

const VOCABULARIO = {
  CJ: {
    nome: 'Câmara de Julgamento',
    sufixo: 'cj',
    destino: 'Relator',
    destinoPadrao: /^CJ[1-9][0-9]*$/,
    decisao: 'Defesa',
    campoDecisao: 'defesa',
    campoDestino: 'relator',
    votos: ['Manter', 'Anular', 'Vista'],
    status: ['Julgado', 'Retornou', 'Retirado', 'Vista'],
    assuntoObrigatorio: true,
    temInteressado: false
  },
  CREG: {
    nome: 'Conselho Regulador',
    sufixo: 'creg',
    destino: 'Unidade',
    destinoPadrao: /^CREG[1-9][0-9]*$/,
    decisao: 'Recurso',
    campoDecisao: 'recurso',
    campoDestino: 'unidade',
    votos: ['Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção', 'Retirado', 'Vista'],
    status: ['Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'],
    assuntoObrigatorio: false,
    temInteressado: true
  }
};

const OPERACOES_LEGIVEIS = {
  corrigir_julgado: 'Correção de julgado',
  religar_julgado: 'Religação ao acervo',
  corrigir_acervo: 'Correção de distribuição',
  redistribuir: 'Redistribuição',
  corrigir_processo: 'Correção do número do processo'
};

const seletorOrgaoCard = document.getElementById('seletorOrgaoCard');
const seletorOrgao = document.getElementById('seletorOrgao');
const abas = document.getElementById('abas');
const painel = document.getElementById('adminPainel');
const painelConteudo = document.getElementById('painelConteudo');
const painelTitulo = document.getElementById('painelTitulo');
const painelDescricao = document.getElementById('painelDescricao');
const painelTabela = document.getElementById('painelTable');
const painelCarregando = document.getElementById('painelCarregando');
const painelErro = document.getElementById('painelErro');
const painelVazio = document.getElementById('painelVazio');
const painelVazioTitulo = document.getElementById('painelVazioTitulo');
const painelVazioTexto = document.getElementById('painelVazioTexto');
const painelStatus = document.getElementById('painelStatus');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const btnVoltar = document.getElementById('btnVoltar');

const dialogo = document.getElementById('edicaoDialog');
const edicaoForm = document.getElementById('edicaoForm');
const edicaoTitulo = document.getElementById('edicaoTitulo');
const edicaoResumo = document.getElementById('edicaoResumo');
const edicaoCampos = document.getElementById('edicaoCampos');
const edicaoMotivo = document.getElementById('edicaoMotivo');
const edicaoEtapaCampos = document.getElementById('edicaoEtapaCampos');
const edicaoEtapaConfirmacao = document.getElementById('edicaoEtapaConfirmacao');
const edicaoDelta = document.getElementById('edicaoDelta');
const edicaoImpacto = document.getElementById('edicaoImpacto');
const edicaoImpactoLista = document.getElementById('edicaoImpactoLista');
const edicaoErro = document.getElementById('edicaoErro');
const btnAvancar = document.getElementById('btnAvancarEdicao');
const btnCancelar = document.getElementById('btnCancelarEdicao');
const btnFecharEdicao = document.getElementById('btnFecharEdicao');

let orgao = null;
let aba = 'sessoes';
// Onde estamos dentro da aba: null é a lista de datas; preenchido é o detalhe
// de uma data. É o que o botão Voltar desfaz.
let detalhe = null;
// Cada carregamento carrega um número. Resposta de pedido velho é descartada:
// trocar de aba durante uma consulta lenta não pode repintar a tabela errada.
let pedido = 0;
let dialogoAtual = null;

// ── Formatação ───────────────────────────────────────────────────────────────
// aaaa-mm-dd → dd/mm/aaaa sem passar por Date: o construtor lê data pura como
// UTC e, em fuso negativo, devolveria o dia anterior.
function dataBR(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function dataHoraBR(carimbo) {
  if (!carimbo) return '—';
  const instante = new Date(carimbo);
  return Number.isNaN(instante.getTime())
    ? '—'
    : `${instante.toLocaleDateString('pt-BR')} ${instante.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit'
      })}`;
}

const vazio = valor => valor === null || valor === undefined || valor === '';
const ou = valor => vazio(valor) ? '—' : String(valor);

// O valor como a pessoa o vê na confirmação e na auditoria: null é ausência de
// decisão, e "vazio" diz isso melhor que uma célula em branco que parece bug.
function legivel(valor) {
  if (vazio(valor)) return '(vazio)';
  if (valor === true) return 'Sim';
  if (valor === false) return 'Não';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return dataBR(valor);
  return String(valor);
}

function celula(conteudo, tag = 'td', classe = '') {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = 'col';
  if (classe) el.className = classe;
  // Duck typing em vez de `instanceof Node`: o global Node é do navegador, e
  // este arquivo também roda no escopo isolado dos testes, que não o tem.
  if (conteudo !== null && typeof conteudo === 'object') el.appendChild(conteudo);
  else el.textContent = String(conteudo);
  return el;
}

function botaoDeLinha(rotulo, aoClicar, { secundario = true } = {}) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = secundario ? 'button-secondary admin-acao' : 'admin-acao';
  botao.textContent = rotulo;
  botao.addEventListener('click', aoClicar);
  return botao;
}

function celulaDeAcoes(botoes) {
  const grupo = document.createElement('div');
  grupo.className = 'admin-acoes';
  botoes.forEach(botao => grupo.appendChild(botao));
  return celula(grupo, 'td', 'historico-acao');
}

// ── Moldura ──────────────────────────────────────────────────────────────────
function estado({ carregando = false, erro = '', vazioTitulo = '', vazioTexto = '' } = {}) {
  painelCarregando.hidden = !carregando;
  if (carregando) {
    painelCarregando.replaceChildren(criarIndicadorCarregamento('Carregando…'));
  } else {
    painelCarregando.replaceChildren();
  }

  painelErro.hidden = !erro;
  if (erro) painelErro.querySelector('p').textContent = erro;

  painelVazio.hidden = !vazioTitulo;
  if (vazioTitulo) {
    painelVazioTitulo.textContent = vazioTitulo;
    painelVazioTexto.textContent = vazioTexto;
  }

  painelConteudo.setAttribute('aria-busy', String(carregando));
}

function cabecalho(colunas) {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  colunas.forEach(coluna => tr.appendChild(celula(coluna, 'th')));
  thead.appendChild(tr);
  return thead;
}

function desenhar(colunas, linhas) {
  const tbody = document.createElement('tbody');
  linhas.forEach(celulas => {
    const tr = document.createElement('tr');
    celulas.forEach(c => tr.appendChild(c));
    tbody.appendChild(tr);
  });
  painelTabela.replaceChildren(cabecalho(colunas), tbody);
}

// ── Seleção de órgão e de aba ────────────────────────────────────────────────
function selecionarOrgao(novo) {
  orgao = novo;
  seletorOrgao.querySelectorAll('[data-orgao-admin]').forEach(botao => {
    botao.setAttribute('aria-pressed', String(botao.dataset.orgaoAdmin === orgao));
    botao.classList.toggle('mode-button-outline', botao.dataset.orgaoAdmin !== orgao);
  });
  detalhe = null;
  return carregar();
}

function selecionarAba(nova) {
  aba = nova;
  abas.querySelectorAll('[data-aba]').forEach(botao => {
    botao.setAttribute('aria-selected', String(botao.dataset.aba === aba));
  });
  detalhe = null;
  return carregar();
}

// ── Carregamento ─────────────────────────────────────────────────────────────
async function carregar() {
  const meu = ++pedido;
  btnVoltar.hidden = !detalhe;
  estado({ carregando: true });
  painelTabela.replaceChildren();
  painelStatus.textContent = 'Carregando…';

  try {
    const linhas = await buscar();
    if (meu !== pedido) return;
    estado({});
    pintar(linhas);
  } catch (err) {
    if (meu !== pedido) return;
    painelTabela.replaceChildren();
    painelStatus.textContent = 'Não foi possível carregar.';
    estado({ erro: `Não foi possível carregar os dados (${err.message}).` });
  }
}

function buscar() {
  const corpo = extra => JSON.stringify({ p_colegiado: orgao, ...extra });

  if (detalhe?.tipo === 'sessao') {
    return api('rpc/admin_processos_sessao', {
      method: 'POST', body: corpo({ p_data_sessao: detalhe.data })
    });
  }
  if (detalhe?.tipo === 'sorteio') {
    return api('rpc/admin_processos_acervo', {
      method: 'POST',
      body: corpo({
        p_data: detalhe.data,
        p_sorteado_em: detalhe.carimbo || null,
        p_origem: detalhe.origem || null
      })
    });
  }
  if (aba === 'sessoes') return api('rpc/admin_sessoes', { method: 'POST', body: corpo() });
  if (aba === 'sorteios') return api('rpc/admin_sorteios', { method: 'POST', body: corpo() });
  return api('rpc/admin_auditoria', { method: 'POST', body: corpo({ p_limite: 100 }) });
}

function pintar(linhas) {
  if (!Array.isArray(linhas)) linhas = [];

  if (detalhe?.tipo === 'sessao') return pintarProcessosDaSessao(linhas);
  if (detalhe?.tipo === 'sorteio') return pintarProcessosDoSorteio(linhas);
  if (aba === 'sessoes') return pintarSessoes(linhas);
  if (aba === 'sorteios') return pintarSorteios(linhas);
  return pintarAuditoria(linhas);
}

function tituloDoPainel(titulo, descricao) {
  painelTitulo.textContent = titulo;
  painelDescricao.textContent = descricao;
}

function semRegistros(titulo, texto) {
  painelTabela.replaceChildren();
  painelStatus.textContent = 'Nada a exibir.';
  estado({ vazioTitulo: titulo, vazioTexto: texto });
}

function pintarSessoes(linhas) {
  tituloDoPainel('Sessões de julgamento',
    'Selecione a data da sessão para corrigir voto, status, pauta ou a própria data.');
  if (!linhas.length) {
    return semRegistros('Nenhuma sessão registrada',
      'Assim que uma pauta da AGR for sincronizada, ela aparece aqui.');
  }

  desenhar(['Data', 'Pauta', 'Processos', 'Pendentes', ''], linhas.map(linha => [
    celula(dataBR(linha.data_sessao), 'td', 'historico-data'),
    celula(ou(linha.pauta), 'td', 'historico-numero'),
    celula(linha.processos, 'td', 'historico-numero'),
    celula(linha.pendentes ? String(linha.pendentes) : '—', 'td', 'historico-numero'),
    celulaDeAcoes([botaoDeLinha('Abrir', () => {
      detalhe = { tipo: 'sessao', data: String(linha.data_sessao).slice(0, 10), pauta: linha.pauta };
      carregar();
    })])
  ]));
  painelStatus.textContent = `${linhas.length} sessão(ões) registrada(s).`;
}

function pintarSorteios(linhas) {
  tituloDoPainel('Distribuições registradas',
    'Selecione a data da rodada para corrigir a distribuição de um processo.');
  if (!linhas.length) {
    return semRegistros('Nenhuma distribuição registrada',
      'O acervo deste colegiado ainda está vazio.');
  }

  desenhar(['Data', 'Hora', 'Origem', 'Processos', 'Destinos', ''], linhas.map(linha => [
    celula(dataBR(linha.data_distribuicao), 'td', 'historico-data'),
    celula(linha.sorteado_em
      ? new Date(linha.sorteado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '—', 'td', 'historico-hora'),
    celula(ou(linha.origem)),
    celula(linha.processos, 'td', 'historico-numero'),
    celula((linha.destinos || []).join(', ')),
    celulaDeAcoes([botaoDeLinha('Abrir', () => {
      detalhe = {
        tipo: 'sorteio',
        data: String(linha.data_distribuicao).slice(0, 10),
        carimbo: linha.sorteado_em || null,
        origem: linha.origem || null
      };
      carregar();
    })])
  ]));
  painelStatus.textContent = `${linhas.length} rodada(s) registrada(s).`;
}

function pintarProcessosDaSessao(linhas) {
  const v = VOCABULARIO[orgao];
  tituloDoPainel(`Sessão de ${dataBR(detalhe.data)}`,
    'Corrija voto, status, pauta ou a data da sessão. Religar refaz o vínculo com o acervo.');
  if (!linhas.length) {
    return semRegistros('Nenhum processo nesta sessão',
      'A sessão não tem processos registrados.');
  }

  desenhar(['Processo', v.destino, 'Voto', 'Status', 'Atualizado por', ''], linhas.map(linha => {
    const destino = celula(ou(linha.destino));
    if (orgao === 'CJ') rotularCadeira(destino, linha.destino);
    return [
      celula(linha.num_processo, 'td', 'historico-numero'),
      destino,
      celula(ou(linha.voto)),
      celula(ou(linha.status)),
      celula(linha.atualizado_por ? `${linha.atualizado_por} · ${dataHoraBR(linha.atualizado_em)}` : '—',
        'td', 'small'),
      celulaDeAcoes([
        botaoDeLinha('Corrigir', () => abrirCorrecaoDeJulgado(linha)),
        botaoDeLinha('Nº', () => abrirCorrecaoDeNumero(linha.num_processo)),
        botaoDeLinha('Religar', () => religarJulgado(linha))
      ])
    ];
  }));
  painelStatus.textContent = `${linhas.length} processo(s) nesta sessão.`;
}

function pintarProcessosDoSorteio(linhas) {
  const v = VOCABULARIO[orgao];
  tituloDoPainel(`Distribuição de ${dataBR(detalhe.data)}`,
    'Corrigir propaga a mudança aos julgados que a copiaram. Redistribuir não — o julgado guarda quem levou o processo à mesa.');
  if (!linhas.length) {
    return semRegistros('Nenhum processo nesta rodada',
      'A rodada não tem processos registrados.');
  }

  const colunas = ['Ordem', 'Processo', v.destino, 'Assunto', v.decisao];
  if (VOCABULARIO[orgao].temInteressado) colunas.push('Interessado');
  colunas.push('Julgados', '');

  desenhar(colunas, linhas.map(linha => {
    const destino = celula(ou(linha.destino));
    if (orgao === 'CJ') rotularCadeira(destino, linha.destino);
    const celulas = [
      celula(ou(linha.ordem), 'td', 'historico-numero'),
      celula(linha.num_processo, 'td', 'historico-numero'),
      destino,
      celula(ou(linha.assunto)),
      celula(ou(linha.decisao))
    ];
    if (v.temInteressado) celulas.push(celula(ou(linha.interessado)));
    celulas.push(celula(linha.julgados, 'td', 'historico-numero'));
    celulas.push(celulaDeAcoes([
      botaoDeLinha('Corrigir', () => abrirAlteracaoDeAcervo(linha, 'corrigir')),
      botaoDeLinha('Redistribuir', () => abrirAlteracaoDeAcervo(linha, 'redistribuir')),
      botaoDeLinha('Nº', () => abrirCorrecaoDeNumero(linha.num_processo))
    ]));
    return celulas;
  }));
  painelStatus.textContent = `${linhas.length} processo(s) nesta rodada.`;
}

function pintarAuditoria(linhas) {
  tituloDoPainel('Auditoria das correções',
    'Cada linha é um registro alterado por este painel, com o valor anterior e o posterior.');
  if (!linhas.length) {
    return semRegistros('Nenhuma correção registrada',
      'Assim que uma alteração for gravada, ela aparece aqui.');
  }

  desenhar(['Quando', 'Operação', 'Registro', 'Alteração', 'Motivo', 'Quem'], linhas.map(linha => {
    const mudancas = document.createElement('ul');
    mudancas.className = 'admin-delta admin-delta-compacta';
    Object.keys(linha.depois || {}).forEach(campo => {
      const item = document.createElement('li');
      item.textContent = `${campo}: ${legivel(linha.antes?.[campo])} → ${legivel(linha.depois?.[campo])}`;
      mudancas.appendChild(item);
    });
    return [
      celula(dataHoraBR(linha.feito_em), 'td', 'small'),
      celula(OPERACOES_LEGIVEIS[linha.operacao] || linha.operacao),
      celula(`${linha.tabela} #${linha.registro_id}`, 'td', 'small'),
      celula(mudancas),
      celula(ou(linha.motivo), 'td', 'small'),
      celula(ou(linha.feito_por), 'td', 'small')
    ];
  }));
  painelStatus.textContent = `${linhas.length} correção(ões) listada(s).`;
}

// ── Diálogo de edição ────────────────────────────────────────────────────────
// Dois passos no mesmo <dialog>: o formulário e a confirmação. `montarDelta`
// devolve a lista do que muda; lista vazia impede a gravação, porque confirmar
// "nenhuma alteração" seria pedir uma decisão sobre coisa nenhuma.
function campoTexto({ nome, rotulo, valor, tipo = 'text', dica = '', atributos = {} }) {
  const bloco = document.createElement('div');
  bloco.className = 'admin-campo';

  const label = document.createElement('label');
  label.htmlFor = `campo-${nome}`;
  label.textContent = rotulo;

  const input = document.createElement('input');
  input.id = `campo-${nome}`;
  input.name = nome;
  input.type = tipo;
  input.value = vazio(valor) ? '' : String(valor).slice(0, tipo === 'date' ? 10 : undefined);
  Object.entries(atributos).forEach(([chave, v]) => input.setAttribute(chave, v));

  bloco.append(label, input);
  if (dica) {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = dica;
    bloco.appendChild(hint);
  }
  return bloco;
}

function campoSelecao({ nome, rotulo, valor, opcoes, rotuloVazio = '— em branco —' }) {
  const bloco = document.createElement('div');
  bloco.className = 'admin-campo';

  const label = document.createElement('label');
  label.htmlFor = `campo-${nome}`;
  label.textContent = rotulo;

  const select = document.createElement('select');
  select.id = `campo-${nome}`;
  select.name = nome;

  const branco = document.createElement('option');
  branco.value = '';
  branco.textContent = rotuloVazio;
  select.appendChild(branco);

  opcoes.forEach(opcao => {
    const item = document.createElement('option');
    item.value = String(opcao);
    item.textContent = String(opcao);
    select.appendChild(item);
  });
  select.value = vazio(valor) ? '' : String(valor);

  bloco.append(label, select);
  return bloco;
}

function valorDoCampo(nome) {
  const campo = edicaoForm.elements[nome];
  return campo ? campo.value.trim() : '';
}

function abrirDialogo({ titulo, resumo, campos, montarDelta, impacto, gravar }) {
  dialogoAtual = { montarDelta, impacto, gravar, delta: null };

  edicaoTitulo.textContent = titulo;
  edicaoResumo.textContent = resumo;
  edicaoCampos.replaceChildren(...campos);
  edicaoMotivo.value = '';
  edicaoErro.hidden = true;
  edicaoImpacto.hidden = true;
  edicaoImpactoLista.replaceChildren();
  edicaoEtapaCampos.hidden = false;
  edicaoEtapaConfirmacao.hidden = true;
  btnAvancar.textContent = 'Revisar alteração';
  btnAvancar.disabled = false;

  dialogo.showModal();
  edicaoCampos.querySelector('input, select')?.focus();
}

function mostrarErroNoDialogo(mensagem) {
  edicaoErro.hidden = false;
  edicaoErro.querySelector('p').textContent = mensagem;
}

async function avancar() {
  if (!dialogoAtual) return;
  edicaoErro.hidden = true;

  // Etapa 1 → 2: monta o delta e mostra a confirmação.
  if (!dialogoAtual.delta) {
    let delta;
    try {
      delta = dialogoAtual.montarDelta();
    } catch (err) {
      mostrarErroNoDialogo(err.message);
      return;
    }
    if (!delta.length) {
      mostrarErroNoDialogo('Nenhuma alteração foi informada.');
      return;
    }

    dialogoAtual.delta = delta;
    edicaoDelta.replaceChildren(...delta.map(({ rotulo, antes, depois }) => {
      const item = document.createElement('li');
      item.textContent = `${rotulo}: ${legivel(antes)} → ${legivel(depois)}`;
      return item;
    }));

    if (dialogoAtual.impacto) {
      try {
        const afetados = await dialogoAtual.impacto();
        if (afetados.length) {
          edicaoImpactoLista.replaceChildren(...afetados.map(texto => {
            const item = document.createElement('li');
            item.textContent = texto;
            return item;
          }));
          edicaoImpacto.hidden = false;
        }
      } catch (_) {
        // O preview é informativo: falhar nele não impede a confirmação, e
        // inventar "nenhum julgado afetado" seria pior que omiti-lo.
      }
    }

    edicaoEtapaCampos.hidden = true;
    edicaoEtapaConfirmacao.hidden = false;
    btnAvancar.textContent = 'Confirmar e gravar';
    return;
  }

  // Etapa 2: grava.
  alternarBotaoCarregando(btnAvancar, true, 'Gravando…');
  try {
    await dialogoAtual.gravar(edicaoMotivo.value.trim() || null);
    dialogo.close();
    aviso('Alteração gravada.', 'sucesso');
    await carregar();
  } catch (err) {
    mostrarErroNoDialogo(err.message);
    aviso(`Não foi possível gravar: ${err.message}`, 'erro');
  } finally {
    alternarBotaoCarregando(btnAvancar, false, 'Confirmar e gravar');
  }
}

// ── Operações ────────────────────────────────────────────────────────────────
function abrirCorrecaoDeJulgado(linha) {
  const v = VOCABULARIO[orgao];
  const campos = [
    campoSelecao({ nome: 'voto', rotulo: 'Voto', valor: linha.voto, opcoes: v.votos }),
    campoSelecao({ nome: 'status', rotulo: 'Status', valor: linha.status, opcoes: v.status }),
    campoTexto({
      nome: 'data_sessao', rotulo: 'Data da sessão', tipo: 'date', valor: detalhe.data,
      dica: 'Mudar a data pode religar o julgado a outra distribuição; a confirmação mostra se isso acontecer.'
    }),
    campoTexto({ nome: 'pauta', rotulo: 'Número da pauta', tipo: 'number', valor: linha.pauta,
      atributos: { min: '1', step: '1' } })
  ];

  const original = {
    voto: linha.voto, status: linha.status,
    data_sessao: detalhe.data, pauta: linha.pauta
  };

  abrirDialogo({
    titulo: 'Corrigir julgado',
    resumo: `Processo ${linha.num_processo} · sessão de ${dataBR(detalhe.data)}`,
    campos,
    montarDelta() {
      const alterados = {};
      const delta = [];
      const comparar = (nome, rotulo, converter) => {
        const bruto = valorDoCampo(nome);
        const novo = bruto === '' ? null : converter(bruto);
        const antigo = vazio(original[nome]) ? null : converter(String(original[nome]).slice(0, 10));
        if (novo === antigo) return;
        alterados[nome] = novo;
        delta.push({ rotulo, antes: antigo, depois: novo });
      };

      comparar('voto', 'Voto', String);
      comparar('status', 'Status', String);
      comparar('data_sessao', 'Data da sessão', String);
      comparar('pauta', 'Número da pauta', Number);

      if (alterados.data_sessao === null) {
        throw new Error('A data da sessão não pode ficar em branco.');
      }
      this.alterados = alterados;
      return delta;
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_campos: this.alterados, p_motivo: motivo })
      });
    }
  });
}

function abrirAlteracaoDeAcervo(linha, modo) {
  const v = VOCABULARIO[orgao];
  const corrigindo = modo === 'corrigir';

  const campos = [
    campoTexto({
      nome: v.campoDestino, rotulo: v.destino, valor: linha.destino,
      dica: orgao === 'CJ' ? 'Cadeira, no formato CJ1…CJ5.' : 'Unidade, no formato CREG1…CREG4.'
    }),
    campoTexto({ nome: 'data_distribuicao', rotulo: 'Data da distribuição', tipo: 'date',
      valor: detalhe.data }),
    campoTexto({ nome: 'assunto', rotulo: 'Assunto', valor: linha.assunto }),
    campoTexto({ nome: 'ordem', rotulo: 'Ordem no sorteio', tipo: 'number', valor: linha.ordem,
      atributos: { min: '1', step: '1' } })
  ];

  // A 6ª coluna muda de nome e de natureza entre os colegiados: na Câmara é a
  // DEFESA, booleana; no Conselho é o RECURSO, texto. Não é o mesmo campo com
  // rótulo trocado, então nem o controle é o mesmo.
  if (orgao === 'CJ') {
    campos.splice(2, 0, campoSelecao({
      nome: 'defesa', rotulo: 'Defesa', opcoes: ['Sim', 'Não'],
      valor: linha.decisao === 'Sim' ? 'Sim' : linha.decisao === 'Não' ? 'Não' : null
    }));
  } else {
    campos.splice(2, 0, campoTexto({ nome: 'recurso', rotulo: 'Recurso', valor: linha.decisao }));
    campos.push(campoTexto({ nome: 'interessado', rotulo: 'Interessado', valor: linha.interessado }));
  }

  const original = {
    [v.campoDestino]: linha.destino,
    data_distribuicao: detalhe.data,
    assunto: linha.assunto,
    ordem: linha.ordem,
    defesa: linha.decisao === 'Sim' ? 'Sim' : linha.decisao === 'Não' ? 'Não' : null,
    recurso: linha.decisao,
    interessado: linha.interessado
  };

  abrirDialogo({
    titulo: corrigindo ? 'Corrigir distribuição' : 'Redistribuir processo',
    resumo: corrigindo
      ? `Processo ${linha.num_processo} · a correção também alcança os julgados que a copiaram`
      : `Processo ${linha.num_processo} · os julgados anteriores preservam quem levou o processo à mesa`,
    campos,
    montarDelta() {
      const alterados = {};
      const delta = [];
      const nomes = [
        [v.campoDestino, v.destino],
        ['data_distribuicao', 'Data da distribuição'],
        ['assunto', 'Assunto'],
        ['ordem', 'Ordem no sorteio'],
        ...(orgao === 'CJ' ? [['defesa', 'Defesa']]
                           : [['recurso', 'Recurso'], ['interessado', 'Interessado']])
      ];

      nomes.forEach(([nome, rotulo]) => {
        if (!edicaoForm.elements[nome]) return;
        const bruto = valorDoCampo(nome);
        const antigo = vazio(original[nome]) ? null : String(original[nome]);
        const novoTexto = bruto === '' ? null : bruto;
        if (novoTexto === antigo) return;

        alterados[nome] = nome === 'ordem'
          ? (novoTexto === null ? null : Number(novoTexto))
          : nome === 'defesa'
            ? (novoTexto === null ? null : novoTexto === 'Sim')
            : novoTexto;
        delta.push({ rotulo, antes: original[nome], depois: alterados[nome] });
      });

      if (alterados[v.campoDestino] !== undefined
          && !v.destinoPadrao.test(String(alterados[v.campoDestino] ?? ''))) {
        throw new Error(`${v.destino} inválido: use o formato ${orgao === 'CJ' ? 'CJ1' : 'CREG1'}.`);
      }
      if (alterados.data_distribuicao === null) {
        throw new Error('A data da distribuição não pode ficar em branco.');
      }
      if (v.assuntoObrigatorio && alterados.assunto === null) {
        throw new Error('O assunto não pode ficar em branco.');
      }

      this.alterados = alterados;
      return delta;
    },
    // O preview só faz sentido quando a alteração propaga: numa redistribuição
    // os julgados ficam intocados de propósito, e listá-los sugeriria o oposto.
    impacto: corrigindo ? async () => {
      const julgados = await api('rpc/admin_julgados_do_acervo', {
        method: 'POST',
        body: JSON.stringify({ p_colegiado: orgao, p_acervo_id: linha.id })
      });
      return (Array.isArray(julgados) ? julgados : []).map(j =>
        `Sessão de ${dataBR(j.data_sessao)}${j.pauta ? ` · pauta ${j.pauta}` : ''} — ${ou(j.voto)} / ${ou(j.status)}`);
    } : null,
    gravar(motivo) {
      const porta = corrigindo ? 'admin_corrigir_acervo' : 'admin_redistribuir';
      return api(`rpc/${porta}_${v.sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_campos: this.alterados, p_motivo: motivo })
      });
    }
  });
}

// O caso que descartou a busca por número: quando o próprio número está errado,
// só a navegação por data chega até ele.
function abrirCorrecaoDeNumero(numAtual) {
  const campos = [
    campoTexto({
      nome: 'num_novo', rotulo: 'Número correto', valor: '',
      atributos: { inputmode: 'numeric', maxlength: '15', pattern: '[0-9]{15}' },
      dica: 'Processo SEI da AGR: 15 dígitos, só dígitos.'
    }),
    campoSelecao({
      nome: 'escopo', rotulo: 'Onde corrigir', valor: 'tudo', rotuloVazio: '— selecione —',
      opcoes: ['tudo', 'acervo', 'julgados']
    })
  ];

  abrirDialogo({
    titulo: 'Corrigir número do processo',
    resumo: `Número atual: ${numAtual}`,
    campos,
    montarDelta() {
      const novo = valorDoCampo('num_novo');
      const escopo = valorDoCampo('escopo');
      if (!/^[0-9]{15}$/.test(novo)) {
        throw new Error('O número precisa ter 15 dígitos, só dígitos.');
      }
      if (novo === numAtual) throw new Error('O número novo é igual ao atual.');
      if (!['tudo', 'acervo', 'julgados'].includes(escopo)) {
        throw new Error('Escolha onde a correção deve valer.');
      }
      this.novo = novo;
      this.escopo = escopo;
      return [
        { rotulo: 'Número do processo', antes: numAtual, depois: novo },
        { rotulo: 'Alcance', antes: '—', depois: escopo }
      ];
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_processo_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({
          p_num_atual: numAtual, p_num_novo: this.novo,
          p_escopo: this.escopo, p_motivo: motivo
        })
      });
    }
  });
}

function religarJulgado(linha) {
  abrirDialogo({
    titulo: 'Religar ao acervo',
    resumo: `Processo ${linha.num_processo} · os campos copiados voltam a sair da distribuição vinculada`,
    campos: [],
    montarDelta: () => ([{
      rotulo: 'Campos derivados',
      antes: 'como estão hoje no julgado',
      depois: 'rederivados do acervo'
    }]),
    gravar(motivo) {
      return api(`rpc/admin_religar_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_motivo: motivo })
      });
    }
  });
}

// ── Ligação ──────────────────────────────────────────────────────────────────
function inicializarAdmin(orgaosAdmin) {
  const administrados = orgaosAdmin instanceof Set ? orgaosAdmin : new Set();

  seletorOrgao.querySelectorAll('[data-orgao-admin]').forEach(botao => {
    botao.hidden = !administrados.has(botao.dataset.orgaoAdmin);
    botao.addEventListener('click', () => selecionarOrgao(botao.dataset.orgaoAdmin));
  });

  // Com um órgão só, o seletor não é escolha: é um botão preso numa opção.
  seletorOrgaoCard.hidden = administrados.size < 2;

  abas.querySelectorAll('[data-aba]').forEach(botao => {
    botao.addEventListener('click', () => selecionarAba(botao.dataset.aba));
  });

  btnVoltar.addEventListener('click', () => {
    detalhe = null;
    carregar();
  });
  btnTentarNovamente.addEventListener('click', () => carregar());

  edicaoForm.addEventListener('submit', evento => {
    evento.preventDefault();
    avancar();
  });
  btnCancelar.addEventListener('click', () => dialogo.close());
  btnFecharEdicao.addEventListener('click', () => dialogo.close());
  // Clique no ::backdrop chega como clique no próprio dialog, e não há trabalho
  // não salvo depois da confirmação — fechar ali é o que se espera de um modal.
  dialogo.addEventListener('click', evento => {
    if (evento.target === dialogo) dialogo.close();
  });
  dialogo.addEventListener('close', () => { dialogoAtual = null; });

  painel.hidden = false;
  return selecionarOrgao(administrados.has('CJ') ? 'CJ' : 'CREG');
}
