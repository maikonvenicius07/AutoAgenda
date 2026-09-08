# RELATÓRIO — AutoAgenda V3.3.0

## Objetivo

Preparar o AutoAgenda para envio automático de lembretes pela integração oficial da WhatsApp Business Platform / Cloud API, mantendo o envio manual atual como alternativa e sem ativar serviço pago ou credenciais no código.

## Implementado

- integração server-side por `POST https://graph.facebook.com/{versao}/{phone-number-id}/messages`;
- autenticação por Bearer token lido exclusivamente de variável de ambiente;
- envio por template aprovado, com seis parâmetros de aula;
- opção de ativar/desativar automação pelo ADMIN;
- integração desativada por padrão;
- verificação de configuração antes de permitir ativação;
- worker interno periódico, intervalo padrão de 5 minutos;
- fila persistente `autoagenda.lembrete_envios`;
- estados PENDENTE, PROCESSANDO, ENVIADO, FALHOU e CANCELADO;
- armazenamento do message ID retornado pelo provedor;
- advisory lock no PostgreSQL contra processamento concorrente;
- prevenção de dois lembretes atrasados da mesma aula serem enviados em sequência;
- falha não é reenviada automaticamente;
- botão manual por `wa.me` preservado;
- histórico da fila incluído no backup completo;
- interface administrativa com status da configuração e falhas;
- botão **Processar agora** para teste/controlado após a integração estar ativa.

## Não implementado nesta etapa

- compra/ativação de conta ou serviço da Meta;
- criação/aprovação do template dentro da conta do usuário;
- Webhook de status de entrega/leitura;
- reenvio automático de falhas;
- automação não oficial de WhatsApp Web.

## Segurança

As credenciais `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` nunca são enviadas ao frontend. A API de configuração expõe apenas se a integração está pronta e os nomes das variáveis que ainda faltam.

## Interpretação do status ENVIADO

`ENVIADO` representa aceite da requisição pela Cloud API, com ID da mensagem quando retornado. Entrega/leitura final exige integração de Webhooks e ficou fora do escopo da V3.3.0.

## Validação

- `npm run check`: aprovado;
- `npm run test:static`: aprovado;
- testes de sintaxe de `server.js` e `public/app.js`: aprovados;
- teste real de envio depende das credenciais, número e template oficial do usuário no ambiente Render.

## Próxima etapa

PROMPT 9 — envio de e-mail para agendamento, lembrete, reagendamento e cancelamento.
