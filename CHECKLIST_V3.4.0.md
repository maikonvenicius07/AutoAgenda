# CHECKLIST — AutoAgenda V3.4.0

## 1. Deploy básico

- [ ] Enviar os arquivos da V3.4.0 ao GitHub.
- [ ] Aguardar o deploy do Render.
- [ ] Abrir `/api/health`.
- [ ] Confirmar `ok: true`.
- [ ] Confirmar versão `3.4.0`.
- [ ] Confirmar que login ADMIN continua funcionando.
- [ ] Confirmar que login INSTRUTOR continua funcionando.

## 2. Antes de configurar e-mail

- [ ] Abrir **Configurações**.
- [ ] Localizar **📧 Envio automático de e-mail**.
- [ ] Confirmar que o recurso aparece desligado.
- [ ] Confirmar que a tela informa as variáveis ausentes.
- [ ] Confirmar que WhatsApp manual/automático continua independente.
- [ ] Criar/editar uma aula e confirmar que a operação funciona mesmo sem serviço de e-mail configurado.

## 3. Configuração no Render — somente quando quiser ativar

Adicionar em **Environment**:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` (opcional)

Exemplo de `EMAIL_FROM`:
`AutoAgenda <agenda@seudominio.com>`

O endereço/domínio precisa estar autorizado no serviço de e-mail usado.

Depois:
- [ ] Fazer novo deploy/restart.
- [ ] Abrir Configurações.
- [ ] Confirmar que o serviço aparece como configurado.
- [ ] Marcar **Enviar e-mails automaticamente**.
- [ ] Salvar.

## 4. Teste com aluno de teste

Use um aluno de teste com um e-mail que você controla.

- [ ] Criar uma aula individual.
- [ ] Confirmar recebimento do e-mail de agendamento.
- [ ] Alterar data ou horário.
- [ ] Confirmar recebimento do e-mail de reagendamento.
- [ ] Cancelar a aula.
- [ ] Confirmar recebimento do e-mail de cancelamento.
- [ ] Criar um plano automático pequeno.
- [ ] Confirmar recebimento de apenas um e-mail-resumo do plano, e não um e-mail por aula.

## 5. Lembretes

Para testar sem esperar até o dia seguinte:
- use uma aula futura e ajuste temporariamente as configurações de lembrete de forma segura;
- não coloque a aula no passado.

- [ ] Confirmar lembrete do dia anterior.
- [ ] Confirmar lembrete de algumas horas antes.
- [ ] Confirmar que um mesmo evento não é enviado duas vezes.
- [ ] Confirmar que **Processar agora** não duplica e-mails já enviados.

## 6. Falhas e independência

- [ ] Testar aluno sem e-mail cadastrado.
- [ ] Confirmar que a aula é salva normalmente.
- [ ] Desativar e-mail automático.
- [ ] Confirmar que nenhuma mensagem nova é enviada.
- [ ] Confirmar que WhatsApp continua funcionando.
- [ ] Confirmar que uma falha do serviço de e-mail não impede agendar/reagendar/cancelar.

## 7. Backup

- [ ] Gerar backup JSON completo.
- [ ] Confirmar presença do histórico `email_envios`.
- [ ] Confirmar que `RESEND_API_KEY`, `EMAIL_FROM` e `EMAIL_REPLY_TO` não aparecem como credenciais no backup.

## Resultado

Marque cada item conforme o teste no Render. Os testes estáticos locais da V3.4.0 devem permanecer 100% aprovados antes do deploy.
