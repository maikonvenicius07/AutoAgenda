# AutoAgenda V2.8.0

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
- financeiro simples por aluno;
- modo claro/escuro;
- controle de saldo e preservação do histórico.

## V2.8.0 — Financeiro simples

A ETAPA 14 adiciona a aba **💰 Financeiro** para um controle básico de pacotes e pagamentos.

Cada lançamento permite registrar:
- aluno;
- pacote;
- valor do pacote;
- quantidade de aulas;
- valor pago até o momento;
- saldo financeiro calculado automaticamente;
- data do pagamento;
- vencimento;
- forma de pagamento;
- observações.

### Regra de separação

O módulo financeiro é propositalmente separado da lógica da agenda. Alterar um lançamento financeiro **não altera** aulas contratadas, planos, horários, presença, faltas ou saldo de aulas do aluno.

### Situações financeiras

A tela identifica automaticamente:
- **Quitado** — valor pago igual ao valor do pacote;
- **Parcial** — há pagamento, mas ainda existe saldo;
- **Pendente** — ainda não existe pagamento registrado;
- **Vencido** — existe saldo e a data de vencimento já passou.

Os lançamentos podem ser editados, arquivados e reativados sem exclusão física do histórico.

## Banco

A V2.8.0 cria automaticamente a tabela `autoagenda.financeiro` e seus índices. Não é necessário executar SQL manualmente.

O saldo financeiro não é armazenado como valor independente: ele é calculado como `valor_pacote - valor_pago`, reduzindo risco de divergência.

## Próxima etapa

**ETAPA 15 — Backup / Exportação**: exportar alunos, instrutores, veículos, locais, aulas, planos, financeiro e configurações em CSV/Excel/JSON, além de preparar backup completo para futura restauração, sem incluir credenciais.
