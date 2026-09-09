# RELATÓRIO DE TESTES — AutoAgenda V3.1.0

## Escopo

ETAPA 17 — Níveis de acesso.

## Testes estáticos executados

- `node --check server.js`: OK
- `node --check public/app.js`: OK
- `npm run check`: OK
- IDs HTML duplicados: 0
- rotas Express duplicadas: 0
- versão de backend/package: 3.1.0

## Validações de segurança revisadas no código

- autorização de backend independente do frontend;
- perfil Instrutor exige `instrutor_id` para acesso operacional;
- consulta de aulas filtrada pelo instrutor da sessão;
- consulta de aluno exige relação prévia com o instrutor;
- histórico de aulas/planos filtrado pelo instrutor;
- busca de horário livre valida relação aluno × instrutor;
- alteração de status/confirmação consulta somente aula do instrutor;
- reposição força o `instrutor_id` da sessão;
- WhatsApp da aula filtra pelo instrutor;
- WhatsApp de plano completo bloqueado para Instrutor;
- módulos administrativos retornam 403 para Instrutor;
- índice único evita duas contas Instrutor para o mesmo cadastro operacional.

## Migração

A V3.1 adiciona `autoagenda.usuarios.instrutor_id` de modo automático.
A chave estrangeira é criada somente depois de `autoagenda.instrutores` existir.

## Testes que precisam ser confirmados no Render

A validação dinâmica com o PostgreSQL real deve seguir `CHECKLIST_V3.1.md`,
principalmente com uma conta Administrador e uma conta Instrutor de teste.

## Resultado

A versão passou na revisão estática e está pronta para deploy de teste no Render.
