# Relatório — AutoAgenda V3.7.0

## Objetivo

Deixar WhatsApp e e-mail automáticos como uma única camada de comunicação do AutoAgenda.

## Implementado

1. Central “Automação total de comunicação” com botão **Ativar WhatsApp + e-mail**.
2. WhatsApp transacional automático para agendamento, reagendamento, cancelamento e planos, além dos lembretes existentes.
3. E-mail automático para os mesmos eventos.
4. Worker de comunicação com intervalo padrão de 1 minuto.
5. Filas podem permanecer pendentes até que as credenciais/templates estejam configurados.
6. WhatsApp cancela comunicações pendentes obsoletas e mantém o estado mais recente.
7. E-mail tenta novamente falhas até 3 vezes, mantendo a mesma chave de idempotência.
8. Operações principais não falham por indisponibilidade dos provedores.
9. Histórico de WhatsApp transacional integrado a backup/restauração.
10. O token/link manual de confirmação não é girado pelo envio automático, evitando invalidar links já enviados.

## Banco de dados

Incluída/ consolidada a tabela `autoagenda.whatsapp_envios` para auditoria da comunicação transacional. As tabelas de `lembrete_envios` e `email_envios` continuam sendo utilizadas.

## Segurança

- tokens/chaves continuam somente no Render;
- nenhuma credencial vai para o frontend ou backup;
- nenhuma biblioteca de WhatsApp Web foi adicionada;
- concorrência protegida por advisory locks do PostgreSQL;
- restauração mantém as automações desligadas e cancela filas pendentes restauradas.

## Testes

- `npm run check`: aprovado;
- `npm run test:static`: **94/94 aprovados**;
- validação com provedores reais permanece pendente até configuração das contas/variáveis no Render.

## Observação operacional

O worker interno só roda enquanto o serviço Node estiver ativo. Hospedagem que suspenda o processo pode atrasar mensagens até a retomada do serviço.
