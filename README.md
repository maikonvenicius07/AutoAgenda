# AutoAgenda V3.0.0

Sistema de organização de aulas práticas para autoescola, com backend Node/Express, PostgreSQL e deploy no Render.

## Recursos consolidados

- alunos com CPF, WhatsApp, e-mail, pacote contratado e reativação;
- agenda diária e semanal;
- planos automáticos;
- horário de funcionamento;
- disponibilidade e folgas dos instrutores;
- situação, manutenção e indisponibilidade dos veículos;
- busca dos próximos horários livres;
- reagendamento inteligente com vínculo entre aula original e reposição;
- histórico completo do aluno;
- WhatsApp da aula e envio do plano completo;
- confirmação da aula;
- lembretes de aula;
- Dashboard;
- relatórios por período;
- financeiro simples;
- backup/exportação em CSV, Excel e JSON;
- modo claro/escuro;
- login individual;
- preservação do histórico.

## V3.0.0 — Login individual

A ETAPA 16 substitui a autenticação básica do navegador por uma tela de login própria do AutoAgenda.

### Usuários

O banco possui a tabela `autoagenda.usuarios` com:
- nome;
- login;
- e-mail;
- `senha_hash`;
- perfil (`ADMIN` ou `INSTRUTOR`);
- ativo/inativo;
- último login;
- datas de criação e atualização.

A senha nunca é armazenada em texto puro.

### Hash de senha

As senhas são protegidas com `scrypt`, salt aleatório e comparação resistente a timing attack.

### Sessões

As sessões são salvas na tabela `autoagenda.sessoes`.

O navegador recebe somente um token aleatório em cookie:
- `HttpOnly`;
- `SameSite=Lax`;
- `Secure` em produção;
- duração de 12 horas.

No banco é armazenado apenas o SHA-256 do token, nunca o token original.

Ao desativar um usuário, suas sessões abertas são revogadas.

### Primeiro administrador

Para uma migração segura da V2.9.1:

1. a V3.0 cria automaticamente as tabelas de usuários e sessões;
2. se ainda não existir nenhum usuário, as variáveis já configuradas no Render
   `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD` são usadas uma única vez para criar
   o primeiro administrador;
3. a senha é imediatamente convertida para hash;
4. depois disso, o login passa a usar os usuários gravados no PostgreSQL.

Portanto, não é necessário trocar nem apagar as variáveis do Render nesta atualização.

### Área Usuários

Administradores possuem a aba **👥 Usuários**, com:
- criação de conta;
- edição de nome, login, e-mail e perfil;
- troca de senha;
- ativação/desativação;
- proteção para não desativar o próprio usuário;
- proteção para não remover/desativar o último administrador ativo.

Nesta versão, o perfil já é gravado, mas a limitação detalhada de módulos para o perfil Instrutor será implementada na ETAPA 17.

## Segurança

- todas as rotas `/api/*`, exceto health e autenticação, exigem sessão válida;
- rotas do WhatsApp também exigem sessão;
- existe limitação de tentativas de login;
- usuário inativo não consegue usar sessão existente;
- alteração de senha revoga outras sessões do usuário;
- hashes e sessões não entram no Backup/Exportação da ETAPA 15;
- `DATABASE_URL`, senhas e tokens não são gravados no código.

## Banco

A migração é automática no início do servidor.

Novas tabelas:
- `autoagenda.usuarios`;
- `autoagenda.sessoes`.

Não é necessário executar SQL manualmente.

## Dependências

- Node.js >= 20
- Express 4.21.2
- pg 8.13.1
- dotenv 16.4.7

Nenhuma nova dependência externa foi adicionada para autenticação.

## Próxima etapa

**ETAPA 17 — Níveis de acesso**, aplicando permissões diferentes para Administrador e Instrutor.
