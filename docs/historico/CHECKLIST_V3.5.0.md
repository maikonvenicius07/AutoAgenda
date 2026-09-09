# CHECKLIST — AutoAgenda V3.5.0

## Etapa concluída

**PROMPT 10 — Restauração segura de backup completo JSON**

## Implementado

- [x] restauração disponível somente para usuário ADMIN;
- [x] aceita somente backup completo JSON do AutoAgenda;
- [x] valida `tipo`, `schema`, `entidade`, `versao_backup` e `app_version`;
- [x] rejeita backup gerado por versão do AutoAgenda mais nova que a instalada;
- [x] valida conjuntos, tabelas, colunas, IDs duplicados e referências entre registros;
- [x] rejeita colunas de segurança dos tokens de confirmação;
- [x] limite de 10 MB por arquivo e 100.000 registros no total;
- [x] mostra resumo e comparação entre os dados atuais e os dados do backup antes da execução;
- [x] exige caixa de ciência, texto `RESTAURAR` e confirmação final;
- [x] usa SHA-256 para confirmar que o arquivo executado é exatamente o arquivo analisado;
- [x] restauração executada em transação PostgreSQL com `ROLLBACK` em caso de erro;
- [x] advisory lock impede duas restaurações simultâneas;
- [x] preserva usuários, hashes de senha e sessões;
- [x] tenta religar usuários INSTRUTOR ao mesmo `instrutor_id` depois da restauração;
- [x] restaura IDs originais e reajusta as sequences do PostgreSQL;
- [x] trata a FK autorreferente de reposição de aulas em duas etapas;
- [x] WhatsApp e e-mail automáticos ficam desligados após a restauração;
- [x] comunicações que estavam `PENDENTE` ou `PROCESSANDO` são restauradas como `CANCELADO` para evitar disparos inesperados;
- [x] tokens públicos de confirmação não são restaurados, pois já não fazem parte do backup;
- [x] CSV e Excel continuam somente para conferência/exportação;
- [x] nenhuma dependência npm nova foi adicionada.

## Testes automáticos executados

- [x] `npm run check`;
- [x] `node --check server.js`;
- [x] `node --check public/app.js`;
- [x] `npm run test:static` — **70/70 testes aprovados**;
- [x] `npm ls --package-lock-only --all` — lockfile estruturalmente válido.

## Testes obrigatórios no Render com PostgreSQL real

Execute primeiro com um backup de teste e dados que possam ser substituídos.

1. [ ] entrar como ADMIN e abrir **Backup**;
2. [ ] baixar um **backup completo JSON** da própria V3.5.0;
3. [ ] criar ou alterar um aluno de teste depois do download;
4. [ ] selecionar o JSON em **Restaurar backup completo**;
5. [ ] clicar **Analisar backup** e conferir as contagens Atual x Após restaurar;
6. [ ] marcar a ciência e digitar `RESTAURAR`;
7. [ ] confirmar a restauração final;
8. [ ] verificar que o aluno/alteração feita após o backup voltou ao estado do arquivo;
9. [ ] verificar aulas, planos, financeiro e configurações;
10. [ ] confirmar que o usuário ADMIN continua autenticando com a mesma senha;
11. [ ] testar um usuário INSTRUTOR já vinculado e confirmar se o vínculo foi preservado quando o instrutor correspondente existe no backup;
12. [ ] confirmar que WhatsApp automático ficou desligado;
13. [ ] confirmar que e-mail automático ficou desligado;
14. [ ] tentar restaurar um JSON inválido e confirmar que nada é alterado;
15. [ ] tentar analisar uma exportação parcial JSON e confirmar que ela é rejeitada;
16. [ ] confirmar que o backup CSV/Excel/JSON continua sendo gerado normalmente depois da restauração.

## Observação de segurança

Antes de restaurar dados reais, recomenda-se baixar um **backup completo JSON atual**. A restauração substitui dados operacionais; o sistema preserva as contas de acesso, mas não mantém uma segunda cópia automática dos dados anteriores à restauração.
