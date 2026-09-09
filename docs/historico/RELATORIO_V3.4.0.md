# RELATÓRIO — AutoAgenda V3.4.0

## Objetivo

Implementar o PROMPT 9 do roteiro: envio de e-mails relacionados às aulas, preservando completamente o WhatsApp e sem bloquear operações da agenda quando o serviço de e-mail estiver indisponível.

## Implementado

- integração HTTP com API de e-mail;
- configuração exclusiva do ADMIN;
- recurso desativado por padrão;
- fila `autoagenda.email_envios`;
- estados auditáveis: PENDENTE, PROCESSANDO, ENVIADO, FALHOU e CANCELADO;
- chave de idempotência no banco e na requisição ao provedor;
- bloqueio concorrente via PostgreSQL advisory lock;
- agendamento individual;
- lembretes do dia anterior e horas antes;
- reagendamento;
- cancelamento;
- resumo de plano automático;
- atualização/encerramento de plano;
- tratamento de aluno sem e-mail sem erro da agenda;
- histórico incluído no backup completo.

## Provedor preparado

A versão usa a API HTTPS do Resend por `fetch` nativo do Node.js 20. Não foi adicionada dependência npm.

Variáveis:
- RESEND_API_KEY
- EMAIL_FROM
- EMAIL_REPLY_TO (opcional)

## Garantia de independência

O envio é disparado após a confirmação da operação principal no PostgreSQL. Falha de e-mail é registrada na fila e não desfaz a criação, alteração ou cancelamento de uma aula.

## Testes

- `npm run check`: aprovado.
- `npm run test:static`: aprovado.
- 61/61 verificações automáticas aprovadas antes do empacotamento.

Os testes reais de entrega dependem de uma conta/provedor configurado e do PostgreSQL do Render; por isso permanecem no `CHECKLIST_V3.4.0.md`.

## Próximo passo

PROMPT 10 — restauração segura do backup JSON completo.
