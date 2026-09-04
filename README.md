# AutoAgenda V2.6.0

Sistema de organização de aulas práticas para autoescola, com backend Node/Express, PostgreSQL e deploy no Render.

## Recursos consolidados

- alunos com CPF, WhatsApp, e-mail, pacote contratado e reativação;
- agenda diária e semanal;
- planos automáticos;
- horário de funcionamento;
- disponibilidade e folgas dos instrutores;
- situação, manutenção e indisponibilidade dos veículos;
- busca dos próximos horários livres;
- reagendamento inteligente com vínculo entre aula original e reposição;
- histórico completo do aluno;
- WhatsApp da aula e envio do plano completo;
- confirmação da aula: aguardando, confirmada ou pediu reagendamento;
- lembretes no dia anterior e algumas horas antes;
- controle manual de lembrete enviado, preparado para futura automação;
- Dashboard com indicadores e gráficos simples;
- modo claro/escuro;
- controle de saldo e preservação do histórico.

## V2.6.0 — Dashboard

A ETAPA 12 amplia o **🏠 Painel** para funcionar como um Dashboard leve do AutoAgenda.

Indicadores exibidos:
- alunos ativos;
- aulas de hoje;
- aulas da semana;
- aulas realizadas no mês;
- faltas no mês;
- cancelamentos no mês;
- reposições no mês;
- taxa estimada de ocupação da semana;
- horários livres estimados para o restante da semana;
- aulas futuras agendadas;
- planos ativos;
- alunos com até 5 aulas restantes para concluir o pacote.

Também foram adicionados dois gráficos simples em CSS/HTML, sem bibliotecas externas:
- movimento da semana por dia;
- resultado do mês por situação.

### Taxa de ocupação

A taxa de ocupação é uma **estimativa operacional** calculada a partir do horário de funcionamento, duração padrão, intervalo e quantidade global de instrutores ativos e veículos disponíveis. Ela não substitui a validação individual de disponibilidade do instrutor, veículo, folgas ou manutenções, que continua sendo feita no momento do agendamento.

A implementação foi mantida leve: o navegador recebe apenas dados agregados do PostgreSQL; não é necessário carregar todo o histórico de aulas para montar o Dashboard.

## Banco

A V2.6.0 não cria novas tabelas ou colunas. Nenhuma migração manual é necessária.

## Próxima etapa

**ETAPA 13 — Relatórios**: permitir selecionar período e visualizar aulas realizadas, cancelamentos, faltas, reposições, aulas por instrutor, aulas por veículo, alunos ativos, horários mais utilizados e taxa de ocupação, preparando futura exportação para Excel.
