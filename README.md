# AutoAgenda V2.9.0

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
- confirmação da aula;
- lembretes de aula;
- Dashboard;
- relatórios por período;
- financeiro simples;
- backup/exportação em CSV, Excel e JSON;
- modo claro/escuro;
- preservação do histórico.

## V2.9.0 — Backup / Exportação

A ETAPA 15 adiciona a aba **💾 Backup**, voltada para cópia de segurança e exportação de dados.

É possível selecionar:
- todos os dados;
- alunos;
- instrutores;
- veículos;
- locais;
- aulas;
- planos;
- financeiro;
- configurações.

### Formatos

**CSV** — indicado para conferência simples e abertura em planilhas. Nas exportações individuais, cada coluna do cadastro vira uma coluna do CSV. No backup completo, os registros são consolidados com a identificação da entidade.

**Excel (.xlsx)** — nas exportações completas, cada conjunto de dados é criado em uma aba separada. A geração utiliza `exceljs`.

**JSON** — formato recomendado para o **backup completo**, pois preserva estrutura, nomes de campos, versão do AutoAgenda, data de geração e todos os registros necessários para uma futura rotina de restauração.

### Conteúdo adicional do backup completo

Além dos oito conjuntos principais do roteiro, o backup completo inclui:
- indisponibilidades de instrutores;
- indisponibilidades/manutenções de veículos.

Esses dados são necessários para que uma futura restauração reproduza corretamente as regras de disponibilidade.

## Segurança

As exportações leem somente tabelas do schema PostgreSQL `autoagenda`.

Nunca são exportados:
- `DATABASE_URL`;
- `AUTOAGENDA_USER`;
- `AUTOAGENDA_PASSWORD`;
- tokens;
- segredos;
- credenciais do Render.

Os arquivos exportados podem conter dados pessoais cadastrados no sistema, como CPF, telefone e e-mail. Devem ser armazenados em local seguro.

## Banco

A V2.9.0 não cria novas tabelas nem colunas. Não é necessário executar SQL manualmente.

A coleta do backup completo utiliza uma transação PostgreSQL somente leitura com snapshot consistente, reduzindo o risco de juntar dados de momentos diferentes durante a geração do arquivo.

## Dependências

- Node.js >= 20
- Express 4.21.2
- pg 8.13.1
- dotenv 16.4.7
- exceljs 4.4.0

## Próxima etapa

**ETAPA 16 — Login individual**, com usuários próprios, senha com hash seguro e sessões protegidas.
