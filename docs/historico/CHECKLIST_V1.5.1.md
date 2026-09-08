# Checklist de testes — AutoAgenda V1.5.1

## 1. Deploy
- [ ] Render concluiu o deploy sem erro.
- [ ] O topo mostra **AutoAgenda V1.5.1**.
- [ ] Alunos, aulas e planos antigos continuam aparecendo.

## 2. Instrutores
- [ ] Cadastrar um instrutor.
- [ ] Editar o instrutor.
- [ ] Desativar um instrutor sem aula futura/plano ativo.
- [ ] Confirmar que ele desaparece de Nova aula e Plano automático.
- [ ] Clicar em **Mostrar inativos** e localizar o instrutor.
- [ ] Reativar o instrutor.
- [ ] Confirmar que ele volta aos seletores.
- [ ] Tentar cadastrar novamente o mesmo e-mail/WhatsApp e confirmar o bloqueio.
- [ ] Tentar desativar instrutor com aula futura e confirmar o bloqueio.

## 3. Veículos
- [ ] Cadastrar um veículo.
- [ ] Editar o veículo.
- [ ] Desativar e reativar.
- [ ] Confirmar que veículo inativo não aparece em novas marcações.
- [ ] Tentar cadastrar a mesma placa novamente e confirmar o bloqueio.
- [ ] Tentar desativar veículo com aula futura e confirmar o bloqueio.

## 4. Locais
- [ ] Cadastrar um local.
- [ ] Editar o local.
- [ ] Desativar e reativar.
- [ ] Confirmar que local inativo não aparece em novas marcações.
- [ ] Tentar cadastrar o mesmo nome/endereço novamente e confirmar o bloqueio.
- [ ] Tentar desativar local com aula futura e confirmar o bloqueio.

## 5. Exclusão definitiva
- [ ] Criar um recurso novo e não usá-lo.
- [ ] Desativá-lo.
- [ ] Confirmar que aparece o botão de exclusão definitiva.
- [ ] Excluir definitivamente.
- [ ] Criar outro recurso, usá-lo em uma aula, depois encerrar/cancelar o uso.
- [ ] Desativá-lo.
- [ ] Confirmar que o sistema mostra o histórico protegido e não permite exclusão definitiva.

## 6. Regressão das funções antigas
- [ ] Criar aluno.
- [ ] Editar aluno.
- [ ] Criar aula manual.
- [ ] Alterar aula.
- [ ] Criar plano automático.
- [ ] Verificar conflitos.
- [ ] Abrir Agenda diária.
- [ ] Abrir Agenda semanal.
- [ ] Navegar entre semanas.
- [ ] Confirmar que somente recursos ativos aparecem nos novos agendamentos.

## Critério para avançar
Somente iniciar a ETAPA 2 — Agenda Semanal completa depois que os testes acima estiverem aprovados.
