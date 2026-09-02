# Contagem por unidade no histórico de sorteios

## Objetivo

Mostrar, na coluna `Unidades` ou `Cadeiras`, quantos processos cada destino recebeu em cada rodada do histórico.

## Apresentação aprovada

Cada destino será um grupo compacto e centralizado, com a sigla e uma cápsula numérica. Exemplo visual: `CREG2 27 · CREG3 27 · CREG4 27`. Os grupos podem quebrar entre si em telas estreitas, mas a sigla nunca se separa da própria contagem.

Leitores de tela recebem a forma completa, por exemplo: `CREG2: 27 processos; CREG3: 27 processos; CREG4: 27 processos`.

## Contrato de dados

`public.historico_sorteios(text)` mantém `destinos text[]` e acrescenta:

```json
"distribuicao": [
  { "destino": "CREG2", "processos": 27 },
  { "destino": "CREG3", "processos": 27 }
]
```

A lista é ordenada pela sigla do destino. O total de `processos` da rodada deve ser igual à soma das contagens de `distribuicao`.

## Compatibilidade e segurança

Enquanto a migração ainda não estiver aplicada, o frontend aceita respostas antigas que contenham apenas `destinos` e mostra somente as siglas, como hoje. Não haverá uma chamada por rodada nem acesso direto aos acervos.

A função continua `STABLE`, `SECURITY DEFINER`, com `search_path = ''`, validação de sessão e `EXECUTE` concedido somente a `authenticated`.

