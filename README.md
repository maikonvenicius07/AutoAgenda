# AutoAgenda V2.7.0

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
- Dashboard com indicadores e gráficos simples;
- relatórios por período;
- modo claro/escuro;
- controle de saldo e preservação do histórico.

## V2.7.0 — Relatórios

A ETAPA 13 adiciona a aba **📑 Relatórios** com seleção de data inicial e final.

O relatório apresenta:
- aulas realizadas;
- faltas;
- cancelamentos;
- reposições;
- alunos ativos;
- alunos com movimentação no período;
- aulas por instrutor;
- aulas por veículo;
- horários mais utilizados;
- taxa estimada de ocupação;
- capacidade estimada do período.

Os dados são calculados no PostgreSQL e enviados ao navegador já agregados, evitando carregar todo o histórico de aulas.

### Taxa de ocupação

A taxa de ocupação é uma **estimativa operacional**. Considera o horário de funcionamento, duração padrão, intervalo e a quantidade global de instrutores ativos e veículos disponíveis durante o cálculo. Folgas, indisponibilidades específicas e manutenções continuam sendo validadas normalmente no agendamento.

### Preparação para Excel

A resposta do backend já é organizada em blocos de resumo, instrutores, veículos e horários. Isso facilita adicionar exportação em Excel futuramente, sem misturar a ETAPA 13 com a ETAPA 15 — Backup/Exportação.

## Banco

A V2.7.0 não cria novas tabelas ou colunas. Nenhuma migração manual é necessária.

## Próxima etapa

**ETAPA 14 — Financeiro simples**: registrar pacote, valor do pacote, quantidade de aulas, valor pago, saldo financeiro, data do pagamento, vencimento, forma de pagamento e observações, mantendo o financeiro separado da lógica principal da agenda.
