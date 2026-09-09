# Relatório — AutoAgenda V3.8.7

## Solicitação
Permitir cancelar uma aula diretamente no quadro **Agenda de hoje** do Painel.

## Implementação
Foi incluído o botão **❌ Cancelar** ao lado das ações da aula. O botão pede confirmação e chama a rota de status já existente, enviando `CANCELADA`. Após sucesso, a agenda é recarregada, o horário fica livre e a aula permanece no histórico. Em seguida, o AutoAgenda oferece a busca de um horário de reposição.

## Segurança e regras
O atalho não cria uma rota nova nem contorna permissões: utiliza a mesma rota protegida de atualização de status. Para perfil Instrutor, o backend mantém o vínculo obrigatório com a própria aula.

## Testes
Executar `npm run check` e `npm run test:static` antes do deploy. A validação final deve ser feita no Render com PostgreSQL real.
