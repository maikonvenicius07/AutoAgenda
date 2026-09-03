# AutoAgenda V1.8.1 — Auditoria, Segurança e Integridade

Sistema web para organização de aulas práticas, com alunos, CPF, planos automáticos, agenda diária/semanal, configurações, horário de funcionamento e disponibilidade individual dos instrutores.

Esta versão é uma **versão de consolidação**. O objetivo principal não é adicionar um novo módulo, e sim corrigir os pontos de segurança e integridade identificados na auditoria da V1.8 antes de continuar a evolução funcional.

## Principais correções da V1.8.1

### Segurança

- Em `NODE_ENV=production`, o AutoAgenda exige `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD`.
- Se essas variáveis não estiverem configuradas, a aplicação permanece bloqueada para dados e interface até a configuração correta.
- Comparação de usuário/senha com função de tempo constante.
- Cabeçalhos de segurança reforçados, incluindo CSP, HSTS em produção, proteção contra framing e MIME sniffing.
- O CPF completo deixou de ser enviado na listagem geral de alunos.
- A listagem usa `cpf_mascarado`; o CPF completo é carregado apenas ao abrir um aluno específico para edição.
- Observações do aluno também deixam de ser enviadas na listagem geral e ficam restritas à consulta individual.
- `.gitignore` e `.env.example` adicionados sem credenciais reais.

### Integridade das aulas

- Nova aula manual passa a respeitar o saldo do pacote do aluno.
- Alteração de aula não pode aumentar o consumo acima do saldo disponível.
- Mudança de status também passa novamente pelas regras necessárias de saldo, conflito, funcionamento e disponibilidade.
- Aulas deixam de ser removidas fisicamente pelo endpoint de exclusão; são arquivadas/canceladas para preservar rastreabilidade.
- Aulas `REALIZADA` e `FALTOU` são protegidas e não podem ser arquivadas por essa ação comum.
- Aulas arquivadas ficam fora da agenda operacional.

### Concorrência e conflitos

- Operações críticas de agendamento usam bloqueios transacionais por aluno, instrutor, veículo e data para reduzir o risco de dois agendamentos simultâneos ocuparem o mesmo recurso.
- Planos automáticos também utilizam bloqueios durante a confirmação.
- A sugestão de próximo horário livre passa a respeitar a disponibilidade individual do instrutor, inclusive intervalos e indisponibilidades cadastradas.

### Alunos

- Aluno desativado pode ser visualizado em **Mostrar inativos** e reativado.
- Ao desativar um aluno, planos ativos são encerrados e aulas futuras agendadas/confirmadas são canceladas, preservando o histórico.
- O CPF continua único; se o CPF pertencer a um aluno inativo, o sistema orienta a reativação em vez de duplicar o cadastro.

### Desempenho

- A tela principal deixa de depender do download de todo o histórico de aulas.
- A API aceita consulta por intervalo de datas.
- Foi criado um resumo do dashboard para evitar carregar milhares de registros desnecessariamente.
- A edição de uma aula ou aluno consulta o registro específico quando necessário.

### Organização do projeto

- Documentação antiga foi movida para `docs/historico/`.
- Dependências do `package.json` foram fixadas em versões exatas para deixar o deploy mais previsível enquanto não há `package-lock.json`.
- O Render continua usando `npm install`.

## IMPORTANTE — antes do deploy da V1.8.1

Configure no Render, **antes de publicar esta versão**:

- `AUTOAGENDA_USER`
- `AUTOAGENDA_PASSWORD`

Use um usuário próprio e uma senha forte. Nunca coloque a senha no GitHub.

As demais variáveis continuam:

- `DATABASE_URL`
- `NODE_ENV=production`
- `APP_TIMEZONE=America/Porto_Velho`

## Atualização

1. Configure `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD` no Render.
2. Faça backup da versão atual do código.
3. Substitua os arquivos do repositório pelos desta versão.
4. Faça commit no GitHub.
5. Aguarde o deploy do Render.
6. Abra o AutoAgenda e faça `Ctrl + F5` uma vez.
7. Confirme em `/api/health` que a versão é `1.8.1` e que `security_ready` está `true`.
8. Execute o `CHECKLIST_V1.8.1.md`.

Não é necessário executar `schema.sql` manualmente. O `server.js` mantém a migração automática do schema `autoagenda`.

## Banco gratuito do Render

Esta versão **não altera o plano do Render nem migra o banco para um serviço pago**. O projeto pode continuar no ambiente gratuito conforme a decisão atual. O planejamento operacional é realizar backup/migração até **22/09/2026**, antes do vencimento já identificado no ambiente atual.

## Estrutura principal

```text
AutoAgenda/
├── server.js
├── package.json
├── render.yaml
├── .gitignore
├── .env.example
├── README.md
├── LEIA-ME-ATUALIZACAO.txt
├── CHECKLIST_V1.8.1.md
├── RELATORIO_DE_TESTES_V1.8.1.md
├── PROXIMAS_MELHORIAS.md
├── PLANO_BACKUP_22-09-2026.md
├── public/
├── sql/
└── docs/
    └── historico/
```

## Versão

**1.8.1**
