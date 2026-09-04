# AutoAgenda V2.3.1

Sistema de organização de aulas práticas para autoescola, com backend Node/Express, PostgreSQL e deploy no Render.

## Recursos consolidados

- alunos com CPF, WhatsApp, e-mail, pacote contratado e reativação;
- agenda diária e semanal;
- planos automáticos;
- horário de funcionamento;
- disponibilidade e folgas dos instrutores;
- situação, manutenção e indisponibilidade dos veículos;
- busca dos 5 próximos horários livres;
- reagendamento inteligente com vínculo entre aula original e reposição;
- histórico completo do aluno;
- envio manual de mensagem pronta pelo WhatsApp (`wa.me`);
- controle de saldo de aulas;
- preservação do histórico por arquivamento, sem exclusão física das aulas;
- autenticação básica obrigatória em produção;
- bloqueio temporário após tentativas repetidas de login.

## Segurança

Em produção, configure no Render:

- `DATABASE_URL`
- `NODE_ENV=production`
- `APP_TIMEZONE=America/Porto_Velho`
- `AUTOAGENDA_USER`
- `AUTOAGENDA_PASSWORD`

Nunca grave senhas ou a `DATABASE_URL` no GitHub. O arquivo `.env.example` contém somente exemplos.

## Banco

O servidor cria e migra automaticamente o schema `autoagenda`. A V2.3.1 inclui a estrutura de vínculo de reposição (`reposicao_de_id`) sem apagar dados antigos.

## Próxima etapa

ETAPA 10 — Confirmação da aula: aguardando confirmação, confirmada e pediu reagendamento.
