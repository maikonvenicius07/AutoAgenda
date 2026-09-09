# Relatório técnico — AutoAgenda V3.8.4

## Problema observado
Aulas futuras canceladas de um plano permaneciam visíveis na grade semanal. Embora a regra de conflito do backend já ignorasse CANCELADA, a presença visual do cartão substituía o botão de horário livre.

## Correção
- `/api/aulas` passa a excluir `CANCELADA` por padrão na agenda ativa;
- foi mantida opção técnica `incluir_canceladas=1` para ADMIN;
- agenda diária e semanal também filtram CANCELADA no frontend como proteção adicional;
- histórico, relatórios e banco permanecem inalterados;
- conflito de horário continua limitado a `AGENDADA` e `CONFIRMADA`.

## Resultado esperado
Ao cancelar uma aula ou cancelar futuras aulas de um plano, o horário fica imediatamente reutilizável na agenda ativa sem perda do histórico.
