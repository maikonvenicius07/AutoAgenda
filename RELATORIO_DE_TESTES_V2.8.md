# Relatório de testes — AutoAgenda V2.8.0

## Escopo
Implementação da ETAPA 14 — Financeiro simples sobre a V2.7.0.

## Verificações estáticas executadas
- `node --check server.js`;
- `node --check public/app.js`;
- `npm run check`;
- validação de IDs HTML duplicados;
- conferência de referências simples de IDs usadas pelo JavaScript;
- conferência de rotas Express duplicadas;
- revisão da migração automática da tabela `autoagenda.financeiro`.

## Regras verificadas no código
- valor do pacote e valor pago não podem ser negativos;
- valor pago não pode ser maior que o valor do pacote;
- quantidade de aulas deve ser positiva;
- pagamento maior que zero exige data e forma de pagamento;
- saldo financeiro é calculado, não digitado separadamente;
- lançamentos são arquivados/reativados sem exclusão física;
- nenhuma rota financeira atualiza `autoagenda.alunos.aulas_contratadas` ou `autoagenda.aulas`.

## Limite do teste local
Os testes locais são estruturais/estáticos. A confirmação final da migração PostgreSQL e da interface deve ser feita após o deploy no Render usando o checklist V2.8.
