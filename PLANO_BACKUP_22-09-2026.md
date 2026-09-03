# Plano de backup — até 22/09/2026

Decisão atual: manter o AutoAgenda no ambiente gratuito até **22/09/2026**.

## Até 21/09

- confirmar que a V1.8.1 está estável;
- conferir alunos, aulas, planos, instrutores, veículos, locais e configurações;
- evitar alterações de infraestrutura desnecessárias.

## Em 22/09

Antes de qualquer migração/upgrade:

1. exportar um backup completo do PostgreSQL;
2. conferir o tamanho e a data do arquivo de backup;
3. manter uma cópia fora do banco atual;
4. somente depois iniciar migração ou upgrade;
5. validar no destino a quantidade de registros das tabelas principais;
6. testar login, alunos, agenda diária, agenda semanal e planos antes de considerar a migração concluída.

## Tabelas principais a conferir

- `autoagenda.alunos`
- `autoagenda.aulas`
- `autoagenda.planos_aula`
- `autoagenda.instrutores`
- `autoagenda.instrutor_indisponibilidades`
- `autoagenda.veiculos`
- `autoagenda.locais`
- tabelas/configurações de funcionamento existentes na versão implantada

Nunca salvar `DATABASE_URL`, senhas ou outras credenciais dentro dos arquivos de backup/documentação enviados ao GitHub.
