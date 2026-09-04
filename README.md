# AutoAgenda V2.0 — Encontrar Horário Livre

Evolução da V1.9 com busca inteligente dos próximos horários disponíveis.

## Novidade principal
- Botão **🔎 Encontrar horário livre** no cabeçalho, Agenda e cartão do aluno.
- Busca os 5 próximos horários considerando aluno, instrutor, veículo, horário de funcionamento, disponibilidade individual do instrutor, folgas, manutenção/indisponibilidade do veículo, duração, intervalo e aulas existentes.
- Ao escolher um resultado, abre **Nova aula** já preenchida para confirmação.
- Busca é somente leitura: a aula só é criada após o usuário confirmar no formulário normal.

## Segurança
Mantém a autenticação básica obrigatória em produção com `AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD`. Nunca grave credenciais no GitHub.

## Atualização
Substitua os arquivos da versão anterior, faça commit e aguarde o Render. Não é necessária alteração manual do PostgreSQL nesta etapa.
