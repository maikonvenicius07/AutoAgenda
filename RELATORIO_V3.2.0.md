# RELATÓRIO — AutoAgenda V3.2.0

## Funcionalidade
Confirmação de aula pelo próprio aluno por link individual enviado junto da mensagem de WhatsApp.

## Segurança
- token bruto não é persistido; somente SHA-256 é gravado;
- 32 bytes aleatórios por novo link;
- uso único;
- expiração;
- nenhuma sessão administrativa é necessária na página do aluno;
- página pública exibe apenas nome, data, horário, instrutor, veículo e local;
- alterações manuais relevantes invalidam o link anterior;
- token e metadados de token ficam fora dos backups e das respostas comuns da API de aulas.

## Regra de reagendamento
O aluno não altera a agenda diretamente. A opção registra `PEDIU_REAGENDAMENTO`; instrutor ou ADMIN decide e executa a mudança no AutoAgenda.

## Testes
Os testes estáticos/sintáticos devem ser executados antes do deploy. A validação ponta a ponta do token exige PostgreSQL real e deve ser concluída no Render usando `CHECKLIST_V3.2.0.md`.
