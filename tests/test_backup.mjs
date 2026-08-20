#!/usr/bin/env node
// Verifica a conferência do backup .json antes do reenvio:
//
//     node tests/test_backup.mjs
//
// O arquivo vem de fora do sistema — pode ter sido editado à mão, truncado ou
// ser outro JSON qualquer. É fronteira de confiança: o que passar daqui vai
// direto para um INSERT. O teste falha se alguma dessas portas abrir.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'index.js'), 'utf8');

// Recorta do index.js só o que a validação precisa, para testar o código que
// está em produção e não uma cópia que envelhece em silêncio.
function trecho(inicio, fim) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i);
  assert.ok(i >= 0 && f > i, `não achei o trecho "${inicio}" em index.js`);
  return fonte.slice(i, f);
}

const { validarBackup } = new Function(`
  ${trecho('const recursos =', '\n')}
  ${trecho('const defesas =', '\n')}
  ${trecho('const TABELAS =', '\n')}
  ${trecho('const DATA_BR', '\nasync function reenviarBackup')}
  return { validarBackup };
`)();

// ── Um backup válido, do formato que o próprio sistema baixa ────────────────
const valido = () => ({
  modo: 'CJ',
  dataHora: '2026-08-20T19:27:55.798Z',
  unidades: ['CJ1', 'CJ2'],
  processos: [
    { ordem: 1, numProcesso: '202600029000601', assunto: 'Auto de Infração', dataDistribuicao: '20/08/2026', unidade: 'CJ1', defesa: 'Sim' },
    { ordem: 2, numProcesso: '202600029000602', assunto: 'Auto de Infração', dataDistribuicao: '20/08/2026', unidade: 'CJ2', defesa: 'Não' }
  ]
});

const creg = () => ({
  modo: 'CREG',
  dataHora: '2026-08-20T19:27:55.798Z',
  unidades: ['CREG1'],
  processos: [
    { ordem: 1, numProcesso: '202600029000401', assunto: 'Ouvidoria', dataDistribuicao: '20/08/2026', unidade: 'CREG1', recurso: 'Não se aplica' }
  ]
});

assert.doesNotThrow(() => validarBackup(valido()), 'backup CJ legítimo foi recusado');
assert.doesNotThrow(() => validarBackup(creg()), 'backup CREG legítimo foi recusado');

// O CREG não exige 15 dígitos: a regra é da Câmara de Julgamento, onde o número
// é a chave que casa com a pauta da AGR.
const cregLivre = creg();
cregLivre.processos[0].numProcesso = '2026.00029.000401/2026-11';
assert.doesNotThrow(() => validarBackup(cregLivre), 'CREG não deveria exigir 15 dígitos');

// ── O que precisa ser recusado ──────────────────────────────────────────────
const recusa = (nome, mexer, esperado) => {
  const dados = valido();
  mexer(dados);
  assert.throws(() => validarBackup(dados), esperado, `passou sem ser barrado: ${nome}`);
};

recusa('modo desconhecido',      d => { d.modo = 'TJGO'; },                        /modo desconhecido/);
recusa('modo ausente',           d => { delete d.modo; },                          /não diz de qual colegiado/);
recusa('sem processos',          d => { d.processos = []; },                       /nenhum processo/);
recusa('processos não é lista',  d => { d.processos = { a: 1 }; },                  /nenhum processo/);
recusa('dataHora ilegível',      d => { d.dataHora = 'ontem'; },                    /data e hora/);
recusa('número ausente',         d => { delete d.processos[1].numProcesso; },       /processo 2: falta o número/);
recusa('número em branco',       d => { d.processos[0].numProcesso = '   '; },      /processo 1: falta o número/);
recusa('assunto ausente',        d => { d.processos[0].assunto = ''; },             /processo 1: falta o assunto/);
recusa('unidade ausente',        d => { d.processos[0].unidade = ''; },             /processo 1: falta a unidade/);
recusa('ordem não inteira',      d => { d.processos[0].ordem = 1.5; },              /processo 1: ordem inválida/);
recusa('ordem zero',             d => { d.processos[0].ordem = 0; },                /processo 1: ordem inválida/);
recusa('data fora do formato',   d => { d.processos[0].dataDistribuicao = '2026-08-20'; }, /dd\/mm\/aaaa/);
recusa('data inexistente',       d => { d.processos[0].dataDistribuicao = '31/02/2026'; }, /não existe/);
recusa('CJ com 14 dígitos',      d => { d.processos[0].numProcesso = '20260002900060'; },  /15 dígitos/);
recusa('CJ com pontuação',       d => { d.processos[0].numProcesso = '2026.0002900060'; }, /15 dígitos/);
recusa('defesa fora da lista',   d => { d.processos[0].defesa = 'Talvez'; },        /Sim.*Não/);
recusa('defesa ausente',         d => { delete d.processos[0].defesa; },            /Sim.*Não/);
recusa('processo repetido',      d => { d.processos[1].numProcesso = d.processos[0].numProcesso; }, /aparece duas vezes/);

// Injeção de tipo: um número onde se espera texto não pode virar string por acaso.
recusa('número não é texto',     d => { d.processos[0].numProcesso = 202600029000601; }, /falta o número/);

// O envelope inteiro precisa ser um objeto — nem lista, nem null, nem string.
for (const lixo of [null, [], 'texto', 42]) {
  assert.throws(() => validarBackup(lixo), /não é um backup/, `passou: ${JSON.stringify(lixo)}`);
}

// modo com tipo errado não pode virar a string "undefined" na mensagem.
recusa('modo não é texto', d => { d.modo = 7; }, /não diz de qual colegiado/);

// No CREG a decisão é recurso, e a lista é a mesma da tela.
const cregRuim = creg();
cregRuim.processos[0].recurso = 'Com recursos';
assert.throws(() => validarBackup(cregRuim), /recurso fora da lista/);

// A mensagem aponta a linha certa quando o erro está no meio do arquivo.
const tresLinhas = valido();
tresLinhas.processos.push({ ordem: 3, numProcesso: '202600029000603', assunto: 'Auto de Infração', dataDistribuicao: '20/08/2026', unidade: 'CJ1', defesa: 'Sim' });
tresLinhas.processos[2].assunto = '';
assert.throws(() => validarBackup(tresLinhas), /processo 3: falta o assunto/);

console.log('backup: conferência do .json antes do reenvio ✓');
