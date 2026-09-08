# Relatório de testes — AutoAgenda V2.0

## Verificações executadas no pacote
- `node --check server.js`: aprovado.
- `node --check public/app.js`: aprovado.
- `npm run check`: aprovado.
- Conferência de IDs do frontend: sem IDs duplicados e sem referências diretas ausentes.
- A rota de busca é GET/somente leitura; a criação continua pela rota normal de Nova Aula.
- A busca usa as mesmas validações de funcionamento, instrutor, veículo e conflitos já existentes no backend.
- Saldo do aluno é validado antes da busca.

## Teste que depende do Render/PostgreSQL real
Após o deploy, confirmar a busca com dados reais, inclusive folga de instrutor, manutenção de veículo, conflito existente e aluno sem saldo.
