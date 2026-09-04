# RELATÓRIO DE TESTES — AutoAgenda V3.0.0

## Escopo

ETAPA 16 — Login individual.

## Resultado dos testes estáticos

**Aprovado.**

Foram validados:
- sintaxe do backend;
- sintaxe do frontend;
- referências de elementos HTML;
- duplicidade de IDs;
- duplicidade de rotas;
- remoção da autenticação HTTP Basic;
- presença das novas rotas de login, logout e usuários;
- configuração segura do cookie;
- uso de hash `scrypt`;
- exclusão das tabelas de autenticação da rotina de Backup/Exportação.

## Teste criptográfico isolado

A rotina `scrypt` foi exercitada com:
- senha correta: validação `true`;
- senha incorreta: validação `false`.

## Banco de dados

A V3.0 cria automaticamente:
- `autoagenda.usuarios`;
- `autoagenda.sessoes`;
- índices únicos de login/e-mail;
- índices de sessão.

O primeiro administrador é criado usando as variáveis já existentes
`AUTOAGENDA_USER` e `AUTOAGENDA_PASSWORD` somente se a tabela de usuários estiver vazia.

## Limitações do ambiente de teste

Não há conexão com o PostgreSQL real do Render neste ambiente.
Por isso, login real, persistência de sessão e migração sobre os dados de produção
devem ser confirmados no Render pelo checklist V3.0.

## Conclusão

A versão está tecnicamente pronta para deploy e teste de produção controlado.
Depois de validada, o próximo passo é a ETAPA 17 — Níveis de acesso.
