# AutoAgenda V1.5.1 — Configurações completas

Esta versão conclui a **ETAPA 1 — Configurações** do roteiro de evolução do AutoAgenda.

## O que mudou nesta versão

- Cadastro e edição de **instrutores**, **veículos** e **locais** foram preservados.
- Agora os três tipos de recurso podem ser **desativados** sem apagar o histórico.
- Novo botão **Mostrar inativos** na área Configurações.
- Recursos inativos podem ser **reativados**.
- A exclusão definitiva só é permitida quando o cadastro **nunca foi usado** em nenhuma aula ou plano.
- Se houver plano ativo ou aula futura vinculada, a desativação é bloqueada.
- Recursos inativos deixam de aparecer em novas aulas e novos planos automáticos.
- O backend também valida que novos agendamentos usem recursos ativos.
- Foram adicionadas verificações para evitar duplicidades evidentes:
  - instrutor por e-mail/WhatsApp ou, sem contato, pelo mesmo nome;
  - veículo pela placa ou, sem placa, por nome + categoria;
  - local por nome + endereço.
- Ao tentar cadastrar novamente um recurso já inativo, o sistema orienta a usar **Mostrar inativos** e reativar o cadastro.
- A Agenda Semanal da V1.5 foi mantida sem novas alterações nesta etapa.

## Banco de dados

Não é necessário criar outro banco nem executar SQL manualmente.

As colunas `ativo` já existiam nas tabelas:
- `autoagenda.instrutores`
- `autoagenda.veiculos`
- `autoagenda.locais`

A V1.5.1 apenas utiliza essa estrutura de forma mais completa e segura.

## Atualização

1. Faça backup da versão atual.
2. Substitua os arquivos do repositório pelos arquivos desta pasta.
3. Não altere a sua `DATABASE_URL`.
4. Faça commit no GitHub.
5. Aguarde o deploy do Render.
6. No navegador, pressione **Ctrl + F5** uma vez.
7. No topo, confirme **AutoAgenda V1.5.1**.

## Arquivos principais alterados

- `server.js`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `package.json`
- `sql/schema.sql`

## Próxima etapa

Depois de testar e aprovar esta versão, a próxima etapa do roteiro será:

**ETAPA 2 — Agenda Semanal completa**

Nela vamos trabalhar a grade com horários em linhas, dias em colunas, filtro por veículo e criação de aula clicando diretamente em um horário vazio.
