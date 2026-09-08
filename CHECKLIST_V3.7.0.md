# CHECKLIST — AutoAgenda V3.7.0

## Automação total

- [x] botão único para ativar WhatsApp + e-mail;
- [x] automações podem ficar ligadas antes das credenciais;
- [x] worker interno padrão a cada 1 minuto;
- [x] agendamento automático por WhatsApp e e-mail;
- [x] lembretes automáticos por WhatsApp e e-mail;
- [x] reagendamento automático por WhatsApp e e-mail;
- [x] cancelamento automático por WhatsApp e e-mail;
- [x] resumo de planos por WhatsApp e e-mail;
- [x] fila transacional do WhatsApp;
- [x] histórico de e-mail;
- [x] histórico entra no backup completo;
- [x] restauração cancela itens pendentes/processando para evitar disparos inesperados;
- [x] WhatsApp manual preservado;
- [x] link manual de confirmação preservado;
- [x] e-mail com até 3 tentativas automáticas e mesma chave de idempotência;
- [x] nenhuma dependência npm nova;
- [x] sem automação não oficial de WhatsApp Web;
- [x] `npm run check` aprovado;
- [x] `npm run test:static` aprovado — 94/94.

## Testes que precisam do Render / provedores reais

### WhatsApp
- [ ] configurar as variáveis da Cloud API;
- [ ] aprovar/configurar `WHATSAPP_TEMPLATE_LEMBRETE`;
- [ ] aprovar/configurar `WHATSAPP_TEMPLATE_COMUNICACAO`;
- [ ] ativar WhatsApp no AutoAgenda;
- [ ] criar uma aula de teste e confirmar recebimento da mensagem;
- [ ] reagendar e confirmar recebimento;
- [ ] cancelar e confirmar recebimento;
- [ ] testar lembrete do dia anterior;
- [ ] testar lembrete de horas antes.

### E-mail
- [ ] configurar `RESEND_API_KEY`;
- [ ] configurar `EMAIL_FROM`;
- [ ] ativar e-mail no AutoAgenda;
- [ ] criar uma aula de teste e confirmar recebimento;
- [ ] reagendar e confirmar recebimento;
- [ ] cancelar e confirmar recebimento;
- [ ] validar lembretes.

### Operação 24/7
- [ ] confirmar que o serviço Render utilizado permanece ativo no horário esperado;
- [ ] se houver suspensão por inatividade, avaliar plano sempre ativo ou agendador externo.
