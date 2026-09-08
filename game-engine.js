'use strict';

const crypto = require('crypto');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SPECIAL_RANKS = new Set(['A','7','8','J','Q','K']);
const DEFAULT_RULES = {
  rounds: 5,
  cardsPerPlayer: 6,
  mauMauPenalty: 2,
  safeStarter: true,
  allowLateJoinUntilRound: 3,
  burnEnabled: true,
  quickActionEnabled: true,
  doubleCardEnabled: true,
};

function id(prefix='id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function createDeck() {
  const deck = [];
  for (let copy = 1; copy <= 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: id('c'), suit, rank, copy });
      }
    }
  }
  return deck;
}

function shuffle(arr, rng=Math.random) {
  const a = arr.slice();
  for (let i=a.length-1; i>0; i--) {
    const j = Math.floor(rng()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardPoints(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return Number(card.rank);
}

function isSpecial(card) {
  return SPECIAL_RANKS.has(card.rank);
}

function sameCard(a,b) {
  return !!a && !!b && a.rank === b.rank && a.suit === b.suit;
}

function nextIndex(room, idx, steps=1, skipFinished=true) {
  const n = room.players.length;
  if (!n) return -1;
  let cursor = idx;
  let moved = 0;
  let guard = 0;
  while (moved < steps && guard < n*5) {
    cursor = (cursor + room.direction + n) % n;
    guard++;
    const p = room.players[cursor];
    if (!skipFinished || !p.finishedRound) moved++;
  }
  return cursor;
}

function previousIndex(room, idx) {
  const n = room.players.length;
  let cursor = (idx - room.direction + n) % n;
  let guard = 0;
  while (room.players[cursor]?.finishedRound && guard < n) {
    cursor = (cursor - room.direction + n) % n;
    guard++;
  }
  return cursor;
}

function activePlayers(room) {
  return room.players.filter(p => !p.finishedRound);
}

// V39.1 — uma vaga humana em AUTO continua válida para o motor da partida,
// embora o navegador do dono esteja desconectado.
function playerAvailable(player) {
  return !!(player && (player.connected || player.isBot || player.autoControlled));
}
function roomPausedForReconnect(room) {
  return !!(room && room.status === 'playing' && room.players.some(p => !p.isBot && !p.connected && !p.autoControlled));
}

function log(room, message, kind='info', meta=null) {
  const entry={ id:id('log'), ts:Date.now(), message, kind };
  if (meta && typeof meta==='object') Object.assign(entry, meta);
  room.log.push(entry);
  if (room.log.length > 80) room.log.splice(0, room.log.length-80);
}

function makePlayer({socketId, token, name, avatar, playerKey=null, isBot=false}) {
  return {
    id: id('p'),
    socketId: socketId || null,
    token: token || id('t'),
    name: String(name || 'Jogador').slice(0,24),
    avatar: avatar || '🂡',
    playerKey: isBot ? null : (String(playerKey || '').trim().slice(0,80) || null),
    hand: [],
    score: 0,
    roundScore: 0,
    roundHistory: [],
    connected: true,
    // V39.1 — jogador humano pode ser controlado temporariamente pela máquina
    // após exceder a janela de reconexão. A identidade continua humana para ranking.
    autoControlled: false,
    disconnectedAt: null,
    reconnectDeadlineAt: null,
    isBot,
    host: false,
    finishedRound: false,
    declaration: null,
  };
}

function createRoom(code, hostInfo) {
  const host = makePlayer(hostInfo);
  host.host = true;
  return {
    code,
    status: 'lobby', // lobby, playing, between-rounds, finished
    round: 0,
    rules: {...DEFAULT_RULES},
    players: [host],
    deck: [],
    discard: [],
    direction: -1, // anti-horário
    currentPlayer: 0,
    requestedSuit: null,
    pendingSeven: 0,
    winnerId: null,
    lastWinnerCard: null,
    continuationPlayerId: null,
    lastPlayedById: null,
    burnTopCardId: null,
    reactionTopCardId: null,
    reactionSourcePlayerId: null,
    reactionNextPlayerId: null,
    // Exceção da abertura: a primeira carta virada pode ser queimada por qualquer
    // jogador que possua uma carta normal exatamente igual, mesmo fora da vez.
    openingReaction: false,
    finishPendingSeven: false,
    lastPass: null,
    roundRoles: null,
    // V38: resumo detalhado da ultima rodada. So e exposto aos clientes
    // quando a rodada ja terminou, nunca durante o jogo.
    roundReview: null,
    log: [],
    createdAt: Date.now(),
    finishedAt: null,
    rankingRecorded: false,
    rankingRecording: false,
    // V40.4 — cada nova partida disputada na mesma sala recebe um serial próprio.
    // Isso permite registrar o ranking da partida anterior mesmo se o grupo já iniciou outra.
    matchSerial: 1,
    replayReadyPlayerIds: [],
  };
}

function addPlayer(room, info) {
  if (room.players.length >= 5) throw new Error('A sala já possui 5 jogadores.');
  if (room.status === 'playing') throw new Error('Não é permitido entrar durante uma rodada.');
  if (room.status === 'finished') throw new Error('A partida já terminou.');
  if (room.round >= room.rules.allowLateJoinUntilRound && room.status === 'between-rounds') {
    throw new Error('Novos jogadores só podem entrar até o início da 3ª rodada.');
  }
  const p = makePlayer(info);
  if (room.round > 0) {
    p.score = Math.max(0, ...room.players.map(x => x.score));
    p.roundHistory = Array(room.round).fill(null);
    log(room, `${p.name} entrou na partida com ${p.score} ponto(s), igual à maior pontuação acumulada das rodadas anteriores.`, 'system');
  }
  room.players.push(p);
  return p;
}

function reconnectPlayer(room, token, socketId) {
  const p = room.players.find(x => x.token === token);
  if (!p) return null;
  p.socketId = socketId;
  p.connected = true;
  p.autoControlled = false;
  p.disconnectedAt = null;
  p.reconnectDeadlineAt = null;
  return p;
}

function resetMatch(room) {
  if (!room || room.status !== 'finished') throw new Error('A partida atual ainda não terminou.');

  room.matchSerial = Number(room.matchSerial || 1) + 1;
  room.status = 'lobby';
  room.round = 0;
  room.deck = [];
  room.discard = [];
  room.direction = -1;
  room.currentPlayer = -1;
  room.requestedSuit = null;
  room.pendingSeven = 0;
  room.winnerId = null;
  room.lastWinnerCard = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.reactionTopCardId = null;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = null;
  room.openingReaction = false;
  room.finishPendingSeven = false;
  room.lastPass = null;
  room.roundRoles = null;
  room.roundReview = null;
  room.finishedAt = null;
  room.rankingRecorded = false;
  room.rankingRecording = false;
  room.replayReadyPlayerIds = [];
  room.log = [];

  room.players.forEach(p => {
    p.hand = [];
    p.score = 0;
    p.roundScore = 0;
    p.roundHistory = [];
    p.finishedRound = false;
    p.declaration = null;
    p.justDrawnCardId = null;
    p.autoControlled = false;
    p.disconnectedAt = null;
    p.reconnectDeadlineAt = null;
  });

  log(room, '🔁 Nova partida iniciada na mesma sala. Placar zerado.', 'system');
  return room;
}

function startRound(room) {
  // Antes da 1ª rodada, remove participantes que ficaram como "fantasmas"
  // após fechar/atualizar uma aba. Isso evita iniciar a partida já pausada.
  if (room.status === 'lobby') {
    const removed = room.players.filter(p => !p.connected);
    if (removed.length) {
      room.players = room.players.filter(p => p.connected);
      log(room, `${removed.length} jogador(es) desconectado(s) removido(s) da sala antes do início.`, 'system');
      if (room.players.length && !room.players.some(p => p.host)) room.players[0].host = true;
    }
  }

  // Uma vaga humana em AUTO continua participando da partida com a mesma mão e pontuação.
  const availableCount = room.players.filter(p => p.connected || p.isBot || p.autoControlled).length;
  if (availableCount < 2) throw new Error('São necessários pelo menos 2 jogadores disponíveis.');
  if (room.players.some(p => !p.isBot && !p.connected && !p.autoControlled)) throw new Error('Há jogador dentro do prazo de reconexão. Aguarde o retorno ou a Máquina assumir temporariamente.');
  if (room.round >= room.rules.rounds) throw new Error('As 5 rodadas já foram concluídas.');
  room.round += 1;
  room.status = 'playing';
  room.direction = -1;
  room.requestedSuit = null;
  room.pendingSeven = 0;
  room.winnerId = null;
  room.lastWinnerCard = null;
  // A conferencia da rodada anterior deixa de ser publica assim que a nova
  // rodada comeca, evitando qualquer risco de misturar maos antigas e novas.
  room.roundReview = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.reactionTopCardId = null;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = null;
  room.openingReaction = false;
  room.finishPendingSeven = false;
  room.discard = [];
  room.deck = shuffle(createDeck());

  room.players.forEach(p => {
    p.hand = [];
    p.roundScore = 0;
    p.finishedRound = false;
    p.declaration = null;
    p.justDrawnCardId = null;
  });

  // Papéis simbólicos da rodada: embaralha -> distribui -> vira.
  const shuffler = (room.round - 1) % room.players.length;
  const dealer = (shuffler - 1 + room.players.length) % room.players.length; // anti-horário
  const flipper = (dealer - 1 + room.players.length) % room.players.length;
  room.roundRoles = {
    shufflerId: room.players[shuffler].id,
    dealerId: room.players[dealer].id,
    flipperId: room.players[flipper].id,
  };

  for (let c=0; c<room.rules.cardsPerPlayer; c++) {
    for (let i=0; i<room.players.length; i++) {
      room.players[i].hand.push(drawOne(room));
    }
  }

  let starter = drawOne(room);
  if (room.rules.safeStarter) {
    const deferred = [];
    while (isSpecial(starter) && room.deck.length) {
      deferred.push(starter);
      starter = drawOne(room);
    }
    room.deck.push(...shuffle(deferred));
  }
  room.discard.push(starter);

  // Começa o jogador seguinte a quem virou a carta, no sentido anti-horário.
  room.currentPlayer = (flipper - 1 + room.players.length) % room.players.length;

  // QUEIMA DA ABERTURA: a carta inicial não foi jogada por um participante,
  // portanto qualquer jogador que tenha uma carta NORMAL exatamente igual pode
  // queimá-la antes da primeira ação normal, mesmo fora da vez. A primeira Queima
  // válida fecha esta janela e transfere a jogada para quem queimou.
  room.openingReaction = true;
  room.burnTopCardId = starter.id;
  room.reactionTopCardId = starter.id;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = room.players[room.currentPlayer]?.id || null;

  log(room, `Rodada ${room.round}: ${room.players[dealer].name} distribuiu 6 cartas e ${room.players[flipper].name} virou ${cardLabel(starter)}.`, 'round');
  log(room, `${room.players[room.currentPlayer].name} começa no sentido anti-horário.`, 'turn');
}

function drawOne(room) {
  if (!room.deck.length) recycleDiscard(room);
  if (!room.deck.length) throw new Error('Não há cartas disponíveis para compra.');
  return room.deck.pop();
}

function recycleDiscard(room) {
  if (room.discard.length <= 1) return;
  const top = room.discard.pop();
  room.deck = shuffle(room.discard);
  room.discard = [top];
  log(room, 'O monte de descarte foi reembaralhado para formar um novo monte de compra.', 'system');
}

function drawCards(room, player, count) {
  const cards = [];
  for (let i=0; i<count; i++) cards.push(drawOne(room));
  player.hand.push(...cards);
  return cards;
}

function topCard(room) {
  return room.discard[room.discard.length-1] || null;
}

// V17 — janela única de reação para Queima e Ação Rápida.
// Ela permanece aberta somente até o próximo jogador começar sua jogada
// (jogar, comprar ou usar Carta Dupla), ou até alguém reagir primeiro.
function closeReaction(room) {
  room.openingReaction = false;
  room.burnTopCardId = null;
  room.reactionTopCardId = null;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = null;
}

function openReaction(room, sourcePlayerId, cardId) {
  if (room.status !== 'playing' || room.currentPlayer < 0) { closeReaction(room); return; }
  room.openingReaction = false;
  room.lastPlayedById = sourcePlayerId;
  room.burnTopCardId = cardId; // compatibilidade com versões anteriores do cliente
  room.reactionTopCardId = cardId;
  room.reactionSourcePlayerId = sourcePlayerId;
  room.reactionNextPlayerId = room.players[room.currentPlayer]?.id || null;
}

function legalCard(room, card, player) {
  if (!card || !player) return false;
  if (room.pendingSeven > 0) return card.rank === '7';
  if (room.requestedSuit) return card.rank === 'J' || card.suit === room.requestedSuit;
  const top = topCard(room);
  if (!top) return true;
  return card.rank === 'J' || card.rank === top.rank || card.suit === top.suit;
}

// V31 — cartas especiais NÃO podem iniciar Queima nem Ação Rápida fora da vez.
// Porém, depois que o jogador queima uma carta NORMAL exatamente igual à mesa,
// ele assume a jogada. Nesse momento pode usar como continuação QUALQUER carta
// legal, inclusive A, 7, 8, J, Q ou K; se for especial, seu efeito é aplicado normalmente.
function burnContinuationCardLegal(room, card, player) {
  return !!card && legalCard(room, card, player);
}

function ensureTurn(room, playerId) {
  if (roomPausedForReconnect(room)) throw new Error('A partida está pausada durante o prazo de reconexão.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  if (idx !== room.currentPlayer) throw new Error('Não é a sua vez.');
  return idx;
}

function declare(room, playerId, type) {
  if (roomPausedForReconnect(room)) throw new Error('A partida está pausada durante o prazo de reconexão.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  const p = room.players[idx];
  if (!['mau-mau','batendo'].includes(type)) throw new Error('Declaração inválida.');

  // Regra geral: Queima com continuação acontece na vez normal do jogador.
  // Exceção: enquanto a primeira carta virada ainda não recebeu nenhuma ação,
  // qualquer jogador pode queimá-la se tiver uma carta normal exatamente igual.
  // Fora dessa abertura, a intervenção fora da vez continua sendo Ação Rápida.
  const isTurn = room.players[room.currentPlayer]?.id === p.id;
  const hasBurnOpportunity = canBurnMatch(room,p).length > 0;
  const hasQuickOpportunity = canQuickAction(room,p).length > 0;
  const doublePairs = canPlayDouble(room,p);
  const hasDoubleOpportunity = doublePairs.length > 0;
  if (!isTurn && !hasBurnOpportunity && !hasQuickOpportunity) throw new Error('Não é a sua vez.');

  if (type === 'mau-mau') {
    const canReachOneByBurn = p.hand.length === 3 && hasBurnOpportunity;
    const canReachOneByDouble = p.hand.length === 3 && hasDoubleOpportunity;
    if (p.hand.length !== 2 && !canReachOneByBurn && !canReachOneByDouble) {
      throw new Error('O aviso Mau-Mau deve ser feito antes de uma jogada que deixe você com apenas uma carta.');
    }
  }
  if (type === 'batendo') {
    const canFinishByBurn = p.hand.length === 2 && canFinishBurn(room,p).length > 0;
    const canFinishByDouble = p.hand.length === 2 && hasDoubleOpportunity;
    if (!canFinishByBurn && !canFinishByDouble) {
      throw new Error('Mau-Mau batendo exige uma jogada válida que descarte suas duas últimas cartas, por Queima ou Carta Dupla.');
    }
  }
  p.declaration = type;
  log(room, `${p.name} anunciou ${type === 'batendo' ? '“Mau-Mau batendo/queimando!”' : '“Mau-Mau!”'}`, 'mau', {playerId:p.id,declaration:type});
}

function removeCard(player, cardId) {
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx < 0) throw new Error('Carta não encontrada na mão.');
  return player.hand.splice(idx,1)[0];
}

function applyMauMauPenaltyIfNeeded(room, player, beforeCount, afterCount) {
  if (beforeCount === 2 && afterCount === 1) {
    if (player.declaration !== 'mau-mau') {
      const n = room.rules.mauMauPenalty;
      drawCards(room, player, n);
      log(room, `${player.name} esqueceu de anunciar Mau-Mau e comprou ${n} carta(s) de penalidade.`, 'penalty');
    }
  }
  player.declaration = null;
}

function playCard(room, playerId, cardId, chosenSuit=null, opts={}) {
  const idx = ensureTurn(room, playerId);
  const player = room.players[idx];
  const card = player.hand.find(c => c.id === cardId);
  if (!card) throw new Error('Carta não encontrada.');
  if (!legalCard(room, card, player)) throw new Error('Essa carta não pode ser jogada agora.');

  const wasContinuation = room.continuationPlayerId === player.id;
  // V31: uma Queima válida transfere a jogada para quem queimou. Por isso, a
  // segunda carta pode ser especial e deve executar o mesmo efeito da jogada normal.
  if (wasContinuation && player.hand.length === 1 && player.declaration !== 'batendo') {
    throw new Error('Para encerrar a rodada com a segunda carta da queima, anuncie “Mau-Mau batendo/queimando” antes de iniciar a queima.');
  }

  if (card.rank === 'J' && player.hand.length > 1 && !SUITS.includes(chosenSuit)) {
    throw new Error('Escolha um naipe ao jogar o Valete.');
  }

  // Só fechamos a reação anterior depois de validar completamente a jogada.
  // Assim, um clique inválido do próximo jogador não elimina uma Queima/Ação Rápida legítima.
  closeReaction(room);

  // V29 — COMPRA LIVRE: depois de comprar 1 carta, qualquer carta válida da mão
  // pode ser jogada. A carta comprada pode ficar guardada. Ao escolher uma jogada,
  // encerramos o estado de decisão pós-compra sem remover a carta comprada da mão.
  if (player.justDrawnCardId) player.justDrawnCardId = null;

  const before = player.hand.length;
  const played = removeCard(player, cardId);
  room.discard.push(played);
  room.requestedSuit = null;
  log(room, `${player.name} jogou ${cardLabel(played)}.`, isSpecial(played) ? 'special' : 'play');

  if (played.rank === 'J' && player.hand.length > 0) {
    room.requestedSuit = chosenSuit;
    log(room, `${player.name} escolheu ${suitLabel(chosenSuit)}.`, 'special');
  }

  // Se a carta for usada como continuação de uma queima, esta jogada encerra o turno.
  if (wasContinuation) room.continuationPlayerId = null;

  // V32 — o efeito da carta especial continua valendo mesmo quando ela é
  // usada para BATER. O 7 permanece com tratamento próprio porque sua cadeia
  // precisa ser resolvida antes de calcular a pontuação da rodada.
  if (played.rank === '7') {
    room.pendingSeven += 2;

    // Se a rodada já tem um vencedor que bateu com 7, qualquer 7 jogado em
    // resposta continua a cadeia final — mesmo que o jogador ainda tenha
    // outras cartas na mão. A cadeia percorre os demais jogadores uma vez.
    if (room.finishPendingSeven && room.winnerId) {
      if (player.hand.length === 0) {
        player.finishedRound = true;
        log(room, `${player.name} rebateu o 7 durante a resolução final e ficou sem cartas.`, 'special');
      }
      applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);
      const target = nextEligiblePenaltyTarget(room, idx);
      if (target < 0) {
        log(room, 'A cadeia final de 7 completou a volta pela mesa: todos rebateram e ninguém compra cartas.', 'special');
        room.finishPendingSeven = false;
        finalizeRound(room);
      } else {
        room.currentPlayer = target;
      }
      return;
    }

    if (player.hand.length === 0) {
      room.winnerId = player.id;
      room.lastWinnerCard = played;
      player.finishedRound = true;
      room.finishPendingSeven = true;
      log(room, `${player.name} bateu com um 7. A penalidade de ${room.pendingSeven} carta(s) continua ativa e os demais podem rebater com outro 7.`, 'winner');
      const target = nextEligiblePenaltyTarget(room, idx);
      if (target < 0) {
        log(room, 'A cadeia final de 7 não encontrou outro jogador: ninguém compra cartas.', 'special');
        room.finishPendingSeven = false;
        finalizeRound(room);
      } else {
        room.currentPlayer = target;
      }
      return;
    }

    room.currentPlayer = nextIndex(room, idx, 1);
    applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);
    return;
  }

  // Se a carta zerou a mão, aplicamos PRIMEIRO o efeito especial que altera
  // cartas/pontuação. Só depois a rodada é finalizada. Assim, bater com 8 ou K
  // faz o jogador anterior comprar antes do cálculo; J continua dobrando os
  // pontos; Q/A registram seu efeito normal antes do encerramento.
  if (player.hand.length === 0) {
    if (played.rank === 'A') {
      const skipped = nextIndex(room, idx, 1, false);
      if (skipped >= 0 && room.players[skipped]) {
        log(room, `${room.players[skipped].name} perdeu a vez por causa do Ás usado na batida.`, 'special');
      }
    } else if (played.rank === 'Q') {
      room.direction *= -1;
      log(room, `A Dama usada na batida inverteu o sentido para ${room.direction === 1 ? 'horário' : 'anti-horário'}.`, 'special');
    } else if (played.rank === 'K') {
      const target = previousIndex(room, idx);
      if (target >= 0 && room.players[target] && room.players[target].id !== player.id) {
        drawCards(room, room.players[target], 1);
        log(room, `${room.players[target].name} comprou 1 carta pelo Rei usado na batida.`, 'penalty');
      }
    } else if (played.rank === '8') {
      const target = previousIndex(room, idx);
      if (target >= 0 && room.players[target] && room.players[target].id !== player.id) {
        drawCards(room, room.players[target], 2);
        log(room, `${room.players[target].name} comprou 2 cartas pelo Oito usado na batida.`, 'penalty');
      }
    }

    room.winnerId = player.id;
    room.lastWinnerCard = played;
    player.finishedRound = true;
    applyMauMauPenaltyIfNeeded(room, player, before, 0);
    finalizeRound(room);
    return;
  }

  applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);

  if (played.rank === 'A') {
    const skipped = nextIndex(room, idx, 1);
    const next = nextIndex(room, idx, 2);
    log(room, `${room.players[skipped].name} perdeu a vez por causa do Ás.`, 'special');
    room.currentPlayer = next;
  } else if (played.rank === 'Q') {
    room.direction *= -1;
    const ativos = activePlayers(room);
    if (ativos.length === 2) {
      // Regra do Mau-Mau desta versão: com apenas dois jogadores, inverter o
      // sentido equivale a devolver a vez a quem jogou a Dama.
      room.currentPlayer = idx;
      log(room, `A Dama inverteu o sentido para ${room.direction === 1 ? 'horário' : 'anti-horário'} e, com 2 jogadores, ${player.name} joga novamente.`, 'special');
    } else {
      room.currentPlayer = nextIndex(room, idx, 1);
      log(room, `A Dama inverteu o sentido para ${room.direction === 1 ? 'horário' : 'anti-horário'}.`, 'special');
    }
  } else if (played.rank === 'K') {
    const target = previousIndex(room, idx);
    drawCards(room, room.players[target], 1);
    log(room, `${room.players[target].name} comprou 1 carta por causa do Rei.`, 'penalty');
    room.currentPlayer = nextIndex(room, idx, 1);
  } else if (played.rank === '8') {
    const target = previousIndex(room, idx);
    drawCards(room, room.players[target], 2);
    log(room, `${room.players[target].name} comprou 2 cartas por causa do Oito.`, 'penalty');
    room.currentPlayer = nextIndex(room, idx, 1);
  } else {
    room.currentPlayer = nextIndex(room, idx, 1);
  }

  // Só agora, com o próximo jogador já definido (inclusive após A/Q/K/8),
  // abrimos a janela de reação para Queima/Ação Rápida.
  openReaction(room, player.id, played.id);
}


// V17 — CARTA DUPLA (SOMENTE CARTAS NORMAIS)
// Na própria vez, se o jogador possuir duas cartas exatamente idênticas
// (mesmo valor + mesmo naipe) e a carta for legal sobre o topo da mesa,
// ele pode descartar as duas juntas como UMA jogada composta.
// A Carta Dupla NÃO pode ser usada com cartas especiais: A, 7, 8, J, Q e K.
function canPlayDouble(room, player) {
  if (!room?.rules?.doubleCardEnabled || room.status !== 'playing') return [];
  if (!playerAvailable(player) || player.finishedRound) return [];
  if (room.players[room.currentPlayer]?.id !== player.id) return [];
  if (room.continuationPlayerId) return [];
  // V29: depois de comprar, o jogador continua livre para usar qualquer jogada válida,
  // inclusive Carta Dupla, ou simplesmente passar a vez.

  const groups = new Map();
  for (const c of player.hand) {
    const key = `${c.rank}|${c.suit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const pairs = [];
  for (const cards of groups.values()) {
    if (cards.length < 2) continue;
    const first = cards[0], second = cards[1];
    if (isSpecial(first)) continue; // V17: Carta Dupla não vale para A, 7, 8, J, Q e K
    if (!legalCard(room, first, player)) continue;
    pairs.push({
      cardIds: [first.id, second.id],
      rank: first.rank,
      suit: first.suit,
    });
  }
  return pairs;
}

function applyDoubleMauMauPenaltyIfNeeded(room, player, beforeCount, afterCount) {
  if (beforeCount === 3 && afterCount === 1) {
    if (player.declaration !== 'mau-mau') {
      const n = room.rules.mauMauPenalty;
      drawCards(room, player, n);
      log(room, `${player.name} usou Carta Dupla, ficou com uma carta sem anunciar Mau-Mau e comprou ${n} carta(s) de penalidade.`, 'penalty');
    }
  }
  player.declaration = null;
}

function playDoubleCard(room, playerId, firstCardId, secondCardId, chosenSuit=null) {
  const idx = ensureTurn(room, playerId);
  const player = room.players[idx];

  if (!room.rules.doubleCardEnabled) throw new Error('A regra Carta Dupla está desativada.');
  if (room.continuationPlayerId === player.id) throw new Error('Resolva primeiro a Queima: jogue uma carta compatível, compre quando for obrigatório ou passe a vez.');

  const first = player.hand.find(c => c.id === firstCardId);
  const second = player.hand.find(c => c.id === secondCardId);
  if (!first || !second || first.id === second.id) throw new Error('Selecione duas cartas diferentes da sua mão.');
  if (!sameCard(first, second)) throw new Error('Carta Dupla exige duas cartas idênticas: mesmo valor e mesmo naipe.');
  if (isSpecial(first)) throw new Error('Carta Dupla não pode ser usada com cartas especiais (A, 7, 8, J, Q e K).');
  if (!legalCard(room, first, player)) throw new Error('Essa dupla não pode ser jogada sobre a carta atual da mesa.');

  // A dupla foi validada: agora ela fecha qualquer janela de reação anterior.
  closeReaction(room);

  // Quando as duas últimas cartas forem usadas juntas, preservamos a regra
  // original do projeto: é necessário anunciar Mau-Mau batendo/queimando.
  if (player.hand.length === 2 && player.declaration !== 'batendo') {
    throw new Error('Para encerrar a rodada com Carta Dupla, anuncie “Mau-Mau batendo/queimando” antes.');
  }

  const before = player.hand.length;
  const played1 = removeCard(player, first.id);
  const played2 = removeCard(player, second.id);
  room.discard.push(played1, played2);
  room.requestedSuit = null;
  room.lastPlayedById = player.id;
  player.justDrawnCardId = null;

  log(room, `${player.name} jogou CARTA DUPLA: ${cardLabel(played1)} + ${cardLabel(played2)}.`, 'play');

  if (player.hand.length === 0) {
    room.winnerId = player.id;
    room.lastWinnerCard = played2;
    player.finishedRound = true;
    player.declaration = null;
    finalizeRound(room);
    return;
  }

  applyDoubleMauMauPenaltyIfNeeded(room, player, before, player.hand.length);
  room.currentPlayer = nextIndex(room, idx, 1);
  openReaction(room, player.id, played2.id);
}

function burnFollowUpLegal(baseCard, nextCard) {
  if (!baseCard || !nextCard) return false;
  // Valete continua sendo coringa; as demais cartas (inclusive especiais)
  // precisam combinar pelo valor ou pelo naipe da carta que iniciou a Queima.
  return nextCard.rank === 'J' || nextCard.rank === baseCard.rank || nextCard.suit === baseCard.suit;
}

function burnFollowUps(player, baseCard) {
  if (!player || !baseCard) return [];
  return player.hand.filter(c => c.id !== baseCard.id && burnFollowUpLegal(baseCard, c));
}

function canFinishBurn(room, player) {
  return canBurnMatch(room, player).filter(first =>
    burnFollowUps(player, first).length > 0
  );
}

// QUEIMA — REGRA NORMAL + EXCEÇÃO DA ABERTURA
// Na regra normal, quando chega a sua vez e você possui exatamente a mesma carta
// da mesa (mesmo valor + mesmo naipe), pode queimá-la e ganhar o direito à continuação.
// Exceção: a PRIMEIRA carta virada da rodada também pode ser queimada por qualquer
// jogador com uma cópia normal exatamente igual, mesmo fora da vez. Depois da
// primeira ação normal, volta a valer a regra comum: fora da vez, use Ação Rápida.
// Depois da queima, a segunda carta NÃO é mais obrigatória:
//   • se houver carta compatível, o jogador pode jogá-la OU passar a vez;
//   • se não houver carta compatível, deve comprar 1 carta;
//   • após a compra, pode jogar qualquer carta válida da mão OU passar,
//     mantendo a carta comprada na mão se não quiser usá-la.
// V31: cartas especiais A, 7, 8, J, Q e K não podem INICIAR a Queima.
// Depois que uma carta normal idêntica é queimada, a continuação pode ser uma
// carta especial legal, e seu efeito será executado normalmente.
function burnMatch(room, playerId, cardId) {
  if (roomPausedForReconnect(room)) throw new Error('A partida está pausada durante o prazo de reconexão.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  if (!room.rules.burnEnabled) throw new Error('A regra de queimar cartas está desativada.');
  if (room.pendingSeven > 0) throw new Error('Não é permitido queimar durante uma penalidade de 7.');
  if (room.continuationPlayerId) throw new Error('Aguarde a queima atual ser concluída.');

  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  const player = room.players[idx];
  if (!playerAvailable(player) || player.finishedRound) throw new Error('Jogador não pode realizar a queima agora.');

  const top = topCard(room);
  const openingBurn = !!(room.openingReaction && top && room.reactionTopCardId === top.id);
  if (idx !== room.currentPlayer && !openingBurn) {
    throw new Error('A Queima com direito à segunda carta só pode ser feita na sua vez normal, exceto sobre a primeira carta virada da rodada. Fora disso, use Ação Rápida.');
  }

  const first = player.hand.find(c => c.id === cardId);
  if (!first) throw new Error('Carta não encontrada na mão.');
  if (!top) throw new Error('Não há carta na mesa para realizar a Queima.');
  if (isSpecial(first)) throw new Error('Não é permitido queimar Ás, Dama, Valete, Rei, Oito ou Sete.');
  if (!sameCard(first, top)) throw new Error('Para queimar, sua primeira carta deve ser exatamente igual à carta da mesa: mesmo valor e mesmo naipe.');

  if (player.hand.length === 2 && !['mau-mau','batendo'].includes(player.declaration)) {
    throw new Error('Antes de queimar e ficar com uma carta, anuncie “Mau-Mau”. Se pretende usar também a última carta e encerrar a rodada, anuncie “Mau-Mau batendo/queimando”.');
  }

  const before = player.hand.length;
  closeReaction(room);
  const played = removeCard(player, first.id);
  room.discard.push(played);
  room.requestedSuit = null;
  player.justDrawnCardId = null;
  room.lastPlayedById = player.id;

  if (player.hand.length === 0) {
    room.winnerId = player.id;
    room.lastWinnerCard = played;
    player.finishedRound = true;
    player.declaration = null;
    finalizeRound(room);
    return;
  }

  room.currentPlayer = idx;
  room.continuationPlayerId = player.id;

  const followUps = player.hand.filter(c => burnContinuationCardLegal(room,c,player));
  if (followUps.length) {
    log(room, `${player.name} QUEIMOU ${cardLabel(played)}${openingBurn ? ' na abertura da rodada, mesmo fora da vez' : ' na própria vez'}. Pode jogar mais uma carta compatível ou passar a vez.`, 'burn');
  } else {
    log(room, `${player.name} QUEIMOU ${cardLabel(played)}${openingBurn ? ' na abertura da rodada, mesmo fora da vez' : ' na própria vez'}, mas não possui carta compatível. Deve comprar 1 carta e então poderá jogar uma carta válida ou passar a vez.`, 'burn');
  }

  if (before === 2 && player.hand.length === 1 && player.declaration === 'mau-mau') {
    log(room, `${player.name} ficou com uma carta após a queima e havia anunciado Mau-Mau.`, 'mau');
  }
}

// Mantido como alias para não quebrar clientes antigos durante a atualização.
function burnPair(room, playerId, cardId) {
  return burnMatch(room, playerId, cardId);
}

function endBurnContinuation(room, playerId) {
  return passTurn(room, playerId);
}

function nextEligiblePenaltyTarget(room, fromIdx) {
  const n = room.players.length;
  if (!n) return -1;

  // V32 — quando a batida ocorreu com 7, a cadeia final pode dar UMA volta
  // completa pela mesa. Se todos os jogadores restantes responderem com 7 e
  // a vez chegaria novamente ao vencedor original, a penalidade se encerra
  // sem compra. Não pulamos o vencedor para iniciar uma segunda volta.
  let cursor = fromIdx;
  for (let guard = 0; guard < n; guard++) {
    cursor = (cursor + room.direction + n) % n;
    const candidate = room.players[cursor];
    if (!candidate) continue;
    if (room.finishPendingSeven && room.winnerId && candidate.id === room.winnerId) return -1;
    if (!candidate.finishedRound) return cursor;
  }
  return -1;
}

function drawAction(room, playerId) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];
  // Ao iniciar uma compra, encerra-se qualquer janela de reação da jogada anterior.
  closeReaction(room);

  // V18: durante a continuação de uma queima, a compra é obrigatória somente
  // quando não existe nenhuma carta compatível na mão. Depois de comprar uma,
  // o jogador pode jogá-la (se for válida) ou passar a vez e guardá-la.
  if (room.continuationPlayerId === p.id) {
    if (p.justDrawnCardId) {
      throw new Error('Você já comprou uma carta após a queima. Jogue qualquer carta válida da mão, se quiser, ou passe a vez.');
    }
    const legalFollowUps = p.hand.filter(c => burnContinuationCardLegal(room,c,p));
    if (legalFollowUps.length) {
      throw new Error('Depois da queima você já possui carta compatível. Pode jogá-la ou passar a vez sem comprar.');
    }
    const drawn = drawOne(room);
    p.hand.push(drawn);
    p.justDrawnCardId = drawn.id;
    if (p.declaration === 'batendo') p.declaration = null;
    log(room, `${p.name} comprou 1 carta após a queima. Pode jogar qualquer carta válida da mão ou passar a vez e guardar a carta comprada.`, 'draw');
    return;
  }

  if (room.pendingSeven > 0) {
    const count = room.pendingSeven;
    drawCards(room, p, count);
    room.pendingSeven = 0;
    log(room, `${p.name} comprou ${count} carta(s) pela cadeia de 7 e perdeu a vez.`, 'penalty');

    if (room.finishPendingSeven && room.winnerId) {
      room.finishPendingSeven = false;
      finalizeRound(room);
    } else {
      room.currentPlayer = nextIndex(room, idx, 1);
    }
    return;
  }

  // V13: o jogador pode optar por comprar mesmo tendo carta válida na mão.
  // Porém, só pode comprar UMA carta na jogada normal. A compra é o requisito
  // para habilitar o botão "Passar a vez".
  if (p.justDrawnCardId) {
    throw new Error('Você já comprou uma carta nesta vez. Jogue qualquer carta válida da sua mão ou passe a vez.');
  }

  const drawn = drawOne(room);
  p.hand.push(drawn);
  p.justDrawnCardId = drawn.id;
  log(room, `${p.name} comprou 1 carta. Agora pode jogar qualquer carta válida da mão ou passar a vez e guardar a carta comprada.`, 'draw');

  const legalNow = p.hand.filter(c => legalCard(room, c, p));
  if (legalNow.length) {
    log(room, `${p.name} possui ${legalNow.length} opção(ões) válida(s) após a compra e pode escolher qualquer uma delas ou passar a vez.`, 'turn');
  } else {
    log(room, `${p.name} não possui carta válida após a compra e deve passar a vez.`, 'turn');
  }
}

// V18 — PASSAR A VEZ
// Regra normal: continua obrigatório comprar 1 carta antes de passar.
// Exceção da QUEIMA: após queimar, o jogador pode passar sem jogar outra carta.
// Se não houver nenhuma carta compatível na mão, ele precisa comprar 1 antes;
// depois da compra, pode jogar qualquer carta válida da mão ou simplesmente
// guardar a carta comprada e passar a vez.
function passTurn(room, playerId) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];

  if (room.pendingSeven > 0) {
    throw new Error('Não é possível passar a vez durante uma cadeia de 7. Rebate com outro 7 ou compre a penalidade.');
  }

  const inBurnContinuation = room.continuationPlayerId === p.id;

  if (inBurnContinuation) {
    const hasDrawn = !!p.justDrawnCardId;
    const legalFollowUps = hasDrawn ? [] : p.hand.filter(c => burnContinuationCardLegal(room,c,p));

    if (!hasDrawn && legalFollowUps.length === 0) {
      throw new Error('Após a queima, você não possui carta compatível. Compre 1 carta antes de passar a vez.');
    }

    const keptCardId = p.justDrawnCardId || null;
    p.justDrawnCardId = null;
    p.declaration = null;
    room.continuationPlayerId = null;
    closeReaction(room);

    const next = nextIndex(room, idx, 1);
    room.currentPlayer = next;
    room.lastPass = {
      playerId: p.id,
      keptCardId,
      nextPlayerId: room.players[next]?.id || null,
      afterBurn: true,
      at: Date.now(),
    };

    const top = topCard(room);
    if (top && room.status === 'playing') openReaction(room, p.id, top.id);

    if (keptCardId) {
      log(room, `${p.name} passou a vez após a queima e guardou a carta comprada. Agora é a vez de ${room.players[next]?.name || 'outro jogador'}.`, 'turn');
    } else {
      log(room, `${p.name} decidiu não jogar uma segunda carta após a queima e passou a vez. Agora é a vez de ${room.players[next]?.name || 'outro jogador'}.`, 'turn');
    }
    return;
  }

  if (!p.justDrawnCardId) {
    throw new Error('Para passar a vez, primeiro compre 1 carta do monte.');
  }

  closeReaction(room);
  const keptCardId = p.justDrawnCardId;
  p.justDrawnCardId = null;
  p.declaration = null;

  const next = nextIndex(room, idx, 1);
  room.currentPlayer = next;
  room.lastPass = {
    playerId: p.id,
    keptCardId,
    nextPlayerId: room.players[next]?.id || null,
    afterBurn: false,
    at: Date.now(),
  };

  log(room, `${p.name} passou a vez. A carta comprada permaneceu na mão e agora é a vez de ${room.players[next]?.name || 'outro jogador'}.`, 'turn');
}

function passAfterDraw(room, playerId) {
  return passTurn(room, playerId);
}

function playDrawnCard(room, playerId, cardId, chosenSuit=null) {
  // V29: após comprar, o jogador não fica preso à carta comprada.
  // Esta função é mantida apenas por compatibilidade com versões anteriores do cliente.
  return playCard(room, playerId, cardId, chosenSuit);
}

function finalizeRound(room) {
  const winner = room.players.find(p => p.id === room.winnerId);
  if (!winner) throw new Error('Vencedor da rodada não encontrado.');
  const double = room.lastWinnerCard?.rank === 'J';

  // V38 — CONFERENCIA DA RODADA
  // Neste ponto todos os efeitos finais ja foram resolvidos. Isso inclui a
  // compra causada por 8/K e a cadeia final de 7. Portanto, a fotografia das
  // maos abaixo corresponde exatamente as cartas usadas na pontuacao.
  const reviewPlayers = [];
  for (const p of room.players) {
    const basePoints = p.id === winner.id ? 0 : p.hand.reduce((sum,c) => sum + cardPoints(c), 0);
    const multiplier = double && p.id !== winner.id ? 2 : 1;
    const points = basePoints * multiplier;
    p.roundScore = points;
    p.roundHistory.push(points);
    p.score += points;

    reviewPlayers.push({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: !!p.isBot,
      isWinner: p.id === winner.id,
      cards: p.hand.map(c => ({
        id: c.id,
        suit: c.suit,
        rank: c.rank,
        copy: c.copy,
        points: cardPoints(c),
      })),
      basePoints,
      multiplier,
      roundScore: points,
      scoreAfter: p.score,
    });
  }

  room.roundReview = {
    id: `round-review-${room.round}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    round: room.round,
    winnerId: winner.id,
    winnerName: winner.name,
    winnerAvatar: winner.avatar,
    lastWinnerCard: room.lastWinnerCard ? { ...room.lastWinnerCard } : null,
    doubledByJack: double,
    players: reviewPlayers,
    createdAt: Date.now(),
  };

  log(room, `${winner.name} venceu a rodada${double ? ' com Valete: os pontos dos demais foram dobrados' : ''}.`, 'winner');
  room.status = room.round >= room.rules.rounds ? 'finished' : 'between-rounds';
  room.currentPlayer = -1;
  room.pendingSeven = 0;
  room.requestedSuit = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.reactionTopCardId = null;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = null;
  room.openingReaction = false;
  room.finishPendingSeven = false;

  if (room.status === 'finished') {
    room.finishedAt = Date.now();
    const min = Math.min(...room.players.map(p => p.score));
    const winners = room.players.filter(p => p.score === min);
    log(room, `Fim das 5 rodadas. ${winners.map(p=>p.name).join(' e ')} ${winners.length>1?'empataram':'venceu'} com ${min} ponto(s).`, 'champion');
  }
}

function canBurnMatch(room, player) {
  if (!room.rules.burnEnabled || room.status !== 'playing' || room.pendingSeven > 0 || room.continuationPlayerId) return [];
  if (!playerAvailable(player) || player.finishedRound) return [];

  const top = topCard(room);
  const current = room.players[room.currentPlayer];
  const openingBurn = !!(room.openingReaction && top && room.reactionTopCardId === top.id);
  // Fora da abertura, a Queima com continuação pertence somente à vez normal.
  // Na abertura, qualquer jogador pode queimar a carta inicial exatamente igual.
  if (!current || (current.id !== player.id && !openingBurn)) return [];

  if (!top || isSpecial(top)) return [];
  return player.hand.filter(first => !isSpecial(first) && sameCard(first, top));
}

// V17 — AÇÃO RÁPIDA
// Um jogador que NÃO seria o próximo da vez pode descartar imediatamente uma carta
// exatamente igual à recém-jogada. É uma intervenção de uma única carta: não toma a vez,
// não altera o sentido e não dispara novamente o efeito especial da carta. A ordem normal
// continua com quem já seria o próximo. A primeira reação aceita pelo servidor fecha a janela.
function canQuickAction(room, player) {
  if (!room?.rules?.quickActionEnabled || room.status !== 'playing') return [];
  if (room.pendingSeven > 0 || room.continuationPlayerId) return [];
  if (!playerAvailable(player) || player.finishedRound) return [];
  const top = topCard(room);
  if (!top || room.reactionTopCardId !== top.id || !room.reactionSourcePlayerId || !room.reactionNextPlayerId) return [];
  if (room.reactionSourcePlayerId === player.id) return [];
  if (room.reactionNextPlayerId === player.id) return []; // pela regra, quem já seria o próximo não usa Ação Rápida
  if (isSpecial(top)) return []; // V30: especial nunca entra em Ação Rápida
  return player.hand.filter(c => !isSpecial(c) && sameCard(c, top));
}

function quickAction(room, playerId, cardId) {
  if (roomPausedForReconnect(room)) throw new Error('A partida está pausada durante o prazo de reconexão.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  if (!room.rules.quickActionEnabled) throw new Error('A regra de Ação Rápida está desativada.');
  if (room.pendingSeven > 0) throw new Error('A Ação Rápida fica suspensa enquanto uma cadeia de 7 está sendo resolvida.');
  if (room.continuationPlayerId) throw new Error('Aguarde a queima atual ser concluída.');

  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  const player = room.players[idx];
  const requested = player.hand.find(c => c.id === cardId);
  if (requested && isSpecial(requested)) {
    throw new Error('Cartas especiais (A, 7, 8, J, Q e K) não podem ser usadas em Ação Rápida; só podem ser jogadas na vez normal.');
  }
  const allowed = canQuickAction(room, player);
  if (!allowed.some(c => c.id === cardId)) {
    throw new Error('Ação Rápida indisponível: use apenas carta normal exatamente igual à recém-jogada e somente fora da vez do próximo jogador.');
  }

  const normalNextId = room.reactionNextPlayerId;
  const before = player.hand.length;
  const played = removeCard(player, cardId);
  room.discard.push(played);
  player.justDrawnCardId = null;
  closeReaction(room); // a primeira Ação Rápida válida vence; não há encadeamento
  room.lastPlayedById = player.id;

  // Mantemos rigorosamente a ordem original. A carta rápida é apenas descartada;
  // seu efeito especial não é reexecutado, pois a regra manda a ordem normal continuar.
  const nextIdx = room.players.findIndex(p => p.id === normalNextId);
  if (nextIdx >= 0 && !room.players[nextIdx].finishedRound) room.currentPlayer = nextIdx;

  log(room, `${player.name} fez AÇÃO RÁPIDA com ${cardLabel(played)}. A vez continua com ${room.players[room.currentPlayer]?.name || 'o próximo jogador'}.`, 'quick');

  if (player.hand.length === 0) {
    room.winnerId = player.id;
    room.lastWinnerCard = played;
    player.finishedRound = true;
    player.declaration = null;
    finalizeRound(room);
    return;
  }

  applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);
}

function roomPublicState(room, viewerId) {
  const viewer = room.players.find(p => p.id === viewerId);
  const top = topCard(room);
  const replayHumans = room.players.filter(p => !p.isBot);
  const replayReady = new Set(Array.isArray(room.replayReadyPlayerIds) ? room.replayReadyPlayerIds : []);
  const replayConnected = replayHumans.filter(p => p.connected);
  const replayEligible = room.status === 'finished' && replayHumans.length >= 2 && room.players.every(p => !p.isBot);
  return {
    code: room.code,
    status: room.status,
    round: room.round,
    rounds: room.rules.rounds,
    direction: room.direction,
    requestedSuit: room.requestedSuit,
    pendingSeven: room.pendingSeven,
    currentPlayerId: room.currentPlayer >= 0 ? room.players[room.currentPlayer]?.id : null,
    topCard: top,
    deckCount: room.deck.length,
    rules: room.rules,
    connectedCount: room.players.filter(p => p.connected).length,
    // A mesa pausa somente durante os 60 s de tolerância. Depois disso, a vaga
    // segue em AUTO e a rodada pode continuar normalmente.
    paused: roomPausedForReconnect(room),
    winnerId: room.winnerId,
    lastWinnerCard: room.lastWinnerCard,
    continuationPlayerId: room.continuationPlayerId,
    reactionSourcePlayerId: room.reactionSourcePlayerId,
    reactionNextPlayerId: room.reactionNextPlayerId,
    openingReaction: !!room.openingReaction,
    lastPass: room.lastPass,
    roundRoles: room.roundRoles,
    // As cartas dos adversarios so sao reveladas quando a rodada terminou.
    roundReview: (room.status === 'between-rounds' || room.status === 'finished') ? room.roundReview : null,
    replay: {
      eligible: replayEligible,
      readyCount: replayConnected.filter(p => replayReady.has(p.id)).length,
      requiredCount: replayConnected.length,
      meReady: !!(viewer && replayReady.has(viewer.id)),
    },
    players: room.players.map(p => ({
      id:p.id,
      name:p.name,
      avatar:p.avatar,
      cardCount:p.hand.length,
      score:p.score,
      roundScore:p.roundScore,
      roundHistory:p.roundHistory,
      connected:p.connected,
      autoControlled:!!p.autoControlled,
      reconnectDeadlineAt:p.reconnectDeadlineAt || null,
      host:p.host,
      finishedRound:p.finishedRound,
      isBot:p.isBot,
    })),
    me: viewer ? {
      id: viewer.id,
      name: viewer.name,
      avatar: viewer.avatar,
      hand: viewer.hand,
      score: viewer.score,
      roundScore: viewer.roundScore,
      declaration: viewer.declaration,
      justDrawnCardId: viewer.justDrawnCardId || null,
      legalCardIds: room.status === 'playing' && room.players[room.currentPlayer]?.id === viewer.id
        ? viewer.hand.filter(c => legalCard(room,c,viewer)).map(c=>c.id)
        : [],
      burnableCardIds: room.status === 'playing'
        ? canBurnMatch(room,viewer).map(c=>c.id)
        : [],
      burnFinishableCardIds: room.status === 'playing'
        ? canFinishBurn(room,viewer).map(c=>c.id)
        : [],
      quickActionCardIds: room.status === 'playing'
        ? canQuickAction(room,viewer).map(c=>c.id)
        : [],
      doublePairs: room.status === 'playing'
        ? canPlayDouble(room,viewer)
        : [],
      burnSecondRequired: false,
      burnContinuationActive: room.continuationPlayerId === viewer.id,
      burnMustDraw: room.continuationPlayerId === viewer.id
        && !viewer.justDrawnCardId
        && viewer.hand.filter(c => burnContinuationCardLegal(room,c,viewer)).length === 0,
    } : null,
    log: room.log.slice(-30),
  };
}

function cardLabel(card) {
  return `${rankLabel(card.rank)} de ${suitLabel(card.suit)}`;
}
function rankLabel(rank) {
  return ({A:'Ás',J:'Valete',Q:'Dama',K:'Rei'})[rank] || rank;
}
function suitLabel(suit) {
  return ({hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'})[suit] || suit;
}

module.exports = {
  SUITS,RANKS,SPECIAL_RANKS,DEFAULT_RULES,
  createDeck,shuffle,cardPoints,isSpecial,sameCard,
  createRoom,addPlayer,reconnectPlayer,resetMatch,startRound,
  legalCard,declare,playCard,playDoubleCard,canPlayDouble,burnMatch,burnPair,endBurnContinuation,canBurnMatch,canFinishBurn,quickAction,canQuickAction,
  drawAction,passTurn,passAfterDraw,playDrawnCard,finalizeRound,
  roomPublicState,cardLabel,suitLabel,rankLabel,
  appendLog: log,
};
