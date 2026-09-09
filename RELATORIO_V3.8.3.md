# Relatório — AutoAgenda V3.8.3

## Problema
Ao editar uma aula existente, a API podia responder “Erro ao atualizar aula.”. O fluxo de atualização compara a data antiga com a nova. Dependendo da conversão do driver PostgreSQL (`pg`), um campo `DATE` pode chegar ao Node.js como objeto `Date`, enquanto a função `dateOnlyUTC()` tratava a entrada exclusivamente como texto `AAAA-MM-DD`.

## Correção
`dateOnlyUTC()` foi reforçada para aceitar:
- objeto JavaScript `Date` válido;
- texto iniciando em `AAAA-MM-DD`.

Também foi adicionada validação explícita de calendário e retorno HTTP 400 para data inválida.

## Impacto
A correção beneficia:
- edição de aula individual;
- comparação para disparo de reagendamento;
- alteração em série das próximas aulas de um plano automático.

Nenhuma regra de conflito, saldo, confirmação, financeiro ou avaliação foi alterada.
