# AutoAgenda V1.9 — Disponibilidade dos Veículos

Versão baseada na V1.8.1.

## Novidades
- Situação do veículo: **Disponível, Manutenção, Indisponível e Inativo**.
- Períodos específicos de manutenção/indisponibilidade.
- Veículos não disponíveis deixam de aparecer em novas aulas e planos.
- O backend bloqueia uso direto de veículo indisponível.
- Plano automático valida cada ocorrência contra bloqueios do veículo.
- Edição, reagendamento e alteração de status respeitam a disponibilidade.
- Sugestão de horário considera instrutor e veículo.
- Aulas existentes não são apagadas ou remarcadas automaticamente.
- Ao cadastrar bloqueio, o sistema informa aulas futuras já existentes no período.

## Banco
Migração automática:
- `autoagenda.veiculos.situacao`
- `autoagenda.veiculo_indisponibilidades`

Não execute `schema.sql` manualmente no deploy normal.

## Variáveis do Render
Mantenha `DATABASE_URL`, `NODE_ENV`, `APP_TIMEZONE`, `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD`.

**Versão 1.9.0**
