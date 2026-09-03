# AutoAgenda V1.6 — CPF + Agenda Semanal completa

Esta versão conclui a **ETAPA 2 — Agenda Semanal** do roteiro de evolução do AutoAgenda e inclui, a pedido do projeto, o campo **CPF** no cadastro de alunos.

## Novidades

### Cadastro de alunos
- Novo campo **CPF** no cadastro e na edição.
- Máscara automática no formato `000.000.000-00`.
- Validação dos dígitos verificadores no backend.
- CPF duplicado é bloqueado.
- Registros antigos sem CPF são preservados; ao editá-los, o sistema solicitará o preenchimento.
- Na lista de alunos o CPF aparece mascarado, exibindo somente os dois últimos dígitos.

### Agenda semanal completa
- Dias da semana em **colunas**.
- Horários em **linhas**.
- Navegação: semana anterior, hoje e próxima semana.
- Filtro por **instrutor**.
- Novo filtro por **veículo**.
- Cada aula mostra:
  - horário;
  - aluno;
  - instrutor;
  - veículo;
  - local;
  - status.
- Clique na aula para editar.
- Clique em uma célula livre para abrir **Nova aula** já com data e horário preenchidos.
- Quando houver filtro por instrutor/veículo, o recurso filtrado já vem selecionado na nova aula.
- A semana consulta o backend somente pelo intervalo de 7 dias.
- As regras existentes de conflito do backend foram preservadas.

## Horários da grade

A ETAPA 3 ainda definirá o horário oficial de funcionamento da autoescola. Até lá, a agenda semanal utiliza como base **07:00 a 20:00**, em intervalos de **50 minutos**, incluindo automaticamente horários reais que já existam fora dessa grade.

## Banco de dados

Não é necessário criar outro banco nem executar SQL manualmente.

Na inicialização, o `server.js` executa migração segura:

```sql
ALTER TABLE autoagenda.alunos
ADD COLUMN IF NOT EXISTS cpf VARCHAR(11);
```

Também cria índice único para CPF preenchido.

## Atualização

1. Faça backup da versão que está funcionando.
2. Substitua os arquivos do repositório pelos arquivos desta pasta.
3. Não altere `DATABASE_URL`.
4. Faça commit no GitHub.
5. Aguarde o deploy do Render.
6. Pressione `Ctrl + F5` no navegador.
7. Confirme no topo **AutoAgenda V1.6.0**.
8. Execute o `CHECKLIST_V1.6.md`.

## Próxima etapa

Depois que esta versão estiver aprovada:

**ETAPA 3 — Horário de funcionamento**

Nela serão definidos dias de funcionamento, abertura, encerramento, duração padrão da aula e intervalo entre aulas.
