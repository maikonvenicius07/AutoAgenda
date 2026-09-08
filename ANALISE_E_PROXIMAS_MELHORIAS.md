# Análise — AutoAgenda V3.1.0

A V3.1 foi construída sobre a V3.0 estável, preservando login individual e todas as funcionalidades existentes.

## Alteração principal

Aplicação efetiva dos níveis de acesso.

O perfil deixou de ser apenas informativo: o backend agora filtra dados e bloqueia operações conforme `ADMIN` ou `INSTRUTOR`.

## Arquitetura adotada

- `ADMIN`: acesso integral;
- `INSTRUTOR`: acesso operacional restrito;
- `autoagenda.usuarios.instrutor_id`: vínculo entre a conta de login e o cadastro de instrutor;
- autorização de backend por rota/operação;
- filtro adicional nas consultas de alunos e aulas;
- frontend adapta menus e ações ao perfil, sem substituir a validação do servidor.

## Riscos tratados

- acesso direto a rotas administrativas por URL;
- leitura da agenda de outro instrutor;
- leitura de aluno sem relação com o instrutor;
- edição completa de aula por instrutor;
- criação de aula avulsa por instrutor;
- reagendamento usando outro instrutor;
- exportação/financeiro/configurações acessíveis ao perfil errado;
- duas contas de Instrutor vinculadas ao mesmo cadastro operacional.

## Compatibilidade

A migração é automática e não apaga dados.
Usuários `INSTRUTOR` existentes na V3.0 podem estar sem vínculo e precisam ser editados pelo administrador uma única vez.

## Próximo passo

Auditoria técnica final da V3.1 antes de iniciar uma nova fase de funcionalidades.
