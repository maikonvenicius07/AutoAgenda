# CHECKLIST — AutoAgenda V3.3.0

## 1. Deploy básico

- [ ] Enviar os arquivos da V3.3.0 ao GitHub.
- [ ] Confirmar deploy concluído no Render.
- [ ] Abrir `/api/health` e confirmar `ok: true` e versão `3.3.0`.
- [ ] Fazer login como ADMIN.
- [ ] Confirmar que agenda, alunos e demais módulos continuam abrindo normalmente.

## 2. Lembretes sem API configurada

- [ ] Abrir **Configurações → Lembretes**.
- [ ] Confirmar que aparece “API ainda não configurada”.
- [ ] Confirmar que o checkbox de envio automático não pode ser ativado enquanto faltarem variáveis.
- [ ] Abrir a aba **Lembretes**.
- [ ] Confirmar que o botão **WhatsApp manual** continua funcionando.
- [ ] Marcar um lembrete manualmente como enviado e atualizar a tela.

## 3. Configuração futura da API oficial

Configurar no Render somente quando a conta/template oficial estiverem prontos:

- [ ] `WHATSAPP_CLOUD_API_VERSION`
- [ ] `WHATSAPP_PHONE_NUMBER_ID`
- [ ] `WHATSAPP_ACCESS_TOKEN` com permissão `whatsapp_business_messaging`
- [ ] `WHATSAPP_TEMPLATE_LEMBRETE`
- [ ] `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR` (ou idioma aprovado)
- [ ] Opcional: `WHATSAPP_WORKER_INTERVAL_MINUTES=5`

O template deve possuir 6 parâmetros de texto na ordem: aluno, data, horário, instrutor, veículo e local.

## 4. Teste da automação após configurar a Meta

Use uma aula de teste e um número autorizado/real.

- [ ] Reiniciar/redeployar o serviço após cadastrar as variáveis.
- [ ] Confirmar em **Configurações → Lembretes** a mensagem “WhatsApp Cloud API preparada”.
- [ ] Ativar o envio automático e salvar.
- [ ] Criar/ajustar uma aula cujo lembrete fique vencido, mas antes do início da aula.
- [ ] Na aba Lembretes, clicar em **Processar agora** para o primeiro teste controlado.
- [ ] Confirmar recebimento da mensagem no WhatsApp.
- [ ] Confirmar que o lembrete desaparece da lista de pendentes após aceite da API.
- [ ] Conferir no PostgreSQL `autoagenda.lembrete_envios` o status `ENVIADO` e `provider_message_id`.

## 5. Teste de falha

- [ ] Usar uma situação de teste que provoque erro controlado (por exemplo, template de teste incompatível antes de ativar em produção).
- [ ] Confirmar que o item fica com status `FALHOU`.
- [ ] Confirmar que o erro aparece na tela sem exibir o access token.
- [ ] Confirmar que o sistema NÃO tenta reenviar automaticamente o item com falha.
- [ ] Confirmar que o botão **WhatsApp manual** continua disponível.

## 6. Segurança e permissões

- [ ] Login INSTRUTOR não deve acessar Configurações/Lembretes administrativos.
- [ ] Nenhum token da Meta deve aparecer no HTML, JavaScript ou respostas de configuração.
- [ ] `WHATSAPP_ACCESS_TOKEN` deve existir somente nas variáveis de ambiente do Render.
- [ ] Confirmar que nenhuma biblioteca de automação de WhatsApp Web foi adicionada.

## 7. Testes automáticos locais

Executar:

```bash
npm run check
npm run test:static
```

Resultado esperado nesta versão: todos os testes aprovados.

## Observação de hospedagem

O worker interno depende do processo Node.js estar em execução. Se o serviço ficar suspenso no horário exato, o lembrete pode ser processado somente quando o AutoAgenda voltar a executar.
