# CHECKLIST — AutoAgenda V3.1.4

## Etapa
Prompt 3 — `package-lock.json` e dependências.

## Dependências diretas
- [x] `dotenv` mantido em `16.4.7`.
- [x] `express` mantido em `4.21.2`.
- [x] `pg` mantido em `8.13.1`.
- [x] Nenhuma biblioteca foi atualizada por conveniência.
- [x] As três dependências externas são efetivamente utilizadas pelo `server.js`.
- [x] Módulos nativos (`crypto`, `path`, `zlib`) não foram adicionados ao `package.json`.

## Lockfile
- [x] `package-lock.json` adicionado.
- [x] Versão do projeto alinhada em `package.json` e lockfile.
- [x] Árvore declarada no lockfile validada quanto a referências internas e versões.
- [x] `package-lock.json` não é bloqueado pelo `.gitignore`.

## Testes locais
- [x] `npm run check`.
- [x] `node --check server.js`.
- [x] `node --check public/app.js`.
- [x] JSON de `package.json` e `package-lock.json` válido.
- [x] `npm install --package-lock-only --offline` aceitou o lockfile (`up to date`).
- [x] `npm ls --package-lock-only --all` validou a árvore declarada com código de saída 0.
- [ ] `npm install` com download real: indisponível no ambiente de preparação por falha de resolução/acesso a `registry.npmjs.org`.

## Validação após subir no GitHub
- [ ] Confirmar que o Render conclui o `npm install`.
- [ ] Confirmar que o deploy fica verde.
- [ ] Abrir `/api/health` e confirmar AutoAgenda V3.1.4 com banco conectado.
- [ ] Fazer login e abrir as telas principais.

## Resultado
A etapa não alterou funcionalidades. A única pendência que depende de rede externa é confirmar o download/instalação real das dependências durante o deploy do Render.
