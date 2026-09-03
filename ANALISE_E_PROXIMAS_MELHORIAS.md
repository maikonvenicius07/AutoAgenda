# Análise do AutoAgenda e próximas melhorias

## Prioridade 1 — antes de uso real com vários alunos

### 1. Login e segurança
O sistema armazena nome, telefone e e-mail de alunos. A V1.4 já permite proteção básica por usuário/senha usando variáveis do Render. No futuro, o ideal é login individual por instrutor e níveis de acesso.

### 2. Cadastro de instrutores, veículos e locais
Hoje estes dados existem no banco, mas a tela ainda depende dos registros já cadastrados/seed. Criar uma aba **Configurações** com CRUD para:
- instrutores;
- veículos;
- locais/pontos de encontro;
- duração padrão da aula;
- horário de funcionamento.

### 3. Backup e exportação
Adicionar botão **Exportar backup** em CSV/Excel ou JSON com alunos, aulas e planos. Também é recomendável rotina de backup do PostgreSQL.

## Prioridade 2 — produtividade do instrutor

### 4. Agenda semanal
Além da visão por dia, criar uma grade de segunda a sábado/domingo com horários. Facilita identificar buracos na agenda.

### 5. Horários livres e encaixes
Botão **Encontrar horário livre** que procure automaticamente os próximos horários sem conflito para aluno, instrutor e veículo.

### 6. Reagendamento inteligente
Ao cancelar/faltar, oferecer 3 ou 5 opções de reposição já livres e permitir escolher com um clique.

### 7. WhatsApp
Gerar mensagem pronta com:
- nome do aluno;
- data;
- hora;
- local;
- instrutor;
- botão/link para confirmar.

Primeira etapa pode usar link `wa.me`; posteriormente pode integrar API oficial.

### 8. Lembretes
Criar lembrete de aula no dia anterior e algumas horas antes. Para automação real, usar serviço de mensagens e fila/agendador no servidor.

## Prioridade 3 — gestão

### 9. Histórico do aluno
Tela detalhada por aluno com:
- aulas realizadas;
- faltas;
- cancelamentos;
- reposições;
- próximas aulas;
- saldo.

### 10. Financeiro simples
Opcionalmente registrar pacote comprado, valor pago, saldo e vencimento, sem misturar com a lógica principal de agenda.

### 11. Relatórios
Indicadores por mês:
- aulas realizadas;
- faltas;
- cancelamentos;
- taxa de ocupação;
- alunos ativos;
- horários mais utilizados.

## Evolução sugerida

- **V1.5:** Configurações (instrutores, veículos e locais) + agenda semanal.
- **V1.6:** Reagendamento inteligente + horários livres.
- **V1.7:** WhatsApp com mensagem pronta e confirmação.
- **V2.0:** Login por usuário + permissões + backup/exportação.
