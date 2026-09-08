# CHECKLIST — AutoAgenda V3.2.0

## Confirmação pelo próprio aluno

- [x] Link individual incluído no WhatsApp da aula.
- [x] Token aleatório de 32 bytes e armazenamento apenas do SHA-256.
- [x] Página pública sem login e adequada para celular.
- [x] Página pública não expõe CPF, telefone, e-mail ou funções administrativas.
- [x] Botão CONFIRMAR AULA.
- [x] Botão SOLICITAR REAGENDAMENTO.
- [x] Atualização de `confirmacao_status` com origem `WHATSAPP`.
- [x] Token com expiração e uso único.
- [x] Links antigos invalidados após alterações manuais relevantes.
- [x] Campos do token excluídos dos backups.
- [x] Metadados do token removidos das respostas comuns da API de aulas.
- [x] `sql/schema.sql` alinhado às novas colunas.
- [x] Testes de sintaxe e testes estáticos.

## Validação no Render (PostgreSQL real)

- [ ] Abrir uma aula AGENDADA e clicar em WhatsApp.
- [ ] Confirmar que a mensagem contém o link individual.
- [ ] Abrir o link em janela anônima/sem login no AutoAgenda.
- [ ] Confirmar a aula e verificar o status na agenda.
- [ ] Gerar novo link para outra aula e solicitar reagendamento.
- [ ] Verificar `PEDIU_REAGENDAMENTO` no AutoAgenda.
- [ ] Tentar usar o mesmo link novamente e confirmar que não permite segunda resposta.
- [ ] Alterar data/horário de uma aula após enviar link e confirmar que o link antigo deixa de funcionar.
- [ ] Testar em celular.

### PUBLIC_BASE_URL
É recomendado configurar no Render a variável `PUBLIC_BASE_URL` com a URL pública do AutoAgenda. Se ela não existir, o servidor tenta usar automaticamente o domínio da própria requisição.
