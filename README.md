# AutoAgenda V1.7 — Horário de Funcionamento

Esta versão implementa a **ETAPA 3 — Horário de funcionamento** do roteiro de evolução do AutoAgenda, mantendo as funcionalidades da V1.6 (CPF, configurações completas, planos automáticos e agenda semanal em grade).

## Novidades

### Horário de funcionamento
Na aba **Configurações** agora é possível definir:

- dias de funcionamento;
- horário de abertura;
- horário de encerramento;
- duração padrão da aula;
- intervalo entre aulas.

A configuração é gravada no PostgreSQL na tabela `autoagenda.configuracoes`.

### Regras automáticas
O backend impede novos agendamentos fora da configuração em:

- aula manual;
- criação de plano automático;
- prévia do plano automático;
- reagendamento/alteração de data e horário;
- alteração em série das próximas aulas de um plano.

O intervalo configurado também é considerado na detecção de conflito para aluno, instrutor e veículo.

### Compatibilidade com o histórico
Alterar o horário de funcionamento **não apaga nem remarca aulas já existentes**.

Se uma configuração nova deixar aulas futuras antigas fora do novo horário, o AutoAgenda informa a quantidade, mas preserva os registros. Essas aulas continuam visíveis na agenda semanal.

### Agenda semanal
A grade semanal agora usa automaticamente:

- abertura;
- encerramento;
- duração padrão;
- intervalo.

Dias fechados aparecem como **Fechado** e horários externos à regra aparecem como **Fora do horário**. Aulas antigas fora da regra continuam visíveis.

### Duração padrão
Ao criar uma nova aula ou um novo plano, o formulário inicia com a duração padrão definida em Configurações. O backend também utiliza essa duração como padrão quando ela não é enviada pela interface.

## Valores iniciais seguros

Na primeira inicialização da V1.7, a configuração padrão é:

- todos os dias habilitados;
- 07:00 às 20:00;
- 50 minutos por aula;
- 0 minuto de intervalo.

Esses valores foram escolhidos para não restringir automaticamente o comportamento que já existia na V1.6. Depois do deploy, ajuste-os para o funcionamento real.

## Banco de dados

Não é necessário criar outro banco e não é necessário executar SQL manualmente.

O `server.js` cria automaticamente a tabela de configuração e o registro inicial, sem apagar alunos, aulas, planos ou recursos existentes.

## Atualização

1. Faça backup da versão atual que está funcionando.
2. Substitua os arquivos do repositório pelos arquivos desta pasta.
3. Não altere `DATABASE_URL`.
4. Faça commit no GitHub.
5. Aguarde o deploy do Render.
6. Pressione `Ctrl + F5`.
7. Confirme no topo **AutoAgenda V1.7.0**.
8. Abra **Configurações → Horário de funcionamento**.
9. Execute o `CHECKLIST_V1.7.md`.

## Próxima etapa

Depois de testar e aprovar esta versão:

**ETAPA 4 — Disponibilidade individual do instrutor**

Essa etapa adicionará dias e horários de trabalho por instrutor, intervalos, folgas e indisponibilidades específicas, sem modificar aulas antigas.
