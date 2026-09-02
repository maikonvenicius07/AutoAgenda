# AutoAgenda V1

Primeira versão online do AutoAgenda no mesmo modelo de trabalho do projeto Mau-Mau:

**GitHub → Render → PostgreSQL**

## O que já funciona

- Cadastro de alunos salvo no banco
- Cadastro de aulas salvo no banco
- Consulta da agenda
- Instrutor, veículo e local iniciais para teste
- Bloqueio de conflito de horário por aluno, instrutor ou veículo
- Interface amarelo/preto inspirada na identidade do instrutor

## O que cada serviço faz

- **GitHub:** guarda o código
- **Render Web Service:** executa o AutoAgenda
- **PostgreSQL:** guarda alunos e aulas

## Passo 1 — GitHub

1. Crie um repositório chamado `autoagenda`.
2. Extraia este ZIP.
3. Envie **todos os arquivos** para a raiz do repositório.

A raiz deve conter:

```text
public/
sql/
server.js
package.json
render.yaml
.env.example
.gitignore
README.md
```

## Passo 2 — Banco PostgreSQL no Render

1. No Render, clique em **New**.
2. Crie um **PostgreSQL**.
3. Nome sugerido: `autoagenda-db`.
4. Após criar, copie a URL de conexão do banco.

## Passo 3 — Criar as tabelas

Execute no PostgreSQL todo o conteúdo do arquivo:

```text
sql/schema.sql
```

Ele criará as tabelas:

- instrutores
- alunos
- veiculos
- locais
- aulas

Também cria um instrutor, um veículo e um local iniciais para teste.

## Passo 4 — Web Service

1. No Render: **New → Web Service**.
2. Conecte o GitHub `autoagenda`.
3. Runtime: **Node**.
4. Build Command:

```text
npm install
```

5. Start Command:

```text
npm start
```

## Passo 5 — Variável DATABASE_URL

No Web Service do AutoAgenda, abra **Environment**.

Crie:

```text
DATABASE_URL
```

Cole a URL do PostgreSQL.

Também configure:

```text
NODE_ENV=production
```

## Passo 6 — Teste principal

Quando abrir o AutoAgenda deverá aparecer:

```text
🟢 Banco conectado — os cadastros serão salvos.
```

Cadastre um aluno, feche o navegador e abra novamente.

Se ele continuar aparecendo, significa que o banco está funcionando corretamente.

## Próxima versão

Depois que esta V1 estiver publicada e funcionando, faremos a V1.1 com:

- editar aluno
- excluir/desativar aluno
- cadastrar instrutores
- cadastrar veículos
- cadastrar locais
- editar/cancelar/remarcar aulas
