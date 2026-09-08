# Próximas melhorias — AutoAgenda

## Situação atual

Versão: **V3.4.0 — E-mails automáticos**

O roteiro principal de 17 etapas foi concluído e a fase de estabilização também foi concluída.

Melhorias posteriores já entregues:
1. limpeza e organização do projeto;
2. `.gitignore`;
3. `package-lock.json`;
4. alinhamento do `schema.sql`;
5. auditoria de segurança e permissões;
6. testes estáticos ampliados;
7. confirmação da aula pelo próprio aluno;
8. lembretes automáticos preparados para WhatsApp Cloud API;
9. envio automático de e-mails preparado.

## Próximo passo do roteiro

**PROMPT 10 — Restauração de backup**

Objetivo:
- restaurar preferencialmente backup JSON completo;
- acesso exclusivo do ADMIN;
- validar formato, estrutura e versão;
- mostrar resumo antes da restauração;
- confirmar explicitamente a operação;
- restaurar dentro de transação PostgreSQL;
- rejeitar arquivo inválido/incompleto;
- preservar as exportações CSV, Excel e JSON atuais.

## Melhorias futuras já registradas

- backup automático do PostgreSQL;
- mensagem automática de Feliz Aniversário usando a data de nascimento do aluno;
- Webhooks para acompanhar entrega/leitura do WhatsApp;
- outras integrações que venham a ser priorizadas.
