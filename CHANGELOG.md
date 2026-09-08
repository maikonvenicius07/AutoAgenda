# Changelog

## V40.4.0 — Jogar de Novo
- Ao terminar uma partida entre jogadores humanos, aparece **🔁 JOGAR DE NOVO**.
- Cada jogador confirma individualmente que deseja continuar.
- Quando todos os humanos conectados confirmam e há pelo menos 2 jogadores, uma nova partida de 5 rodadas começa automaticamente na mesma sala.
- O placar e o histórico de rodadas são zerados para a nova partida, sem exigir novos convites.
- A partida anterior continua sendo registrada separadamente no ranking, mesmo se a nova partida começar antes da gravação assíncrona terminar.

Este arquivo mantém somente os marcos relevantes do projeto. Os antigos arquivos separados `ATUALIZACAO_V*.txt` foram consolidados para evitar documentação repetida na raiz do repositório.

## 40.3.0 — Queima da primeira carta
- Corrige a abertura da rodada: a primeira carta normal virada pode ser queimada por qualquer jogador que tenha uma cópia exatamente igual, mesmo fora da vez.
- A primeira Queima válida assume a jogada e usa a continuação normal da Queima.
- A janela especial termina assim que ocorre a primeira ação normal da rodada.
- Bots e jogadores humanos seguem a mesma regra da abertura.

## 40.2.0 — Buscar Jogadores
- Matchmaking automático de 2 a 5 jogadores.
- Com 1 jogador a fila aguarda; ao entrar o 2º começa uma janela de 15 s.
- Com 5 jogadores a partida começa imediatamente.
- Cancelamento e remoção da fila validados no servidor.
- Aceitar convite remove o jogador da fila antes da troca de sala.

## 40.1.0 — Jogadores Online + Convites
- Presença online unificada pela identidade Google.
- Lista com avatar, nome e status.
- Convites de 30 s com aceitar/recusar.
- Reserva temporária de vaga sem interromper partida multiplayer em andamento.
- Integração com Reconexão Inteligente.

## 39.2.0 — SUA VEZ melhorado
- Aviso grande, destaque visual e iluminação das cartas válidas.
- Campainha curta e vibração opcional.
- Preferência de vibração salva no navegador.

## 39.1.0 — Reconexão Inteligente
- 60 s de tolerância para reconexão.
- Depois do prazo, AUTO temporário joga a mesma mão/posição do usuário.
- Ao retornar, o jogador humano retoma a vaga.
- A identidade do ranking permanece humana.

## 38.x — Consolidação da experiência online
- Login Google obrigatório e sessão HttpOnly.
- Conferência visual da pontuação ao fim da rodada.
- Música dinâmica original.
- Áudio Rápido de até 15 s.
- Regras e textos da interface consolidados.

## 37.x — Consolidação das regras e mobile
- Regras atuais de Queima, Ação Rápida e Carta Dupla consolidadas.
- Melhorias de leitura e layout em celulares.

## Marcos anteriores
- Ranking persistente em PostgreSQL.
- Chat e efeitos compartilhados.
- Mau-Mau falado e alertas de uma carta.
- Bots, avatares e melhorias sucessivas do motor de jogo.
