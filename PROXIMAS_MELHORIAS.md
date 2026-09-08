# Próximas melhorias — AutoAgenda

## Situação atual

Versão: **V3.1.0 — Níveis de acesso**

Etapas concluídas:
1. Configurações;
2. Agenda semanal;
3. Horário de funcionamento;
4. Disponibilidade dos instrutores;
5. Disponibilidade dos veículos;
6. Encontrar horário livre;
7. Reagendamento inteligente;
8. Histórico do aluno;
9. WhatsApp;
10. Confirmação da aula;
11. Lembretes;
12. Dashboard;
13. Relatórios;
14. Financeiro simples;
15. Backup / Exportação;
16. Login individual;
17. Níveis de acesso.

## Roteiro principal concluído

A V3.1 fecha a sequência planejada inicialmente para o AutoAgenda.

### Administrador
Acesso integral ao sistema.

### Instrutor
Acesso restrito à própria agenda, aos alunos relacionados às suas aulas,
à alteração de status/confirmação e ao reagendamento autorizado.

As permissões são aplicadas também no backend, evitando que um instrutor
acesse módulos administrativos apenas digitando uma rota manualmente.

## Próximo passo recomendado

Antes de iniciar novas funcionalidades:

**Auditoria técnica final da V3.1**
- permissões e tentativas de acesso indevido;
- integridade das consultas SQL;
- conflitos de agenda;
- segurança das sessões;
- código duplicado/morto;
- tratamento de erros;
- desempenho;
- compatibilidade Render/PostgreSQL;
- revisão do Backup/Exportação.

Depois da auditoria, podemos definir a próxima fase do AutoAgenda.
