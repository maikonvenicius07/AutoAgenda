# Configurar automação total — AutoAgenda V3.7.0

Este guia deve ser usado **depois do deploy da V3.7.0**. Não coloque chaves reais no GitHub.

## 1. Ativar a automação no AutoAgenda

Em **Configurações > Automação total de comunicação**, clique em:

**🤖 Ativar WhatsApp + e-mail**

É permitido ativar antes das credenciais. Os envios ficarão aguardando a integração correspondente.

## 2. WhatsApp oficial — variáveis do Render

Adicione em **Render > autoagenda > Environment**:

- `WHATSAPP_CLOUD_API_VERSION`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_TEMPLATE_LEMBRETE`
- `WHATSAPP_TEMPLATE_COMUNICACAO`
- `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`
- `PUBLIC_BASE_URL` — recomendado para o fluxo manual de confirmação

Depois salve e faça novo deploy.

### Template de lembrete

O template usa 6 variáveis:

1. aluno;
2. data;
3. horário;
4. instrutor;
5. veículo;
6. local.

Exemplo:

`Olá, {{1}}! Lembrete da sua aula prática em {{2}} às {{3}}. Instrutor: {{4}}. Veículo: {{5}}. Local: {{6}}.`

### Template de comunicação

O template usa 4 variáveis:

1. primeiro nome do aluno;
2. evento;
3. detalhes;
4. orientação final.

Exemplo:

`Olá, {{1}}! {{2}}. Detalhes: {{3}}. {{4}}`

Use exatamente o nome aprovado no valor de `WHATSAPP_TEMPLATE_COMUNICACAO`.

## 3. E-mail — variáveis do Render

Adicione:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` — opcional

Exemplo de `EMAIL_FROM`:

`AutoAgenda <agenda@seudominio.com>`

O remetente/domínio precisa estar aceito pelo serviço de e-mail escolhido/configurado.

## 4. Worker

O `render.yaml` já declara:

`AUTOAGENDA_COMM_WORKER_INTERVAL_MINUTES=1`

Portanto, enquanto o serviço estiver ativo, o AutoAgenda verifica as filas aproximadamente a cada minuto.

## 5. Teste recomendado

Use um aluno de teste com seu próprio telefone/e-mail:

1. crie uma aula futura;
2. confirme recebimento no WhatsApp e e-mail;
3. reagende;
4. confirme as duas novas mensagens;
5. cancele;
6. confirme as mensagens de cancelamento;
7. faça um teste de lembrete;
8. confira os contadores/erros em Configurações.

## 6. Importante

- O WhatsApp manual continua disponível.
- A confirmação pública pelo aluno continua usando o link seguro do fluxo manual.
- O WhatsApp automático não invalida links manuais de confirmação já enviados.
- O e-mail tenta novamente uma falha temporária até 3 vezes.
- O WhatsApp não repete automaticamente falha ambígua para reduzir o risco de mensagem duplicada.
- Se o Render suspender o serviço por inatividade, o worker interno não executa enquanto o processo estiver parado.
