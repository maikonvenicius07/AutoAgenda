# CHECKLIST V3.1 — Níveis de acesso

## Deploy
- [ ] Substituir os arquivos da V3.1 no GitHub.
- [ ] Fazer Commit.
- [ ] Aguardar o Render ficar Live.
- [ ] Pressionar Ctrl+F5.
- [ ] Confirmar no topo **AutoAgenda V3.1.0**.

## Administrador
- [ ] Login do administrador funciona.
- [ ] Todos os módulos continuam visíveis.
- [ ] Aba Usuários abre normalmente.
- [ ] Novo usuário Instrutor exige selecionar o instrutor vinculado.
- [ ] É possível editar um usuário Instrutor e trocar/corrigir o vínculo.
- [ ] Não é possível vincular duas contas Instrutor ao mesmo cadastro.

## Instrutor
Crie ou edite uma conta de teste com perfil Instrutor e vincule-a a um instrutor.

- [ ] Login funciona.
- [ ] Perfil exibido mostra o nome do instrutor vinculado.
- [ ] Somente Alunos, Agenda diária e Agenda semanal ficam visíveis.
- [ ] Não aparece botão de Nova aula.
- [ ] Não aparece botão de Novo aluno.
- [ ] Somente aulas do instrutor aparecem.
- [ ] Somente alunos relacionados às aulas dele aparecem.
- [ ] Histórico do aluno mostra somente aulas/planos daquele instrutor.
- [ ] Botão de aula aparece como **Status**.
- [ ] Campos de aluno/instrutor/veículo/local/data/hora ficam somente leitura ao atualizar status.
- [ ] É possível marcar Realizada, Cancelada ou Faltou conforme as regras existentes.
- [ ] É possível alterar confirmação em aula agendada.
- [ ] Após cancelar, é possível procurar uma reposição.
- [ ] A reposição continua vinculada ao mesmo instrutor autenticado.
- [ ] WhatsApp abre somente para aula própria.

## Bloqueios
- [ ] Instrutor não acessa Configurações.
- [ ] Instrutor não acessa Planos.
- [ ] Instrutor não acessa Lembretes administrativos.
- [ ] Instrutor não acessa Relatórios.
- [ ] Instrutor não acessa Financeiro.
- [ ] Instrutor não acessa Backup.
- [ ] Instrutor não acessa Usuários.
- [ ] URL/API administrativa digitada manualmente retorna 403.

## Segurança
- [ ] Usuário Instrutor sem vínculo recebe bloqueio seguro.
- [ ] Logout encerra a sessão.
- [ ] Usuário inativo não mantém acesso.
