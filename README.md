# AutoAgenda V3.1.6

Sistema de organização de aulas práticas para autoescola, com backend Node/Express, PostgreSQL e deploy no Render.

## Recursos consolidados

- alunos com CPF, WhatsApp, e-mail, pacote contratado e histórico;
- agenda diária e semanal;
- planos automáticos;
- horário de funcionamento;
- disponibilidade de instrutores e veículos;
- busca de horários livres;
- reagendamento inteligente;
- WhatsApp da aula e do plano;
- confirmação e lembretes;
- Dashboard e relatórios;
- financeiro simples;
- backup/exportação CSV, Excel e JSON;
- modo claro/escuro;
- login individual com senha em hash e sessão segura;
- níveis de acesso Administrador e Instrutor.





## V3.1.6 — Auditoria de segurança e permissões

- reforçada a identificação do IP real no Render usando `trust proxy` limitado a um salto, sem confiar diretamente em `X-Forwarded-For` recebido do navegador;
- login inválido agora executa o mesmo custo de `scrypt` mesmo quando o usuário não existe, reduzindo diferença de tempo útil para enumeração de logins;
- incluída limpeza defensiva do controle em memória de tentativas de login;
- respostas de `/api/` e `/whatsapp/` recebem `Cache-Control: no-store`;
- adicionados `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy`;
- parser de query alterado para o modo simples, suficiente para os filtros atuais e com menor superfície de entrada;
- permissões do perfil Instrutor passam a abranger também as rotas `/whatsapp/` na barreira central do backend;
- a rota de aluno específico entrega CPF completo somente ao ADMIN; ao INSTRUTOR retorna apenas a versão mascarada;
- mantidas as regras existentes de escopo das próprias aulas/alunos do instrutor;
- nenhuma regra de agenda, saldo, planos ou financeiro foi alterada.

## V3.1.5 — Schema SQL alinhado às migrações atuais

- `sql/schema.sql` revisado contra o `initDatabase()` do `server.js`.
- incluídas migrações dos campos de disponibilidade individual dos instrutores para bancos antigos.
- incluída migração e normalização do campo `situacao` dos veículos.
- nenhuma funcionalidade, tela ou regra de negócio foi alterada.


## V3.1.4 — Dependências reproduzíveis com package-lock.json

- adicionado `package-lock.json` compatível com as versões exatas já declaradas no `package.json`;
- mantidas as dependências diretas atuais, sem atualização: `dotenv 16.4.7`, `express 4.21.2` e `pg 8.13.1`;
- confirmado que as três dependências externas são utilizadas pelo `server.js`;
- confirmado que `crypto`, `path` e `zlib` são módulos nativos do Node.js e não precisam ser declarados como dependências;
- `npm run check` continua validando `server.js` e `public/app.js`;
- o próprio npm aceitou o lockfile em modo offline e `npm ls --package-lock-only --all` validou a árvore declarada;
- nenhuma funcionalidade da aplicação foi alterada.

**Observação de validação:** o ambiente usado para preparar esta manutenção não conseguiu acessar o registro público do npm, portanto o `npm install` com download real não pôde ser concluído aqui. O lockfile foi validado estruturalmente e deve ser confirmado também pelo próximo deploy do Render, que executa `npm install`.

## V3.1.3 — Proteção do repositório com .gitignore

- adicionado `.gitignore` adequado para Node.js, Express, PostgreSQL e Render;
- `.env`, `node_modules/`, logs, caches, temporários, arquivos de editor/SO, bancos locais e pacotes de backup passam a ficar fora do Git;
- mantida exceção para um futuro `.env.example`, que pode documentar nomes de variáveis sem expor valores;
- confirmado que `render.yaml`, `package.json`, `server.js`, `public/` e `sql/` não são bloqueados;
- nenhuma credencial real ou arquivo sensível foi encontrado na versão analisada;
- nenhuma funcionalidade da aplicação foi alterada.

## V3.1.2 — Limpeza e organização do projeto

- removidos `app.js` e `index.html` antigos da raiz; a aplicação atual usa somente `public/app.js` e `public/index.html`;
- removidas da raiz 14 cópias idênticas de documentos já preservados em `docs/historico/`;
- nenhuma funcionalidade da aplicação foi alterada;
- estrutura ativa mantida em `server.js`, `public/`, `sql/`, `package.json` e `render.yaml`;
- versão de manutenção atualizada para V3.1.2.

## V3.1.1 — Data de nascimento do aluno

- Campo opcional **Data de nascimento (aniversário)** no cadastro e edição de alunos.
- A data aparece no cartão do aluno e no cabeçalho do histórico.
- Validação impede datas futuras.
- Alunos já cadastrados continuam válidos sem preencher o novo campo.
- A coluna `data_nascimento` entra automaticamente nos backups CSV, Excel e JSON.

## V3.1.0 — Níveis de acesso

A ETAPA 17 aplica as permissões no frontend e, principalmente, no backend.

### Administrador

O perfil `ADMIN` mantém acesso integral:
- Painel;
- Alunos;
- Agenda diária e semanal;
- Planos;
- Lembretes;
- Relatórios;
- Financeiro;
- Backup;
- Usuários;
- Configurações.

Também continua responsável por cadastrar/editar usuários e vincular contas de perfil Instrutor.

### Instrutor

O perfil `INSTRUTOR` fica restrito a:
- alunos relacionados às suas próprias aulas;
- sua agenda diária;
- sua agenda semanal;
- WhatsApp das próprias aulas;
- histórico do aluno limitado às aulas/planos daquele instrutor;
- alteração de situação e confirmação das próprias aulas;
- reagendamento de aula cancelada, respeitando disponibilidade, veículo, local, saldo e conflitos.

O perfil Instrutor não pode acessar ou alterar:
- configurações;
- outros instrutores;
- planos automáticos;
- lembretes administrativos;
- relatórios;
- financeiro;
- backup;
- usuários;
- cadastro/edição/desativação de alunos;
- criação de aula avulsa;
- edição completa de aula;
- envio de plano completo pelo WhatsApp.

As restrições acima são validadas pelo servidor. Esconder botões e abas no frontend é apenas uma camada adicional de usabilidade.

## Vínculo usuário ↔ instrutor

A tabela `autoagenda.usuarios` passa a ter `instrutor_id`.

Quando o perfil for **Instrutor**, o administrador deve selecionar qual cadastro de instrutor corresponde àquela conta.

Regras:
- o vínculo é obrigatório para o perfil Instrutor;
- cada instrutor pode ter uma única conta de perfil Instrutor;
- um usuário Instrutor sem vínculo consegue autenticar, mas o backend bloqueia o acesso operacional até o administrador realizar o vínculo;
- contas Administrador não usam `instrutor_id`.

A migração é automática e preserva usuários e dados existentes.

## Segurança

- sessão individual com cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- senha armazenada com `scrypt` e salt aleatório;
- autorização aplicada em cada operação sensível do backend;
- consultas de agenda e aluno são filtradas pelo `instrutor_id` da sessão;
- alteração de status/confirmação exige que a aula pertença ao instrutor autenticado;
- busca de horário livre exige aluno relacionado ao instrutor;
- reagendamento força o instrutor da sessão;
- backup, financeiro, configurações e usuários permanecem restritos ao Administrador;
- credenciais e sessões continuam fora do Backup/Exportação.

## Banco

Migração automática:
- adiciona `autoagenda.usuarios.instrutor_id`;
- cria FK para `autoagenda.instrutores`;
- cria índice único parcial para impedir duas contas de Instrutor vinculadas ao mesmo cadastro.

Não é necessário executar SQL manualmente.

## Dependências

- Node.js >= 20
- Express 4.21.2
- pg 8.13.1
- dotenv 16.4.7

Nenhuma dependência externa nova foi adicionada.

## Próximo passo recomendado

As 17 etapas do roteiro principal estão concluídas. O próximo passo recomendado é uma **auditoria técnica final da V3.1**, sem adicionar funcionalidades, antes de iniciar uma nova fase do AutoAgenda.
