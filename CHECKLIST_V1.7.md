# Checklist de testes — AutoAgenda V1.7

## Deploy
- [ ] Render concluiu o deploy sem erro.
- [ ] O topo mostra **AutoAgenda V1.7.0**.
- [ ] Alunos antigos continuam aparecendo.
- [ ] Aulas e planos antigos continuam aparecendo.

## Horário de funcionamento
- [ ] Abrir **Configurações**.
- [ ] Confirmar que existe o cartão **Horário de funcionamento**.
- [ ] Selecionar os dias reais de funcionamento.
- [ ] Definir abertura e encerramento.
- [ ] Definir duração padrão.
- [ ] Definir intervalo entre aulas.
- [ ] Salvar e recarregar a página.
- [ ] Confirmar que os valores permanecem salvos.

## Aula manual
- [ ] Criar aula em dia aberto e dentro do horário: deve permitir.
- [ ] Tentar aula em dia fechado: deve bloquear.
- [ ] Tentar aula antes da abertura: deve bloquear.
- [ ] Tentar aula que termina depois do encerramento: deve bloquear.
- [ ] Confirmar que nova aula começa com a duração padrão configurada.

## Intervalo entre aulas
Exemplo: duração 50 minutos e intervalo 10 minutos.
- [ ] Criar aula às 08:00.
- [ ] Tentar usar o mesmo instrutor/veículo/aluno às 08:50: deve bloquear pelo intervalo.
- [ ] Tentar às 09:00: deve permitir se não houver outro conflito.

## Plano automático
- [ ] Criar prévia em dias e horário permitidos: deve funcionar.
- [ ] Selecionar um dia fechado: ele deve ficar desabilitado no formulário.
- [ ] Tentar plano que termina depois do fechamento: backend deve bloquear.
- [ ] Confirmar plano válido e verificar as aulas geradas.

## Reagendamento
- [ ] Alterar uma aula para horário permitido: deve salvar.
- [ ] Alterar para dia fechado: deve bloquear.
- [ ] Alterar para antes da abertura: deve bloquear.
- [ ] Em aula de plano, testar **aplicar às próximas** dentro do funcionamento.
- [ ] Tentar deslocar a série para horário/dia fechado: deve bloquear e preservar a série original.

## Agenda semanal
- [ ] A grade começa no horário configurado.
- [ ] Os intervalos da grade refletem duração padrão + intervalo.
- [ ] Dias sem funcionamento aparecem como **Fechado**.
- [ ] Células externas ao funcionamento não permitem nova aula.
- [ ] Aulas antigas fora da regra continuam visíveis.
- [ ] Clicar em horário livre permitido abre Nova Aula com data/horário preenchidos.

## Regressão
- [ ] CPF continua funcionando.
- [ ] Cadastro de alunos funciona.
- [ ] Instrutores, veículos e locais funcionam.
- [ ] Ativar/desativar recursos funciona.
- [ ] Agenda diária funciona.
- [ ] Agenda semanal funciona.
- [ ] Planos automáticos funcionam.
- [ ] Conflitos de aluno/instrutor/veículo continuam funcionando.
