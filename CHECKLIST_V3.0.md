# CHECKLIST V3.0 — Login individual

## Testes automáticos executados

- [x] `node --check server.js`
- [x] `node --check public/app.js`
- [x] `npm run check`
- [x] 306 IDs HTML encontrados
- [x] 306 IDs HTML únicos
- [x] 0 IDs duplicados
- [x] 0 referências diretas de IDs ausentes no JavaScript
- [x] 70 rotas Express identificadas
- [x] 0 rotas Express duplicadas
- [x] autenticação HTTP Basic removida
- [x] hash de senha com `scrypt`
- [x] cookie de sessão `HttpOnly`
- [x] cookie `SameSite=Lax`
- [x] cookie `Secure` em produção
- [x] usuários e sessões excluídos do Backup/Exportação
- [x] teste isolado de hash: senha correta validou e senha incorreta foi rejeitada

## Teste no Render após o deploy

1. Acessar o AutoAgenda e confirmar que aparece a nova tela **Login individual**.
2. Entrar com o mesmo usuário e senha que eram usados na proteção anterior.
3. Confirmar no topo: **AutoAgenda V3.0.0 · login individual ativo**.
4. Abrir **👥 Usuários**.
5. Confirmar a conta **Administrador AutoAgenda**.
6. Criar um usuário de teste.
7. Sair.
8. Entrar com o usuário de teste.
9. Sair novamente e entrar com o administrador.
10. Alterar a senha do usuário de teste.
11. Confirmar que a senha antiga deixa de funcionar.
12. Desativar o usuário de teste e confirmar que ele não consegue entrar.
13. Reativar e confirmar novo acesso.
14. Testar Agenda, WhatsApp, Relatórios, Financeiro e Backup.

## Observação

A V3.0 registra o perfil `ADMIN`/`INSTRUTOR`, mas a limitação detalhada de módulos
do perfil Instrutor será implementada na ETAPA 17.
