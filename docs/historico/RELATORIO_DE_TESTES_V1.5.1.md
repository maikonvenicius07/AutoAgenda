# Relatório de testes — AutoAgenda V1.5.1

## Testes executados antes de gerar o ZIP

- `node --check server.js` — aprovado.
- `node --check public/app.js` — aprovado.
- `npm run check` — aprovado.
- Verificação estática dos IDs usados pelo JavaScript contra o `index.html` — nenhum ID ausente.
- Verificação de IDs duplicados no HTML — nenhum encontrado.
- Conferência das novas rotas de ativação/desativação e exclusão permanente — presentes no backend.
- Conferência de que os seletores de novas aulas e planos continuam usando somente os endpoints padrão, que retornam recursos ativos.
- Conferência de que a área Configurações usa os endpoints com `incluir_inativos=1` para permitir reativação.

## Testes que precisam ser feitos no Render/PostgreSQL real

Como este ambiente não utiliza a `DATABASE_URL` privada do projeto, os seguintes testes devem ser realizados após o deploy:

1. cadastrar, editar, desativar e reativar cada tipo de recurso;
2. confirmar o bloqueio ao desativar recurso com aula futura ou plano ativo;
3. confirmar a exclusão definitiva de recurso inativo sem histórico;
4. confirmar a proteção de recurso inativo que já possui histórico;
5. testar a prevenção de duplicidade;
6. criar uma aula e um plano automático usando recursos ativos;
7. confirmar que recursos inativos não aparecem nos seletores;
8. testar novamente Agenda diária, Agenda semanal, alunos, planos e conflitos.

## Resultado

A versão está aprovada nos testes de sintaxe e consistência estática. A aprovação final da ETAPA 1 depende do checklist funcional após o deploy no Render.
