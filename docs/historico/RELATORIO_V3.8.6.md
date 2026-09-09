# Relatório — AutoAgenda V3.8.6

## Problema corrigido
A rota de alteração de status ainda executava validações desnecessárias antes de cancelar uma aula. Em produção, alguma dessas etapas podia falhar e retornar `Erro ao atualizar status da aula.`.

## Correção
O status `CANCELADA` agora possui um caminho direto e transacional:
- bloqueia somente o registro da aula com `FOR UPDATE`;
- confirma que a aula existe e não está arquivada;
- grava `CANCELADA`;
- invalida o token de confirmação;
- marca a ocorrência como exceção quando pertence a plano automático;
- faz `COMMIT`;
- só depois agenda as comunicações de cancelamento.

O cancelamento não executa validação de saldo, conflito, disponibilidade de instrutor/veículo nem funcionamento, pois nenhuma delas é necessária para liberar um horário.
