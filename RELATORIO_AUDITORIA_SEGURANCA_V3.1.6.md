# RELATÓRIO DE AUDITORIA DE SEGURANÇA — AutoAgenda V3.1.6

## Resultado geral
A arquitetura de autorização já estava bem estruturada: as rotas privadas exigem sessão e o perfil INSTRUTOR é controlado por uma lista explícita de operações permitidas no backend. A auditoria encontrou pontos de endurecimento e uma exposição cadastral desnecessária na consulta individual de aluno, todos corrigidos nesta versão.

## Pontos aprovados
1. Autenticação individual em PostgreSQL.
2. Senhas com hash `scrypt` e salt.
3. Token de sessão aleatório; apenas seu hash é persistido.
4. Cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
5. Revogação de sessão no logout e em mudanças relevantes de usuário.
6. Middleware global exige autenticação para APIs e rotas de WhatsApp.
7. ADMIN e INSTRUTOR são separados no backend.
8. Instrutor é limitado às próprias aulas e aos alunos relacionados.
9. Rotas administrativas não aparecem na lista de operações permitidas ao Instrutor.
10. Consultas PostgreSQL usam parâmetros para valores vindos da requisição.
11. CSP, HSTS em produção, anti-frame e `nosniff` já estavam presentes.
12. Credenciais e hashes de senha não são enviados ao frontend.

## Correções da V3.1.6
- confiança controlada no proxy do Render para identificação do IP;
- proteção de tempo no login inexistente;
- limpeza defensiva do mapa de tentativas;
- política `no-store` nas respostas privadas;
- COOP/CORP;
- query parser simples;
- barreira central de perfil também nas rotas de WhatsApp;
- CPF completo condicionado ao perfil ADMIN.

## Itens que exigem teste no ambiente real
Os testes que dependem de PostgreSQL real, proxy do Render e duas contas reais (ADMIN e INSTRUTOR) ficam para a etapa de testes funcionais/Render. O código estático e as regras de autorização foram validados localmente.
