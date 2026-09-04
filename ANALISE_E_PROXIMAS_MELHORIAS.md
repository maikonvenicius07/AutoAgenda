# Análise — AutoAgenda V3.0.0

A V3.0 foi construída sobre a V2.9.1 estável, sem recriar o projeto.

## Alteração principal

Substituição da autenticação HTTP Basic por login individual persistido no PostgreSQL.

## Compatibilidade preservada

As funcionalidades de agenda, alunos, planos, WhatsApp, confirmação, lembretes,
Dashboard, relatórios, financeiro e backup permanecem com as mesmas rotas funcionais.

## Migração

As tabelas `usuarios` e `sessoes` são criadas automaticamente.
As variáveis `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD` são usadas apenas para
bootstrap do primeiro administrador quando a tabela de usuários estiver vazia.

## Próxima melhoria

ETAPA 17 — aplicar permissões de módulo e de dados conforme o perfil do usuário.
