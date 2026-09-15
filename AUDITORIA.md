# Auditoria Técnica — Sorteio SEI

**Projeto:** `thelustosa/sorteio-sei` — Sistema de Distribuição e Acompanhamento de Processos SEI (AGR / Governo de Goiás)
**Data:** 15 de setembro de 2026
**Origem:** relatório automatizado gerado pelo Gemini, depois revisado e validado contra o código e contra o banco de produção.

**Base da revisão:**
- Código: `main` em `9712d04`.
- Banco: projeto Supabase `sorteio-sei` (PostgreSQL 17.6), consultado via MCP: constraints, RLS, grants, corpo das funções, ledger de migrações e advisors.
- Testes: a mesma sequência do [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

> O relatório original apontava 5 problemas e 2 recomendações. Na validação, 1 problema se confirmou em parte, 1 é válido mas cosmético e 3 eram falsos positivos no deploy real (GitHub Pages em `/sorteio-sei/`). As 2 recomendações já estavam cobertas ou não compensam. A revisão encontrou 3 pontos que o relatório não viu.

---

## 1. Resumo

| ID | Achado | Veredito | Ação |
| :--- | :--- | :--- | :--- |
| P-ALTO-01 | Tabelas da CJ sem validação de formato | Válido em parte (só `num_processo`) | ✅ Corrigido |
| N-01 | Nome da migração diferente do ledger de produção | Novo, válido | ✅ Corrigido |
| P-BAIXO-01 | `console.error` em recusa de login | Válido, cosmético | ⏳ Próximo release |
| N-03 | Proteção contra senhas vazadas desligada | Novo (advisor) | ⏳ Ação manual no painel |
| N-02 | Comentários desatualizados em 2 funções de produção | Novo, sem impacto | Registrado |
| P-MED-01 | `<base href="/sorteio-sei/">` no `404.html` | Falso positivo | Mantido |
| P-MED-02 | Falta `/favicon.ico` na raiz | Falso positivo | Mantido |
| P-BAIXO-02 | Falta skip-link no `404.html` | Não se aplica | Mantido |
| R-01 | Carregar `CADEIRAS_CJ` do banco | Desnecessário | Descartado |
| R-02 | Monitorar o sincronizador de pautas | Já existe | Descartado |

**Veredito:** sem bloqueadores. Resta uma ação manual (N-03) e um ajuste cosmético para o próximo release (P-BAIXO-01).

---

## 2. Corrigido

### P-ALTO-01 — número de processo da CJ sem validação no banco

**Confirmado em produção.** `acervo_cj` e `julgados_cj` só tinham o check de `origem`, enquanto `acervo_creg` e `julgados_creg` já exigiam `num_processo ~ '^[0-9]{15}$'`.

**Risco real.** O papel `authenticated` tem `INSERT` direto em `acervo_cj`, e a policy só confere `tem_acesso_orgao('CJ')`. Os 15 dígitos eram validados apenas no navegador ([`assets/js/index.js`](assets/js/index.js)), então um operador da CJ conseguia gravar `'ABC'` com um POST na API REST.

**Severidade revisada: média.** Exige usuário autenticado com acesso à CJ agindo fora da tela, e nenhum dado fora do padrão existia.

**Correção:**
- `acervo_cj_num_processo_check` e `julgados_cj_num_processo_check` em [`sql/schema.sql`](sql/schema.sql) e na migração [`20260915125055_numero_de_processo_da_cj.sql`](supabase/migrations/20260915125055_numero_de_processo_da_cj.sql), já aplicada em produção.
- Validação imediata, sem `NOT VALID`: nenhuma linha fora do padrão em `acervo_cj` (194), `julgados_cj` (223) e `backup_cj` (3.199 e 3.144).
- `admin_corrigir_processo_cj` foi recriada só para atualizar o comentário que dizia que a Câmara não tinha o check. A lógica não mudou.
- Novo teste `cj_exige_numero_de_processo_com_15_digitos` em [`tests/test_cj.py`](tests/test_cj.py). `preparar_upgrade_da_migracao` remove as duas constraints antes de aplicar as migrações, para o CI provar que é a migração que as devolve.
- [`README.md`](README.md) e [`FLUXO-CJ.md`](FLUXO-CJ.md) atualizados.

**Não foi feito, de propósito:** a restrição de cadeira (`relator ~ '^CJ[1-9][0-9]*$'`) sugerida no texto do relatório.
- Todos os relatores do `backup_cj` estão gravados pelo nome.
- [`dados/importar_planilha.py`](dados/importar_planilha.py) mantém como nome quem não está em `cadeiras_cj`.
- O [`FLUXO-CJ.md`](FLUXO-CJ.md) documenta essa fronteira ("Fronteira conhecida"), e `tests/test_cj.py` depende dela.

Essa restrição quebraria o [`sql/restaurar_cj.sql`](sql/restaurar_cj.sql) e a importação da planilha.

**Efeito colateral esperado:** `processo()` no importador não exige 15 dígitos. Agora uma linha errada na planilha aborta o lote, em vez de entrar no banco.

### N-01 — ledger de migrações divergente do repositório

O ledger de produção (`supabase_migrations.schema_migrations`) registrou `20260914102247_ajustes_painel_admin`, mas o arquivo se chamava `20260911120000_ajustes_painel_admin.sql`. Pela regra do README (seção sobre `supabase/migrations/`), o `supabase db push` tentaria reaplicar esse arquivo.

O arquivo foi renomeado para [`20260914102247_ajustes_painel_admin.sql`](supabase/migrations/20260914102247_ajustes_painel_admin.sql). Nenhum arquivo referenciava o nome antigo, e a ordem das migrações não muda.

---

## 3. Falsos positivos

### P-MED-01 — `<base href="/sorteio-sei/">` no `404.html`

O site é publicado no GitHub Pages em `https://thelustosa.github.io/sorteio-sei/`, sem domínio próprio.
- O `<base>` foi colocado de propósito ([`docs/ALTERACOES-PRE-PRODUCAO-2026-08-23.md`](docs/ALTERACOES-PRE-PRODUCAO-2026-08-23.md), seção 4.5).
- [`tests/test_assets.mjs`](tests/test_assets.mjs) garante que uma 404 numa URL aninhada (`/sorteio-sei/inexistente/aninhado`) ainda carregue CSS, favicon e o link de volta.

A reprodução do relatório servia o site na raiz, cenário que não existe aqui. Remover o `<base>` quebraria justamente o caso que o teste protege. Só precisa mudar se o site migrar para um domínio próprio.

### P-MED-02 — ausência de `/favicon.ico`

- As 9 páginas, inclusive o `404.html`, declaram `<link rel="icon" href="assets/img/favicon.png">`, então o navegador não depende de `/favicon.ico`.
- Num Pages de projeto, a raiz `/favicon.ico` pertence a `thelustosa.github.io`, fora deste repositório. Um `favicon.ico` na raiz do repo seria servido em `/sorteio-sei/favicon.ico` e não mudaria nada.
- O Pages não expõe logs de acesso que pudessem ser "poluídos".

### P-BAIXO-02 — skip-link no `404.html`

As demais páginas têm cabeçalho e navegação antes do conteúdo. No `404.html`, o `<main id="conteudo-principal">` é o primeiro elemento do `<body>`, então não há bloco repetido para pular (WCAG 2.4.1). O link seria só uma parada de Tab inútil.

---

## 4. Pendentes e registrados

### P-BAIXO-01 — `console.error` em recusa prevista de login

Confirmado: [`assets/js/bootstrap.js`](assets/js/bootstrap.js) loga o erro antes do `if (err.semPermissao)`. O ajuste é de uma linha, mas exige regerar o `bootstrap.min.js`, rodar `tools/versionar.mjs` e publicar uma nova versão dos assets. Fica para o próximo release.

### N-03 — proteção contra senhas vazadas desligada

O advisor de segurança do Supabase acusa *Leaked Password Protection* desligada. É uma opção de Authentication no painel do projeto (pode depender do plano), sem código. Ver a [documentação](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### N-02 — comentários desatualizados em duas funções de produção

`admin_alterar_acervo_creg` e `admin_auditoria` foram editadas no commit `5931695` depois de a migração já ter sido aplicada. Comparados sem comentários, os corpos são idênticos aos do repositório, e todas as outras funções de `public` batem por completo. Não há impacto funcional e nada a fazer.

---

## 5. Recomendações descartadas

- **R-01 — carregar `CADEIRAS_CJ` do banco.** Não compensa:
  - A constante não serve só ao hover: define as cadeiras que entram no sorteio (`assets/js/index.js`).
  - `cadeiras_cj` é fechada ao navegador de propósito (RLS sem policy, privilégios revogados), então exigiria uma RPC nova.
  - O painel do acervo já recebe os nomes pela `resumo_acervo_cj`.
  - `tests/test_cj.py` falha se a constante divergir da tabela, e a composição muda raramente. Em produção, as 5 cadeiras batem.
- **R-02 — monitorar o sincronizador.** Já existe: [`.github/workflows/sincronizar-julgados.yml`](.github/workflows/sincronizar-julgados.yml) roda quatro vezes por dia e fica vermelho com anotação por colegiado. Além disso, `sincronizar.py` avisa quando encontra número de 15 dígitos sem o rótulo, sinal de que o layout da pauta mudou.

---

## 6. Afirmações do relatório original conferidas em produção

| Afirmação | Resultado |
| :--- | :--- |
| 18 migrações reproduzem o schema | Confere: 18 arquivos e 18 linhas no ledger, agora com os mesmos nomes (19 com a desta correção) |
| `auditoria_admin` é append-only | Confere: RLS só com policy de `SELECT` (`e_admin_orgao`) e grant só de `SELECT` |
| Segregação CJ/CREG por RLS | Confere: `authenticated` só tem `INSERT` em `acervo_*` e `SELECT` em `julgados_*`; `anon` não tem grants |
| RPCs administrativas com `search_path = ''` | Confere em todas as funções de `public`. Os nomes reais têm sufixo `_cj`/`_creg` |
| Front sem `innerHTML` | Confere: nenhuma ocorrência em `assets/js` |
| 25 alertas "SECURITY DEFINER executável por authenticated" | Intencionais: todas conferem acesso (`tem_acesso_orgao`, `admin_exigir`, `e_admin_orgao`) ou delegam a uma função que confere |
| Ambiente do teste de banco | O relatório usou PostgreSQL 15, o mesmo de `tests/banco.py`; produção roda 17.6 |

As seções de interface, performance e acessibilidade do relatório original não foram reexecutadas nesta revisão.

---

## 7. Verificação

Sequência do CI executada localmente depois da correção (Node 24, Python 3.14, Docker com `postgres:15-alpine`):

| Etapa | Resultado |
| :--- | :--- |
| `node --check` em `assets/js`, `tools` e `tests` | ok |
| `tests/test_assets.mjs` e `tests/test_sorteio.mjs` | ok |
| `tests/test_frontend.mjs` | 153/153 |
| `tests/test_acesso.py` | 11/11 |
| `tests/test_admin.py` | 58/58 |
| `tests/test_cj.py` | 75/75 (10 pulados: dependem da planilha, que o CI também não tem) |
| `tests/test_creg.py` | 46/46 |
| `tests/test_sincronizacao.py` | 45/45 (1 pulado) |
| `tests/test_workflows.py` | 6/6 |
| Versão e minificados (`tools/versionar.mjs`, esbuild, `git diff --exit-code`) | sem diferença |

Em produção, a migração foi aplicada com sucesso pelo MCP, e `acervo_cj_num_processo_check` e `julgados_cj_num_processo_check` constam no catálogo como validadas (`convalidated = true`). O advisor de segurança, rodado de novo depois dela, não apontou nada além dos alertas descritos acima.
