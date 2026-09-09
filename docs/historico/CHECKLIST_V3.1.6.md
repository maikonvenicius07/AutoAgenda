# CHECKLIST — AutoAgenda V3.1.6

## Etapa concluída
PROMPT 5 — Auditoria completa de segurança e permissões.

## Problemas encontrados / risco / correção / status

| Problema encontrado | Risco | Correção realizada | Status |
|---|---|---|---|
| Bloqueio de login lia `X-Forwarded-For` diretamente | Um cabeçalho manipulável poderia prejudicar a identificação da origem das tentativas | Render/produção passa a usar `trust proxy` de 1 salto e `req.ip` | ✅ Corrigido |
| Login inexistente não executava `scrypt` | Diferença de tempo poderia ajudar na enumeração de logins válidos | Adicionado hash fictício para manter custo de verificação semelhante | ✅ Corrigido |
| Mapa de tentativas de login sem limpeza defensiva por volume | Crescimento desnecessário de memória em cenário abusivo | Adicionada limpeza de entradas antigas quando o mapa cresce | ✅ Corrigido |
| Respostas privadas não tinham política global de não-cache | Navegador/proxy poderia manter resposta sensível | `Cache-Control: no-store` em `/api/` e `/whatsapp/` | ✅ Corrigido |
| Rotas `/whatsapp/` não passavam pela barreira central de perfil | A proteção dependia apenas das verificações individuais das rotas | Barreira ADMIN/INSTRUTOR ampliada também para `/whatsapp/` | ✅ Corrigido |
| Consulta de aluno específico podia retornar CPF completo para Instrutor vinculado | Exposição cadastral além do necessário ao perfil operacional | CPF completo somente para ADMIN; Instrutor recebe apenas CPF mascarado | ✅ Corrigido |
| Parser de query aceitava estrutura estendida por padrão | Superfície de entrada maior que a necessária | Definido `query parser` como `simple` | ✅ Reforçado |
| Isolamento entre janelas/origens podia ser endurecido | Proteção do navegador podia ser mais restritiva | Adicionados COOP e CORP | ✅ Reforçado |

## Permissões confirmadas no backend
- [x] ADMIN mantém acesso integral aos módulos administrativos.
- [x] INSTRUTOR só alcança a lista explícita de rotas operacionais permitidas.
- [x] INSTRUTOR fica limitado às próprias aulas nos endpoints de agenda.
- [x] INSTRUTOR só visualiza alunos relacionados às próprias aulas.
- [x] Histórico do aluno é filtrado pelo instrutor da sessão.
- [x] Alteração de status e confirmação exige que a aula pertença ao instrutor.
- [x] Reposição exige que a aula original pertença ao instrutor e força o instrutor da sessão.
- [x] WhatsApp da aula é limitado às próprias aulas.
- [x] WhatsApp do plano completo permanece restrito ao ADMIN.
- [x] Rotas de usuários, configurações administrativas, planos, relatórios, financeiro e backup continuam bloqueadas para INSTRUTOR.

## Autenticação / sessão confirmadas
- [x] Senhas armazenadas com `scrypt` + salt.
- [x] Cookie de sessão `HttpOnly`.
- [x] `SameSite=Lax`.
- [x] `Secure` em produção.
- [x] Sessões guardam somente hash SHA-256 do token.
- [x] Logout revoga a sessão no PostgreSQL.
- [x] Desativação/alteração sensível de usuário revoga sessões quando aplicável.
- [x] Limitação de tentativas repetidas de login.
- [x] Mensagem de login inválido não revela se o usuário existe.

## Banco / entrada de dados
- [x] Consultas que recebem dados do usuário usam parâmetros do PostgreSQL.
- [x] SQL dinâmico de nomes de tabela/coluna usa apenas valores de mapas internos fixos.
- [x] Corpo JSON limitado a 1 MB.
- [x] Não foi encontrado segredo, token ou `DATABASE_URL` no frontend.
- [x] Hashes de senha não são retornados pelas APIs de usuários.

## Validações locais
- [x] `node --check server.js`.
- [x] `node --check public/app.js`.
- [x] `npm run check`.
- [x] `npm ls --package-lock-only --all`.
- [x] Conferência estática das rotas permitidas ao perfil INSTRUTOR.
- [x] Conferência de que `/whatsapp/plano/:id` não está na lista de rotas do INSTRUTOR.
- [x] Conferência de que o CPF completo é condicionado ao perfil ADMIN.

## Validação recomendada no Render
- [ ] Login ADMIN.
- [ ] Login INSTRUTOR.
- [ ] Confirmar que INSTRUTOR recebe 403 ao tentar acessar módulos administrativos diretamente pela API.
- [ ] Confirmar agenda e histórico apenas do instrutor vinculado.
- [ ] Confirmar WhatsApp da própria aula e bloqueio do plano completo.
- [ ] Confirmar deploy sem erro e `/api/health` com V3.1.6.

## Observação sobre dependências
Esta etapa não atualiza bibliotecas. A atualização de dependências deve ser feita separadamente, com instalação online, auditoria do npm e teste de regressão completo, para não misturar mudanças de pacotes com as correções de permissão e autenticação.
