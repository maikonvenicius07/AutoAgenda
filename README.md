# AutoAgenda V3.1.0

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
