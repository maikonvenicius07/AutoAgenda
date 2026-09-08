# Checklist — AutoAgenda V1.8

## Deploy
- [ ] Render concluiu o deploy sem erro.
- [ ] O topo mostra **AutoAgenda V1.8.0**.
- [ ] Alunos, aulas, planos e configurações antigas continuam aparecendo.

## Disponibilidade do instrutor
- [ ] Abrir Configurações > Instrutores > Editar.
- [ ] Confirmar a opção **Usar horário geral**.
- [ ] Desmarcar e definir dias próprios.
- [ ] Definir horário inicial/final.
- [ ] Definir intervalo opcional.
- [ ] Salvar e reabrir o instrutor para confirmar persistência.

## Validação
- [ ] Tentar criar aula em dia que o instrutor não trabalha — deve bloquear.
- [ ] Tentar criar aula antes do início do instrutor — deve bloquear.
- [ ] Tentar criar aula durante o intervalo — deve bloquear.
- [ ] Criar aula dentro da disponibilidade — deve permitir.
- [ ] Criar prévia de plano em dia indisponível — deve bloquear com mensagem clara.

## Folgas
- [ ] Editar um instrutor já salvo.
- [ ] Cadastrar uma folga de um dia.
- [ ] Cadastrar um período de férias/indisponibilidade.
- [ ] Tentar marcar aula dentro da folga — deve bloquear.
- [ ] Excluir a indisponibilidade e confirmar que a data volta a ficar disponível.

## Compatibilidade
- [ ] Aulas antigas permanecem intactas.
- [ ] Agenda diária funciona.
- [ ] Agenda semanal funciona.
- [ ] Plano automático funciona.
- [ ] Configuração de horário geral funciona.
