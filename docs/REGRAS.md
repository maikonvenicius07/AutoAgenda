# Regras consolidadas do Mau-Mau Candeias

Este arquivo reúne as regras efetivamente utilizadas pelo aplicativo.

## 1. Objetivo
- A partida possui 5 rodadas.
- Cada rodada termina quando um jogador fica sem cartas, depois que os efeitos da última carta forem resolvidos.
- O vencedor da rodada recebe 0 ponto.
- Os demais recebem os pontos das cartas restantes na mão.
- Após 5 rodadas, vence quem tiver a menor pontuação acumulada.
- Empate na menor pontuação gera vitória compartilhada.

## 2. Preparação
- 2 baralhos tradicionais completos, sem coringas: 104 cartas.
- 2 a 5 jogadores, humanos ou máquinas.
- 6 cartas para cada jogador.
- Uma carta normal inicia o descarte. Se a carta sorteada para iniciar for especial, ela volta ao monte e outra é escolhida.
- O sentido inicial é anti-horário.

## 3. Jogada normal e compra
Na própria vez, o jogador pode jogar uma carta do mesmo valor ou do mesmo naipe da carta do topo. O Valete (J) funciona como coringa de naipe, exceto durante uma cadeia ativa de 7.

O jogador pode comprar 1 carta mesmo tendo uma jogada válida. Depois da compra, pode:
1. jogar a carta comprada, se for válida;
2. jogar qualquer outra carta válida que já estivesse na mão; ou
3. passar a vez e guardar a carta comprada.

Na jogada normal, não é permitido comprar uma segunda carta na mesma vez. Para passar a vez, o jogador deve primeiro ter comprado 1 carta. A cadeia de 7 possui tratamento próprio e não pode ser evitada simplesmente passando.

## 4. Mau-Mau
Antes de uma jogada que deixe o jogador com apenas 1 carta, deve ser anunciado **Mau-Mau**. O esquecimento gera +2 cartas de penalidade.

Quando uma jogada composta puder eliminar as duas últimas cartas por Queima + continuação ou por Carta Dupla, deve ser anunciado **Mau-Mau batendo/queimando** antes de iniciar a jogada.

## 5. Cartas especiais
- **A — Ás:** pula o próximo jogador.
- **7:** o próximo jogador recebe +2. Outro 7 pode rebater e acumula +2 por carta.
- **8:** o jogador anterior, considerando o sentido atual, compra 2 cartas.
- **J — Valete:** coringa de naipe. O jogador escolhe o naipe a ser seguido. Não interrompe cadeia ativa de 7. Se for a carta da batida, dobra os pontos dos adversários na rodada.
- **Q — Dama:** inverte o sentido. Com apenas 2 jogadores ativos, quem joga a Dama joga novamente.
- **K — Rei:** o jogador anterior, considerando o sentido atual, compra 1 carta.

Cartas especiais não podem iniciar Queima, nem ser usadas em Ação Rápida ou Carta Dupla. Elas podem ser usadas como continuação válida de uma Queima e, nesse caso, o efeito é aplicado normalmente.

## 6. Queima — própria vez + exceção da abertura
Na regra normal, a Queima com direito a continuação acontece na própria vez do jogador.

**Exceção da abertura:** assim que a primeira carta normal da rodada é virada, qualquer jogador que tenha uma carta normal exatamente igual — mesmo valor e mesmo naipe — pode queimá-la, ainda que não seja sua vez. A primeira Queima válida assume a jogada e encerra essa janela de abertura.

Depois da primeira ação normal, volta a valer a regra comum: a Queima com continuação fica restrita à própria vez, e a intervenção fora da vez é feita pela Ação Rápida.

Depois da Queima:
- pode jogar uma segunda carta válida ou passar a vez;
- a segunda carta pode ser especial e seu efeito vale normalmente;
- se não houver continuação válida, deve comprar 1 carta;
- depois dessa compra, pode jogar qualquer carta válida da mão ou passar e guardar a carta comprada.

A, 7, 8, J, Q e K não podem iniciar Queima.

## 7. Ação Rápida — fora da vez
Logo após uma carta normal ser jogada, um jogador que não seja quem acabou de jogar nem o próximo da vez pode descartar uma carta normal exatamente igual à recém-jogada.

A Ação Rápida:
- descarta somente uma carta;
- não transfere a vez;
- não permite segunda carta;
- não altera o sentido;
- só aceita cartas normais;
- não aceita A, 7, 8, J, Q ou K;
- fica suspensa durante cadeia de 7 e durante continuação de Queima;
- encerra a oportunidade assim que a primeira Ação Rápida válida for aceita.

Depois dela, continua jogando quem já seria o próximo.

## 8. Carta Dupla
Na própria vez, duas cartas exatamente iguais — mesmo valor e mesmo naipe — podem ser descartadas juntas se a jogada for válida.

Carta Dupla vale somente para:
- 2, 3, 4, 5, 6, 9 e 10.

Não vale para:
- A, 7, 8, J, Q ou K.

## 9. Batida com carta especial
O efeito da carta especial permanece válido quando ela é usada como última carta.

- Batida com **8:** o jogador anterior compra 2 antes da pontuação.
- Batida com **K:** o jogador anterior compra 1 antes da pontuação.
- Batida com **J:** os pontos dos adversários são dobrados.
- Batida com **7:** a cadeia de 7 continua até ser resolvida.
- Batida com **A** ou **Q:** o efeito é registrado antes do encerramento da rodada.

### Cadeia final de 7
Se alguém bater com 7, os jogadores seguintes ainda podem rebater com outro 7. Quem não tiver 7 compra o total acumulado e então a rodada termina. Se todos os demais jogadores rebaterem e a cadeia completar uma volta até o vencedor original, ninguém compra.

## 10. Pontuação
- A = 1
- 2 a 10 = valor nominal
- J = 11
- Q = 12
- K = 13

O vencedor da rodada recebe 0 ponto. Se a última carta do vencedor for um Valete, os pontos dos demais jogadores são dobrados.

## 11. Conferência da Rodada
Após todos os efeitos finais serem resolvidos, o aplicativo revela:
- as cartas restantes de cada jogador;
- o valor individual de cada carta;
- a soma-base da mão;
- eventual multiplicador do Valete;
- a pontuação da rodada;
- o placar acumulado.

As mãos permanecem ocultas durante a rodada e a conferência anterior é apagada quando a rodada seguinte começa.

## 12. Entrada de jogadores e máquinas
- Ninguém entra durante uma rodada.
- Novos jogadores podem entrar nos intervalos até antes do início da 3ª rodada.
- Quem entra depois do começo da partida recebe como pontuação inicial o maior total já acumulado pelos jogadores da mesa.
- Máquinas seguem as mesmas regras dos jogadores humanos.

## 13. Ranking
Partidas concluídas alimentam os rankings de Hoje, Mês, Ano e Geral. Partidas apenas entre pessoas ficam separadas das partidas com máquina.

A classificação considera:
1. maior número de vitórias;
2. em caso de empate, menor média de pontos.

A identidade do ranking é vinculada à Conta Google autenticada; alterar o nome na mesa ou o avatar não cria outro jogador no ranking.

## 14. Recursos da mesa
- Chat em tempo real.
- Áudio Rápido de até 15 segundos; os áudios são efêmeros, repassados à sala e não ficam no histórico do chat, PostgreSQL ou ranking.
- Música original com controle separado de ligar/desligar e volume.
- Organização da mão por número ou naipe, sem alterar as regras.
- Jogadores Online: mostra quem está conectado, o status atual e permite enviar convites.
- Buscar Jogadores: fila automática para partidas de 2 a 5 pessoas. O cronômetro de 15 segundos começa quando o 2º jogador é encontrado; com 5, a partida inicia imediatamente; com 2, 3 ou 4, inicia ao fim da contagem.
- Cancelar Busca remove imediatamente o jogador da fila. Aceitar um convite enquanto procura também encerra a busca antes de seguir o convite.
- Jogar de Novo: ao concluir uma partida entre pessoas, cada jogador conectado pode confirmar que deseja continuar. Quando todos os humanos conectados confirmam e há pelo menos 2 participantes, uma nova partida de 5 rodadas começa automaticamente na mesma sala, com placar zerado.

## 15. Regras técnicas
- Se o monte acabar, o descarte é reembaralhado preservando a carta do topo.
- Reconexão Inteligente: uma queda durante a rodada pausa a mesa por até 60 segundos; nos intervalos da partida, a cadeira também fica reservada pelo mesmo prazo. Se o jogador não voltar, a Máquina assume temporariamente a mesma mão, posição e pontuação. Ao reconectar, o jogador retoma automaticamente seu lugar.
- O acesso ao jogo exige autenticação por Conta Google.
