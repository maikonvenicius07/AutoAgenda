# AutoAgenda V3.1.3 — Checklist do .gitignore

## Etapa executada

**Prompt 2 — Criar e validar o `.gitignore`**

## Verificações realizadas

- [x] Criado `.gitignore` compatível com Node.js, Express, PostgreSQL e Render.
- [x] `node_modules/` bloqueado.
- [x] `.env` e variantes locais bloqueados.
- [x] Exceção `!.env.example` mantida para futura documentação sem credenciais.
- [x] Logs, caches e arquivos temporários bloqueados.
- [x] Arquivos de IDE/editor e sistema operacional bloqueados.
- [x] Bancos locais e pacotes/backsups gerados localmente bloqueados.
- [x] Chaves/certificados locais (`*.pem`, `*.key`, `*.p12`, `*.pfx`) bloqueados.
- [x] Confirmado que arquivos necessários ao Render não são ignorados.
- [x] Confirmado que não há `.env`, chave privada, banco local ou credencial real dentro do projeto analisado.
- [x] `render.yaml` contém somente nomes de variáveis e `sync: false`, sem valores privados.
- [x] Nenhuma funcionalidade do AutoAgenda foi alterada nesta etapa.

## Arquivos necessários que continuam versionáveis

- `server.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `public/assets/`
- `sql/schema.sql`
- `package.json`
- `render.yaml`
- `README.md`
- documentação do projeto

## Resultado

O repositório fica protegido contra envio acidental de arquivos locais, dependências, credenciais e artefatos gerados, sem prejudicar o deploy no Render.
