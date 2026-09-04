# AutoAgenda V2.5.0

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
- WhatsApp da aula e envio do plano completo;
- confirmação da aula: aguardando, confirmada ou pediu reagendamento;
- lembretes no dia anterior e algumas horas antes;
- painel de lembretes pendentes/atrasados;
- controle manual de lembrete enviado, preparado para futura automação;
- modo claro/escuro;
- controle de saldo e preservação do histórico.

## V2.5.0 — Lembretes

A ETAPA 11 adiciona uma área **🔔 Lembretes** e configuração em **⚙️ Configurações**.

É possível definir:
- se haverá lembrete no dia anterior;
- o horário do lembrete no dia anterior;
- se haverá lembrete algumas horas antes;
- quantas horas antes.

Cada aula futura agendada/confirmada recebe os horários previstos dos lembretes. A tela mostra pendentes, atrasados e os próximos 7 dias. O envio continua manual pelo WhatsApp nesta versão; após enviar, o usuário pode marcar o lembrete como enviado.

Se uma aula for reagendada para outra data/horário, os controles de envio dos lembretes são reiniciados para a nova marcação.

## Banco

A migração é automática. Não execute SQL manualmente no Render.

## Próxima etapa

**ETAPA 12 — Dashboard**: ampliar o painel com aulas da semana, realizadas no mês, faltas, cancelamentos, reposições, taxa de ocupação, horários livres e alunos próximos de concluir o pacote.
