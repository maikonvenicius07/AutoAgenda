# RELATÓRIO — AutoAgenda V3.5.0

## Objetivo

Implementar a restauração segura do backup completo JSON sem comprometer o sistema de login, as exportações existentes ou a integridade do PostgreSQL.

## Fluxo implementado

1. O ADMIN seleciona um arquivo `.json`.
2. O navegador envia o arquivo para a rota de validação.
3. O servidor valida metadados, versão, estrutura, colunas, IDs e referências.
4. O servidor devolve um SHA-256 do conteúdo e um resumo comparando dados atuais com os dados do arquivo.
5. O ADMIN confirma que está ciente, digita `RESTAURAR` e confirma novamente no modal.
6. A execução recalcula o SHA-256 e rejeita o arquivo se ele tiver mudado desde a análise.
7. O PostgreSQL inicia uma única transação e adquire um advisory lock de restauração.
8. Os dados operacionais atuais são removidos em ordem segura e os dados do backup são inseridos preservando os IDs.
9. As sequences são reajustadas.
10. Em qualquer falha é executado `ROLLBACK`, evitando banco parcialmente restaurado.

## Dados restaurados

- alunos;
- instrutores;
- indisponibilidades de instrutores;
- veículos;
- indisponibilidades de veículos;
- locais;
- configurações;
- planos;
- aulas;
- financeiro;
- histórico de lembretes;
- histórico de e-mails.

## Dados deliberadamente preservados

- usuários;
- hashes de senha;
- sessões;
- variáveis de ambiente;
- credenciais do Render, WhatsApp e serviço de e-mail.

Os vínculos de contas `INSTRUTOR` são capturados antes da substituição dos instrutores e religados ao mesmo `instrutor_id` somente quando o ID e pelo menos um identificador do instrutor (nome, e-mail ou WhatsApp) forem compatíveis no backup restaurado.

## Proteções adicionais

- arquivo limitado a 10 MB;
- no máximo 50.000 registros por conjunto e 100.000 no total;
- somente `AUTOAGENDA_BACKUP_COMPLETO` com `versao_backup=1`;
- backup de versão futura é rejeitado;
- colunas não existentes ou não declaradas são rejeitadas;
- metadados de token de confirmação são proibidos;
- referências quebradas entre alunos/instrutores/veículos/locais/planos/aulas são rejeitadas antes da execução;
- restaurações simultâneas são bloqueadas;
- a restauração também assume os locks dos workers de WhatsApp/e-mail e bloqueia temporariamente as tabelas operacionais, evitando alterações/envios concorrentes durante a transação;
- filas `PENDENTE`/`PROCESSANDO` são transformadas em `CANCELADO`;
- WhatsApp e e-mail automáticos são forçados para desligado após a restauração;
- CSV e Excel não são aceitos como formato de restauração.

## Validação executada

- `npm run check`: aprovado;
- `npm run test:static`: **70/70 aprovado**;
- `npm ls --package-lock-only --all`: aprovado estruturalmente;
- nenhuma dependência nova adicionada.

## Limitação da validação local

O ambiente de preparação não possui o PostgreSQL real do Render nem uma sessão de produção. Por isso, a transação de restauração precisa ser validada no Render com um backup de teste seguindo `CHECKLIST_V3.5.0.md` antes de uso sobre dados importantes.
