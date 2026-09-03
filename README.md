# AutoAgenda V1.4 — Revisão e Correções

Sistema web para gestão de aulas práticas de direção, com alunos, agenda manual, planos automáticos, conflitos de horário e PostgreSQL.

## O que foi corrigido nesta revisão

- Plano automático agora respeita o **saldo de aulas** do aluno e não deixa gerar mais aulas do que o disponível.
- A contagem de **aulas agendadas** considera somente aulas de hoje em diante.
- As aulas realizadas **antes do AutoAgenda** agora são somadas corretamente às aulas marcadas como realizadas dentro do sistema.
- Ao excluir um aluno, o sistema **encerra seus planos ativos e cancela aulas futuras**, preservando o histórico.
- Alterar **esta aula e as próximas** agora atualiza também os dias da semana do plano.
- A alteração em série preserva a duração/quantidade das demais ocorrências, evitando transformar a última aula simples de um plano com aulas duplas.
- Conflitos consideram apenas aulas que realmente ocupam agenda (`AGENDADA` e `CONFIRMADA`).
- A criação manual de aula passa a respeitar o status enviado pela tela.
- Domingo passou a ser aceito no plano automático.
- `sql/schema.sql` foi refeito para usar corretamente o schema `autoagenda` e refletir a estrutura atual.
- HTML/JS/CSS não ficam presos em cache antigo após um deploy, reduzindo o risco de aparecer uma versão antiga no navegador.
- Cabeçalhos básicos de segurança foram adicionados.
- Proteção opcional por usuário/senha foi adicionada via variáveis de ambiente.
- Arquivos antigos de atualização foram consolidados para deixar o repositório mais limpo.

## Banco

O `server.js` continua fazendo a criação/migração do schema automaticamente. Não é necessário executar `sql/schema.sql` a cada atualização.

Variáveis obrigatórias:

- `DATABASE_URL`
- `NODE_ENV=production`
- `APP_TIMEZONE=America/Porto_Velho` (pode ser ajustado se o sistema for usado em outra região)

Proteção recomendada para o sistema publicado:

- `AUTOAGENDA_USER`
- `AUTOAGENDA_PASSWORD`

Quando as duas são configuradas no Render, o navegador solicitará usuário e senha para abrir o AutoAgenda.

## Teste rápido depois do deploy

1. Abra **Alunos** e confira os cadastros existentes.
2. Em um aluno com saldo, clique **Montar agenda**.
3. Gere a prévia e confirme o plano.
4. Abra **Planos** e confirme que o plano aparece.
5. Abra uma aula do plano, mude dia/horário e marque **aplicar às próximas**.
6. Volte a **Planos** e confira se os dias/horário foram atualizados.
7. Atualize a página com `Ctrl + F5` e confirme que os dados continuam salvos.

## Verificação local de sintaxe

```bash
npm run check
```

## Publicação

Fluxo atual: GitHub → Render → PostgreSQL.

Nunca publique `DATABASE_URL`, usuário/senha do banco ou a senha do AutoAgenda no GitHub.
