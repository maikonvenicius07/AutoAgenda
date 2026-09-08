# CHECKLIST — AutoAgenda V3.1.5

## Etapa concluída
PROMPT 4 — Atualizar e alinhar o `sql/schema.sql`.

## Diferenças encontradas e corrigidas
- [x] Adicionadas ao `schema.sql` as migrações de `instrutores.disponibilidade_personalizada`.
- [x] Adicionadas as migrações de `instrutores.dias_trabalho`.
- [x] Adicionadas as migrações de `instrutores.hora_inicio` e `hora_fim`.
- [x] Adicionadas as migrações de `instrutores.intervalo_inicio` e `intervalo_fim`.
- [x] Adicionada a migração de `veiculos.situacao`.
- [x] Adicionada a normalização de `veiculos.situacao` para instalações antigas, igual à lógica do `server.js`.
- [x] Mantidas as migrações automáticas no `server.js` sem alteração de lógica.
- [x] Mantidas as estruturas atuais de usuários, sessões, alunos, aulas, planos, confirmações, lembretes, financeiro e indisponibilidades.
- [x] Mantidos índices, chaves estrangeiras e restrições existentes.

## Validações locais
- [x] `npm run check`.
- [x] `node --check server.js`.
- [x] `node --check public/app.js`.
- [x] Conferência automática: todas as migrações `ALTER TABLE ... ADD COLUMN` do `initDatabase()` estão representadas no `schema.sql`.
- [x] Conferência dos índices criados pelo `initDatabase()`.
- [x] Nenhuma funcionalidade de interface ou regra de negócio alterada.

## Validação recomendada no Render
- [ ] Deploy concluído sem erro de inicialização do banco.
- [ ] Abrir `/api/health` e confirmar AutoAgenda V3.1.5 com banco conectado.
- [ ] Abrir o sistema e confirmar que os cadastros e a agenda existentes continuam disponíveis.

## Observação
O `server.js` continua sendo responsável por criar/migrar o banco automaticamente na inicialização. O `sql/schema.sql` permanece como referência e opção de execução manual controlada, agora alinhado às migrações atuais.
