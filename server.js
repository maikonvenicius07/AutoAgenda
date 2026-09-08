'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const Engine = require('./game-engine');
const BotPlayer = require('./bot-player');
const { RankingStore, buildMatchRecord, normalizePeriod, normalizeMode } = require('./ranking-store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 900000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
// V39.1 — timers de tolerância de reconexão ficam somente na memória do servidor.
const reconnectTimers = new Map();
const RECONNECT_GRACE_MS = 60 * 1000;

// V40.1 — presença online e convites são efêmeros e vivem somente na memória.
// A identidade é a playerKey derivada da Conta Google, nunca o socketId.
const onlinePresence = new Map();
const invitations = new Map();
const inviteTimers = new Map();
const INVITE_TTL_MS = 30 * 1000;
const INVITE_RESERVATION_MS = 20 * 60 * 1000;

// V40.2 — fila simples de matchmaking automático.
// A fila é efêmera: se o servidor reiniciar, os jogadores apenas clicam em Buscar novamente.
const matchmakingQueue = new Map();
let matchmakingTimer = null;
let matchmakingDeadlineAt = null;
const MATCHMAKING_WAIT_MS = 15 * 1000;
const MATCHMAKING_MAX_PLAYERS = 5;
const rankingStore = new RankingStore();
const rankingReady = rankingStore.init().then(()=>{console.log(`[ranking] armazenamento: ${rankingStore.kind}`);return true}).catch(e=>{console.error('[ranking] falha ao iniciar:',e);return false});

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const AUTH_SESSION_SECRET = String(process.env.AUTH_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE = 'maumau_google_session';
const AUTH_TTL_SECONDS = 7 * 24 * 60 * 60;
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!GOOGLE_CLIENT_ID) console.warn('[auth] GOOGLE_CLIENT_ID não configurado. O login Google ficará bloqueado até configurar a variável no Render.');
if (!process.env.AUTH_SESSION_SECRET) console.warn('[auth] AUTH_SESSION_SECRET não configurado. Foi criada uma chave temporária; sessões serão encerradas quando o servidor reiniciar.');

function googlePlayerKey(sub) {
  // O "sub" é a identidade estável da Conta Google. O hash evita expor esse identificador
  // diretamente e mantém o mesmo playerKey em celulares/computadores diferentes.
  return `g_${crypto.createHash('sha256').update(`mau-mau-google:${sub}`).digest('hex').slice(0,40)}`;
}
function signAuthSession(user) {
  const payload = Buffer.from(JSON.stringify({
    playerKey:user.playerKey,
    name:user.name,
    email:user.email || '',
    picture:user.picture || '',
    exp:Date.now() + AUTH_TTL_SECONDS * 1000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyAuthSession(token) {
  try {
    const [payload, signature, extra] = String(token || '').split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', AUTH_SESSION_SECRET).update(payload).digest('base64url');
    const a=Buffer.from(signature), b=Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
    const session = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if (!session?.playerKey || !session?.exp || Date.now() >= Number(session.exp)) return null;
    return session;
  } catch { return null; }
}
function parseCookies(header='') {
  const out={};
  for (const part of String(header).split(';')) {
    const i=part.indexOf('='); if(i<0) continue;
    const key=part.slice(0,i).trim(); const value=part.slice(i+1).trim();
    if(!key) continue;
    try { out[key]=decodeURIComponent(value); } catch { out[key]=value; }
  }
  return out;
}
function authFromCookieHeader(header) {
  return verifyAuthSession(parseCookies(header)[AUTH_COOKIE]);
}
function setAuthCookie(req,res,token,maxAge=AUTH_TTL_SECONDS) {
  const forwarded=String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure=req.secure || forwarded==='https';
  const value=token ? encodeURIComponent(token) : '';
  const parts=[`${AUTH_COOKIE}=${value}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${maxAge}`];
  if(secure) parts.push('Secure');
  res.setHeader('Set-Cookie',parts.join('; '));
}

app.set('trust proxy', 1);
app.use(express.json({limit:'16kb'}));

app.get('/api/auth/config', (_,res)=>res.json({ok:true,configured:!!GOOGLE_CLIENT_ID,clientId:GOOGLE_CLIENT_ID || null}));
app.get('/api/auth/me', (req,res)=>{
  const session=authFromCookieHeader(req.headers.cookie);
  if(!session) return res.status(401).json({ok:false,message:'Login Google necessário.'});
  res.json({ok:true,user:{playerKey:session.playerKey,name:session.name,email:session.email,picture:session.picture}});
});
app.post('/api/auth/google', async (req,res)=>{
  try {
    if(!googleAuthClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ok:false,message:'Login Google ainda não foi configurado no servidor.'});
    const credential=String(req.body?.credential || '').trim();
    if(!credential) return res.status(400).json({ok:false,message:'Credencial Google não informada.'});
    const ticket=await googleAuthClient.verifyIdToken({idToken:credential,audience:GOOGLE_CLIENT_ID});
    const payload=ticket.getPayload();
    if(!payload?.sub) throw new Error('Conta Google sem identificador válido.');
    if(payload.email_verified === false) throw new Error('O e-mail desta Conta Google não está verificado.');
    const user={
      playerKey:googlePlayerKey(payload.sub),
      name:String(payload.name || payload.given_name || 'Jogador').trim().slice(0,60),
      email:String(payload.email || '').trim().slice(0,180),
      picture:String(payload.picture || '').trim().slice(0,500),
    };
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user});
  } catch(e) {
    console.error('[auth] falha no login Google:',e?.message || e);
    res.status(401).json({ok:false,message:'Não foi possível validar esta Conta Google. Tente novamente.'});
  }
});
app.post('/api/auth/logout', (req,res)=>{
  setAuthCookie(req,res,'',0);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ok:true, rooms:rooms.size, ranking:rankingStore.kind}));

app.get('/api/ranking', async (req,res)=>{
  try {
    const period=normalizePeriod(req.query.period);
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const rows=await rankingStore.getLeaderboard({period,mode,limit:50});
    res.json({ok:true,period,mode,timezone:'America/Porto_Velho',rows});
  } catch(e) {
    console.error('[ranking] consulta falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o ranking agora.'});
  }
});

app.get('/api/profile', async (req,res)=>{
  try {
    const playerKey=String(req.query.playerKey||'').trim().slice(0,80);
    if(!playerKey) return res.status(400).json({ok:false,message:'Jogador não informado.'});
    const period=normalizePeriod(req.query.period||'all');
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const stats=await rankingStore.getPlayerStats({playerKey,period,mode});
    res.json({ok:true,period,mode,stats});
  } catch(e) {
    console.error('[ranking] perfil falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o perfil agora.'});
  }
});

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do {
    code=''; for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(rooms.has(code));
  return code;
}

function maybeRecordFinished(room) {
  if (!room || room.status !== 'finished' || room.rankingRecorded || room.rankingRecording) return;
  const record=buildMatchRecord(room);
  const matchSerial=Number(room.matchSerial||1);
  if (!record.results.length) { room.rankingRecorded=true; return; }
  room.rankingRecording=true;
  rankingReady.then(ready=>{ if(!ready) throw new Error('Armazenamento do ranking indisponível.'); return rankingStore.recordMatch(record); }).then(inserted=>{
    // O grupo pode ter iniciado outra partida na mesma sala antes do PostgreSQL
    // concluir a gravação. Nesse caso, o snapshot antigo ainda é salvo, mas não
    // altera as flags da partida nova.
    if(Number(room.matchSerial||1)===matchSerial){
      room.rankingRecorded=true;
      room.rankingRecording=false;
      if(inserted) Engine.appendLog(room, `🏆 Resultado registrado no ranking ${record.mode==='human'?'contra pessoas':'com máquina'}.`, 'system');
    }
  }).catch(e=>{
    console.error('[ranking] gravação falhou:',e);
    if(Number(room.matchSerial||1)===matchSerial) room.rankingRecording=false;
  });
}

function emitRoom(room) {
  maybeRecordFinished(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', Engine.roomPublicState(room,p.id));
  }
  scheduleBotTurn(room);
  refreshInviteReadiness();
  const presenceSignature=`${room.status}:${room.round}:${room.players.map(p=>`${p.id}:${p.isBot?'b':'h'}`).join(',')}`;
  if(room._presenceSignature!==presenceSignature){room._presenceSignature=presenceSignature;setTimeout(broadcastPresence,0);}
}

function reconnectTimerKey(roomCode, playerId) { return `${roomCode}:${playerId}`; }
function cancelReconnectTimer(roomCode, playerId) {
  const key=reconnectTimerKey(roomCode,playerId);
  const timer=reconnectTimers.get(key);
  if(timer) clearTimeout(timer);
  reconnectTimers.delete(key);
}
function clearReconnectTimersForRoom(roomCode) {
  const prefix=`${roomCode}:`;
  for(const [key,timer] of reconnectTimers){
    if(key.startsWith(prefix)){ clearTimeout(timer); reconnectTimers.delete(key); }
  }
}
function roomWaitingForReconnect(room) {
  return !!(room && room.status==='playing' && room.players.some(p=>!p.isBot&&!p.connected&&!p.autoControlled));
}
function requireRoundNotPaused(room) {
  if(roomWaitingForReconnect(room)) throw new Error('Partida pausada: aguardando a reconexão de um jogador.');
}
function isAutomatedPlayer(player) { return !!(player && (player.isBot || player.autoControlled)); }
function scheduleReconnectTakeover(room, player) {
  const matchActive=room && (room.status==='playing' || (room.status==='between-rounds' && room.round>0));
  if(!matchActive || !player || player.isBot || player.connected) return;
  cancelReconnectTimer(room.code,player.id);
  const key=reconnectTimerKey(room.code,player.id);
  const delay=Math.max(0,Number(player.reconnectDeadlineAt||Date.now())-Date.now());
  const timer=setTimeout(()=>{
    reconnectTimers.delete(key);
    const liveRoom=rooms.get(room.code);
    if(!liveRoom || liveRoom!==room || !(liveRoom.status==='playing' || (liveRoom.status==='between-rounds' && liveRoom.round>0))) return;
    const stale=liveRoom.players.find(p=>p.id===player.id);
    if(!stale || stale.connected || stale.isBot || stale.autoControlled) return;
    stale.autoControlled=true;
    stale.reconnectDeadlineAt=null;
    Engine.appendLog(liveRoom, `🤖 ${stale.name} não retornou em 60 segundos. A Máquina assumiu temporariamente suas jogadas.`, 'system');
    io.to(liveRoom.code).emit('reconnectionEvent',{kind:'auto',playerId:stale.id,name:stale.name});
    emitRoom(liveRoom);
    broadcastPresence();
  },delay);
  if(typeof timer.unref==='function') timer.unref();
  reconnectTimers.set(key,timer);
}

function scheduleBotTurn(room) {
  if (!room || room.status !== 'playing' || room.botTimer) return;
  // Durante os 60 s de tolerância, ninguém joga. Depois, a vaga desconectada
  // passa a ser tratada pelo mesmo motor da Máquina, sem virar um jogador-bot.
  if (roomWaitingForReconnect(room)) return;
  // Se todos os humanos estiverem fora, não há motivo para a mesa se jogar sozinha.
  // A automação volta a andar assim que pelo menos uma pessoa reconectar.
  if (!room.players.some(p => !p.isBot && p.connected)) return;

  // Normalmente a Queima pertence ao jogador da vez. Na abertura da rodada, porém,
  // a Engine pode liberar a primeira carta para qualquer participante com cópia
  // exatamente igual; por isso também procuramos uma máquina fora da vez.
  const turnBot = room.players[room.currentPlayer];
  const currentBurnBot = isAutomatedPlayer(turnBot) && !turnBot.finishedRound && Engine.canBurnMatch(room,turnBot).length > 0 ? turnBot : null;
  const openingBurnBot = currentBurnBot ? null : room.players.find(p => isAutomatedPlayer(p) && !p.finishedRound && p.id !== turnBot?.id && Engine.canBurnMatch(room,p).length > 0);
  const burnBot = currentBurnBot || openingBurnBot || null;
  const quickBot = room.players.find(p => isAutomatedPlayer(p) && !p.finishedRound && p.id !== turnBot?.id && Engine.canQuickAction(room,p).length > 0);
  const actingBot = burnBot || quickBot || (isAutomatedPlayer(turnBot) && !turnBot.finishedRound ? turnBot : null);
  if (!actingBot) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom !== room || liveRoom.status !== 'playing') return;
    const liveBot = liveRoom.players.find(p => p.id === actingBot.id);
    if (!isAutomatedPlayer(liveBot) || liveBot.finishedRound) return;

    const isCurrentTurn = liveRoom.players[liveRoom.currentPlayer]?.id === liveBot.id;
    try {
      const burns = Engine.canBurnMatch(liveRoom, liveBot);
      const quicks = burns.length ? [] : Engine.canQuickAction(liveRoom, liveBot);
      if (burns.length) BotPlayer.takeBurnOpportunity(liveRoom, liveBot, Engine);
      else if (quicks.length) BotPlayer.takeQuickActionOpportunity(liveRoom, liveBot, Engine);
      else if (isCurrentTurn) BotPlayer.takeTurn(liveRoom, liveBot, Engine);
      else { emitRoom(liveRoom); return; }
    } catch (e) {
      Engine.appendLog(liveRoom, `${liveBot.name} encontrou uma jogada automática inválida: ${e.message}`, 'system');
      // Só avançamos a vez por segurança quando o erro ocorreu durante a vez
      // normal do bot. Uma tentativa de queima fora da vez nunca pula terceiros.
      if (isCurrentTurn) {
        liveBot.justDrawnCardId = null;
        liveRoom.continuationPlayerId = null;
        const idx = liveRoom.players.findIndex(p => p.id === liveBot.id);
        if (idx >= 0 && liveRoom.status === 'playing') {
          const n = liveRoom.players.length;
          let cursor = idx;
          for (let i=0; i<n; i++) {
            cursor = (cursor + liveRoom.direction + n) % n;
            if (!liveRoom.players[cursor].finishedRound) { liveRoom.currentPlayer = cursor; break; }
          }
        }
      }
    }
    emitRoom(liveRoom);
  }, burnBot ? (room.openingReaction && burnBot.id !== turnBot?.id ? 1200 : 750) : quickBot ? 950 : 1250);
  if (typeof room.botTimer.unref === 'function') room.botTimer.unref();
}

function err(socket, e) {
  socket.emit('gameError', {message: e?.message || 'Ocorreu um erro.'});
}

function ensureHost(room) {
  const humans = room.players.filter(p => !p.isBot);
  if (!humans.length) return;
  const hosts = humans.filter(p => p.host);
  if (hosts.length === 1) return;
  room.players.forEach(p => { p.host = false; });
  const nextHost = humans.find(p => p.connected) || humans[0];
  if (nextHost) nextHost.host = true;
}

function replayEligible(room) {
  return !!(room && room.status==='finished' && room.players.filter(p=>!p.isBot).length>=2 && room.players.every(p=>!p.isBot));
}

function maybeStartReplay(room) {
  if(!replayEligible(room)) return false;
  const connectedHumans=room.players.filter(p=>!p.isBot&&p.connected);
  if(connectedHumans.length<2) return false;
  const ready=new Set(Array.isArray(room.replayReadyPlayerIds)?room.replayReadyPlayerIds:[]);
  if(!connectedHumans.every(p=>ready.has(p.id))) return false;

  // Quem já saiu/desconectou depois do fim da partida não bloqueia o grupo que
  // confirmou continuar. A nova partida começa somente com humanos conectados.
  room.players=room.players.filter(p=>p.isBot||p.connected);
  ensureHost(room);
  Engine.resetMatch(room);
  Engine.startRound(room);
  Engine.appendLog(room, '🎮 Todos confirmaram. A revanche começou!', 'system');
  return true;
}

function nextBotInfo(room) {
  const bots = room.players.filter(p => p.isBot);
  const avatars = ['preta','costela','perna','homem','mulher'];
  const n = bots.length + 1;
  return {
    socketId: null,
    name: n === 1 ? 'Máquina' : `Máquina ${n}`,
    avatar: avatars[(n-1) % avatars.length],
    isBot: true,
  };
}

function addBotToRoom(room) {
  const bot = Engine.addPlayer(room, nextBotInfo(room));
  bot.connected = true;
  bot.socketId = null;
  bot.host = false;
  Engine.appendLog(room, `${bot.name} entrou na mesa como jogador automático.`, 'system');
  return bot;
}

function cancelCurrentRoundAfterLeave(room, leavingName) {
  // A saída voluntária no meio da rodada não pode deixar a mesa pausada.
  // A rodada corrente é anulada e pode ser reiniciada com os jogadores restantes.
  room.round = Math.max(0, room.round - 1);
  room.status = room.round === 0 ? 'lobby' : 'between-rounds';
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
  room.finishPendingSeven = false;
  room.roundRoles = null;
  for (const p of room.players) {
    p.hand = [];
    p.roundScore = 0;
    p.finishedRound = false;
    p.declaration = null;
    p.justDrawnCardId = null;
  }
  Engine.appendLog(room, `${leavingName} saiu da sala. A rodada em andamento foi cancelada e deverá ser reiniciada.`, 'system');
}
function withRoom(socket, fn) {
  try {
    const room = rooms.get(socket.data.roomCode);
    if (!room) throw new Error('Sala não encontrada.');
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player) throw new Error('Jogador não encontrado na sala.');
    if (!player.isBot && player.playerKey && player.playerKey !== socket.data.auth?.playerKey) throw new Error('Esta vaga pertence a outra Conta Google.');
    fn(room, player);
    emitRoom(room);
  } catch(e) { err(socket,e); }
}


const SOCIAL_EFFECTS = new Set(['applause','laugh','horn','drum','victory','wow','jogaBoca']);
const QUICK_AUDIO_MAX_MS = 15000;
const QUICK_AUDIO_MAX_BYTES = 700 * 1024;
const QUICK_AUDIO_COOLDOWN_MS = 2500;
function ensureSocial(room) {
  if (!Array.isArray(room.chat)) room.chat = [];
}
function cleanChatText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
function emitChatHistory(socket, room) {
  ensureSocial(room);
  socket.emit('chatHistory', room.chat.slice(-60));
}

// ========================= V40.1 — JOGADORES ONLINE + CONVITES =========================
function cleanPresenceName(value) {
  return String(value || 'Jogador').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,24) || 'Jogador';
}
function cleanAvatar(value) { return String(value || 'macaco').trim().slice(0,24) || 'macaco'; }
function presenceFor(playerKey) { return onlinePresence.get(String(playerKey||'')) || null; }
function registerPresenceSocket(socket) {
  const key=socket.data.auth?.playerKey; if(!key)return;
  let rec=onlinePresence.get(key);
  if(!rec){rec={playerKey:key,name:cleanPresenceName(socket.data.auth?.name),avatar:'macaco',picture:String(socket.data.auth?.picture||'').slice(0,500),sockets:new Set(),searching:false,lastSeenAt:Date.now()};onlinePresence.set(key,rec);}
  rec.sockets.add(socket.id);rec.lastSeenAt=Date.now();
  if(!rec.name)rec.name=cleanPresenceName(socket.data.auth?.name);
}
function unregisterPresenceSocket(socket) {
  const key=socket.data.auth?.playerKey,rec=onlinePresence.get(key);if(!rec)return;
  rec.sockets.delete(socket.id);rec.lastSeenAt=Date.now();
  if(!rec.sockets.size)onlinePresence.delete(key);
}
function updatePresenceFromSocket(socket,payload={}) {
  const key=socket.data.auth?.playerKey;if(!key)return;
  registerPresenceSocket(socket);
  const rec=onlinePresence.get(key);if(!rec)return;
  if(payload.name)rec.name=cleanPresenceName(payload.name);
  if(payload.avatar)rec.avatar=cleanAvatar(payload.avatar);
  rec.lastSeenAt=Date.now();
}
function roomSeatForKey(playerKey) {
  let best=null;
  for(const room of rooms.values()){
    const player=room.players.find(p=>!p.isBot&&p.playerKey===playerKey);
    if(!player)continue;
    const score=(player.connected?100:0)+(room.status==='playing'?40:room.status==='between-rounds'?30:room.status==='lobby'?20:10)+(room.round>0?5:0);
    if(!best||score>best.score)best={room,player,score};
  }
  return best;
}
function activeMultiplayerRoomForKey(playerKey, exceptCode=null) {
  for(const room of rooms.values()){
    if(room.code===exceptCode||room.status==='finished'||room.round<=0)continue;
    if(room.players.filter(p=>!p.isBot).length<2)continue;
    if(room.players.some(p=>!p.isBot&&p.playerKey===playerKey))return room;
  }
  return null;
}
function presenceStatusForKey(playerKey) {
  const rec=presenceFor(playerKey);
  const seat=roomSeatForKey(playerKey);
  if(seat?.player&&!seat.player.connected&&!seat.player.autoControlled&&seat.player.reconnectDeadlineAt>Date.now()){
    return {code:'reconnecting',emoji:'🟠',label:'Reconectando'};
  }
  if(rec?.searching)return {code:'searching',emoji:'🔎',label:'Procurando partida'};
  if(rec?.sockets?.size&&seat?.room&&seat.room.status!=='finished'){
    const humans=seat.room.players.filter(p=>!p.isBot).length;
    if(humans>=2)return {code:'multiplayer',emoji:'🎮',label:'Jogando com pessoas'};
    if(seat.room.players.some(p=>p.isBot))return {code:'bot',emoji:'🤖',label:'Jogando contra a máquina'};
  }
  return {code:'available',emoji:'🟢',label:'Disponível'};
}
function buildPresenceSnapshot() {
  const keys=new Set(onlinePresence.keys());
  // Durante os 60 s de reconexão a vaga ainda aparece, marcada como Reconectando.
  for(const room of rooms.values())for(const p of room.players){
    if(!p.isBot&&p.playerKey&&!p.connected&&!p.autoControlled&&p.reconnectDeadlineAt>Date.now())keys.add(p.playerKey);
  }
  const players=[];
  for(const key of keys){
    const rec=presenceFor(key),seat=roomSeatForKey(key),status=presenceStatusForKey(key);
    const connected=!!rec?.sockets?.size;
    players.push({
      playerKey:key,
      name:cleanPresenceName(rec?.name||seat?.player?.name||'Jogador'),
      avatar:cleanAvatar(rec?.avatar||seat?.player?.avatar||'macaco'),
      status:status.code,statusEmoji:status.emoji,statusLabel:status.label,
      connected,inviteable:connected,
    });
  }
  const order={available:0,searching:1,reconnecting:2,bot:3,multiplayer:4};
  players.sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)||a.name.localeCompare(b.name,'pt-BR'));
  return {onlineCount:[...onlinePresence.values()].filter(r=>r.sockets.size).length,players,at:Date.now()};
}
function broadcastPresence() { io.emit('presenceSnapshot',buildPresenceSnapshot()); }
function emitToPlayerKey(playerKey,event,payload) {
  const rec=presenceFor(playerKey);if(!rec)return;
  for(const socketId of rec.sockets)io.to(socketId).emit(event,payload);
}
function firstSocketForKey(playerKey) {
  const rec=presenceFor(playerKey);if(!rec)return null;
  for(const id of rec.sockets){const sock=io.sockets.sockets.get(id);if(sock)return sock;}
  return null;
}

function matchmakingSortedEntries() {
  return [...matchmakingQueue.values()].sort((a,b)=>a.joinedAt-b.joinedAt);
}
function clearMatchmakingTimer() {
  if(matchmakingTimer)clearTimeout(matchmakingTimer);
  matchmakingTimer=null;
  matchmakingDeadlineAt=null;
}
function setSearchingFlag(playerKey,value) {
  const rec=presenceFor(playerKey);
  if(rec)rec.searching=!!value;
}
function matchmakingPlayerPublic(playerKey) {
  const rec=presenceFor(playerKey);
  return {
    playerKey,
    name:cleanPresenceName(rec?.name||'Jogador'),
    avatar:cleanAvatar(rec?.avatar||'macaco'),
  };
}
function playerHasActiveRoom(playerKey) {
  for(const room of rooms.values()){
    if(room.status==='finished')continue;
    if(room.players.some(p=>!p.isBot&&p.playerKey===playerKey))return true;
  }
  return false;
}
function playerHasAcceptedInvite(playerKey) {
  return [...invitations.values()].some(inv=>inv.toKey===playerKey&&['accepted-waiting','ready'].includes(inv.status)&&inv.expiresAt>Date.now());
}
function matchmakingPayloadFor(playerKey,reason='') {
  const players=matchmakingSortedEntries().slice(0,MATCHMAKING_MAX_PLAYERS).map(e=>matchmakingPlayerPublic(e.playerKey));
  return {
    searching:matchmakingQueue.has(playerKey),
    players,
    foundCount:players.length,
    maxPlayers:MATCHMAKING_MAX_PLAYERS,
    deadlineAt:players.length>=2?matchmakingDeadlineAt:null,
    waitMs:MATCHMAKING_WAIT_MS,
    reason:reason||'',
  };
}
function emitMatchmakingState(reason='') {
  for(const entry of matchmakingSortedEntries()){
    emitToPlayerKey(entry.playerKey,'matchmakingState',matchmakingPayloadFor(entry.playerKey,reason));
  }
}
function emitMatchmakingIdle(playerKey,reason='') {
  emitToPlayerKey(playerKey,'matchmakingState',{
    searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,
    deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:reason||'',
  });
}
function pruneMatchmakingQueue() {
  let changed=false;
  for(const [key] of [...matchmakingQueue]){
    const rec=presenceFor(key);
    if(!rec?.sockets?.size||playerHasActiveRoom(key)){
      matchmakingQueue.delete(key);setSearchingFlag(key,false);changed=true;
    }
  }
  return changed;
}
function removeFromMatchmaking(playerKey,{reason='',notify=true,reevaluate=true}={}) {
  const key=String(playerKey||'');
  const existed=matchmakingQueue.delete(key);
  setSearchingFlag(key,false);
  if(existed&&notify)emitMatchmakingIdle(key,reason);
  if(reevaluate)evaluateMatchmakingQueue();
  else if(existed)broadcastPresence();
  return existed;
}
function scheduleMatchmakingCountdown() {
  if(matchmakingTimer||matchmakingQueue.size<2)return;
  matchmakingDeadlineAt=Date.now()+MATCHMAKING_WAIT_MS;
  matchmakingTimer=setTimeout(()=>{
    matchmakingTimer=null;matchmakingDeadlineAt=null;
    if(matchmakingQueue.size>=2)formMatchmakingGroup();
    else evaluateMatchmakingQueue();
  },MATCHMAKING_WAIT_MS);
  if(typeof matchmakingTimer.unref==='function')matchmakingTimer.unref();
}
function evaluateMatchmakingQueue() {
  pruneMatchmakingQueue();
  if(matchmakingQueue.size>=MATCHMAKING_MAX_PLAYERS){
    clearMatchmakingTimer();
    formMatchmakingGroup();
    return;
  }
  if(matchmakingQueue.size>=2)scheduleMatchmakingCountdown();
  else clearMatchmakingTimer();
  emitMatchmakingState();
  broadcastPresence();
}
function formMatchmakingGroup() {
  pruneMatchmakingQueue();
  const candidates=matchmakingSortedEntries().slice(0,MATCHMAKING_MAX_PLAYERS);
  if(candidates.length<2){evaluateMatchmakingQueue();return;}
  clearMatchmakingTimer();

  const live=candidates.map(entry=>({
    entry,
    socket:firstSocketForKey(entry.playerKey),
    rec:presenceFor(entry.playerKey),
  })).filter(x=>x.socket&&x.rec?.sockets?.size&&!playerHasActiveRoom(x.entry.playerKey));

  if(live.length<2){
    for(const x of candidates){
      if(!live.some(y=>y.entry.playerKey===x.playerKey)){matchmakingQueue.delete(x.playerKey);setSearchingFlag(x.playerKey,false);}
    }
    evaluateMatchmakingQueue();
    return;
  }

  const group=live.slice(0,MATCHMAKING_MAX_PLAYERS);
  for(const x of group){matchmakingQueue.delete(x.entry.playerKey);setSearchingFlag(x.entry.playerKey,false);}
  const code=roomCode();
  let room=null;
  try{
    const host=group[0];
    room=Engine.createRoom(code,{
      socketId:host.socket.id,token:crypto.randomUUID(),
      name:cleanPresenceName(host.rec.name),avatar:cleanAvatar(host.rec.avatar),
      playerKey:host.entry.playerKey,
    });
    rooms.set(code,room);ensureSocial(room);
    const seatByKey=new Map([[host.entry.playerKey,room.players[0]]]);

    for(const x of group.slice(1)){
      const p=Engine.addPlayer(room,{
        socketId:x.socket.id,token:crypto.randomUUID(),
        name:cleanPresenceName(x.rec.name),avatar:cleanAvatar(x.rec.avatar),
        playerKey:x.entry.playerKey,
      });
      seatByKey.set(x.entry.playerKey,p);
    }

    const matchPlayers=group.map(x=>matchmakingPlayerPublic(x.entry.playerKey));
    const names=matchPlayers.map(x=>x.name);
    Engine.appendLog(room,`🔎 Busca automática encontrou ${group.length} jogadores. Partida iniciada.`, 'system');

    for(const x of group){
      const p=seatByKey.get(x.entry.playerKey);
      x.socket.data.roomCode=code;x.socket.data.playerId=p.id;x.socket.join(code);
      updatePresenceFromSocket(x.socket,{name:p.name,avatar:p.avatar});
      emitToPlayerKey(x.entry.playerKey,'matchmakingState',{searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:'Partida encontrada.'});
      x.socket.emit('matchmakingMatched',{code,count:group.length,players:matchPlayers});
      x.socket.emit('joined',{code,playerId:p.id,token:p.token,source:'matchmaking',matchSize:group.length,matchPlayers:names});
      emitChatHistory(x.socket,room);
    }

    Engine.startRound(room);
    emitRoom(room);
    broadcastPresence();
  }catch(e){
    if(room){
      for(const x of group){try{x.socket.leave(code)}catch{};x.socket.data.roomCode=null;x.socket.data.playerId=null;}
      rooms.delete(code);
    }
    for(const x of group){
      if(presenceFor(x.entry.playerKey)?.sockets?.size&&!playerHasActiveRoom(x.entry.playerKey)){
        matchmakingQueue.set(x.entry.playerKey,{playerKey:x.entry.playerKey,joinedAt:x.entry.joinedAt||Date.now()});
        setSearchingFlag(x.entry.playerKey,true);
        emitToPlayerKey(x.entry.playerKey,'matchmakingError',{message:e?.message||'Não foi possível formar a partida agora.'});
      }
    }
  }
  evaluateMatchmakingQueue();
}
function ensureInviteReservations(room) {
  if(!(room.inviteReservations instanceof Map))room.inviteReservations=new Map();
  const now=Date.now();
  for(const [key,resv] of room.inviteReservations){if(!resv||resv.expiresAt<=now)room.inviteReservations.delete(key);}
  return room.inviteReservations;
}
function releaseReservation(room,playerKey,inviteId=null) {
  if(!room)return;const map=ensureInviteReservations(room),cur=map.get(playerKey);
  if(cur&&(!inviteId||cur.inviteId===inviteId))map.delete(playerKey);
}
function roomHasInviteCapacity(room,playerKey=null) {
  if(!room||room.status==='finished')return false;
  const existing=playerKey&&room.players.some(p=>!p.isBot&&p.playerKey===playerKey);
  if(existing)return true;
  const map=ensureInviteReservations(room);
  let reserved=0;for(const key of map.keys())if(key!==playerKey)reserved++;
  return room.players.length+reserved<5;
}
function roomAllowsInviteEventually(room,playerKey=null) {
  if(!room||room.status==='finished'||!roomHasInviteCapacity(room,playerKey))return false;
  if(room.status==='between-rounds'&&room.round>=room.rules.allowLateJoinUntilRound)return false;
  if(room.status==='playing'&&room.round>=room.rules.allowLateJoinUntilRound)return false;
  return true;
}
function roomJoinableNow(room,playerKey=null) {
  if(!roomAllowsInviteEventually(room,playerKey))return false;
  return room.status==='lobby'||room.status==='between-rounds';
}
function invalidateInvitesForRoom(code,message='A sala do convite não está mais disponível.') {
  for(const inv of [...invitations.values()]){
    if(inv.targetRoomCode!==code||!['pending','accepted-waiting','ready'].includes(inv.status))continue;
    expireInvite(inv,message,'unavailable');
  }
}
function invalidateInvitesFromPlayerInRoom(playerKey,code) {
  for(const inv of [...invitations.values()]){
    if(inv.fromKey===playerKey&&inv.targetRoomCode===code&&['pending','accepted-waiting','ready'].includes(inv.status)){
      expireInvite(inv,'Quem enviou o convite saiu da sala.','unavailable');
    }
  }
}
function clearInviteTimer(inviteId){const t=inviteTimers.get(inviteId);if(t)clearTimeout(t);inviteTimers.delete(inviteId);}
function scheduleInviteTimer(invite,ms){
  clearInviteTimer(invite.id);
  const timer=setTimeout(()=>{
    inviteTimers.delete(invite.id);
    const live=invitations.get(invite.id);if(!live)return;
    if(live.status==='pending')expireInvite(live,'O convite expirou.','expired');
    else if(['accepted-waiting','ready'].includes(live.status))expireInvite(live,'A reserva do convite expirou.','expired');
  },Math.max(0,ms));
  if(typeof timer.unref==='function')timer.unref();inviteTimers.set(invite.id,timer);
}
function invitePublic(invite){return {id:invite.id,fromKey:invite.fromKey,fromName:invite.fromName,fromAvatar:invite.fromAvatar,status:invite.status,expiresAt:invite.expiresAt,targetRoomCode:invite.targetRoomCode,waitingReason:invite.waitingReason||null};}
function expireInvite(invite,message,status='expired'){
  if(!invite)return;clearInviteTimer(invite.id);
  const room=rooms.get(invite.targetRoomCode);releaseReservation(room,invite.toKey,invite.id);
  invite.status=status;invite.message=message;invite.updatedAt=Date.now();
  emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status,message});
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status,message:`Convite para ${invite.toName||'jogador'}: ${message}`});
  setTimeout(()=>invitations.delete(invite.id),60000).unref?.();
}
function completeInvite(invite,message='Convite concluído.'){
  clearInviteTimer(invite.id);releaseReservation(rooms.get(invite.targetRoomCode),invite.toKey,invite.id);
  invite.status='completed';invite.updatedAt=Date.now();
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'completed',message:`✅ ${invite.toName||'Jogador'} entrou na sua mesa.`});
  emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status:'completed',message});
  setTimeout(()=>invitations.delete(invite.id),60000).unref?.();
}
function currentSocketRoom(socket){const room=rooms.get(socket.data.roomCode);if(!room)return null;const player=room.players.find(p=>p.id===socket.data.playerId);return player?{room,player}:null;}
function detachSocketFromRoom(socket,{emitLeft=false,message=''}={}) {
  const code=socket.data.roomCode,playerId=socket.data.playerId,room=rooms.get(code);
  if(!room){socket.data.roomCode=null;socket.data.playerId=null;if(emitLeft)socket.emit('leftRoom',{message});return;}
  const idx=room.players.findIndex(p=>p.id===playerId);
  if(idx<0){socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;if(emitLeft)socket.emit('leftRoom',{message});return;}
  const leaving=room.players[idx];cancelReconnectTimer(code,leaving.id);invalidateInvitesFromPlayerInRoom(leaving.playerKey,code);
  const wasPlaying=room.status==='playing';room.players.splice(idx,1);
  if(!room.players.length||room.players.every(p=>p.isBot)){
    if(room.botTimer)clearTimeout(room.botTimer);clearReconnectTimersForRoom(code);rooms.delete(code);invalidateInvitesForRoom(code);
  }else{
    if(wasPlaying)cancelCurrentRoundAfterLeave(room,leaving.name);else Engine.appendLog(room,`${leaving.name} saiu da sala.`,'system');
    if(room.players.length===1&&room.status==='between-rounds'&&room.round===0)room.status='lobby';
    ensureHost(room);emitRoom(room);
  }
  socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;
  if(emitLeft)socket.emit('leftRoom',{message});
  broadcastPresence();
}
function createRoomForSocket(socket,profileData={}) {
  removeFromMatchmaking(socket.data.auth?.playerKey,{reason:'Busca encerrada porque você iniciou um convite.',notify:true});
  const code=roomCode();
  const room=Engine.createRoom(code,{socketId:socket.id,token:crypto.randomUUID(),name:profileData.name||socket.data.auth.name,avatar:profileData.avatar||'macaco',playerKey:socket.data.auth.playerKey});
  rooms.set(code,room);ensureSocial(room);const p=room.players[0];
  socket.data.roomCode=code;socket.data.playerId=p.id;socket.join(code);
  updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
  socket.emit('joined',{code,playerId:p.id,token:p.token,source:'invite-host'});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return room;
}
function joinSocketIntoRoom(socket,room,{inviteId=null}={}) {
  const key=socket.data.auth.playerKey;
  removeFromMatchmaking(key,{reason:'Busca encerrada porque você aceitou um convite.',notify:true});
  if(!roomJoinableNow(room,key))throw new Error(room.status==='playing'?'Aguarde o intervalo da rodada para entrar.':'A sala não possui vaga disponível para este convite.');
  let p=room.players.find(x=>!x.isBot&&x.playerKey===key);
  if(p){
    cancelReconnectTimer(room.code,p.id);if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
    if(p.socketId&&p.socketId!==socket.id)io.to(p.socketId).emit('sessionReplaced');
    p=Engine.reconnectPlayer(room,p.token,socket.id);
  }else{
    p=Engine.addPlayer(room,{socketId:socket.id,token:crypto.randomUUID(),name:presenceFor(key)?.name||socket.data.auth.name,avatar:presenceFor(key)?.avatar||'macaco',playerKey:key});
  }
  releaseReservation(room,key,inviteId);socket.data.roomCode=room.code;socket.data.playerId=p.id;socket.join(room.code);
  updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
  socket.emit('joined',{code:room.code,playerId:p.id,token:p.token,source:'invite',inviteId});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return p;
}
function reserveInviteSeat(invite) {
  const room=rooms.get(invite.targetRoomCode);if(!room||!roomAllowsInviteEventually(room,invite.toKey))return false;
  const map=ensureInviteReservations(room);map.set(invite.toKey,{inviteId:invite.id,expiresAt:invite.expiresAt});return true;
}
function senderStillInDestination(invite,room){return !!room?.players.some(p=>!p.isBot&&p.playerKey===invite.fromKey);}
function setInviteWaiting(invite,reason,message) {
  invite.status='accepted-waiting';invite.waitingReason=reason;invite.expiresAt=Date.now()+INVITE_RESERVATION_MS;invite.updatedAt=Date.now();
  if(!reserveInviteSeat(invite)){expireInvite(invite,'A vaga deixou de estar disponível.','unavailable');return;}
  scheduleInviteTimer(invite,INVITE_RESERVATION_MS);
  emitToPlayerKey(invite.toKey,'inviteWaiting',{...invitePublic(invite),message});
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'accepted-waiting',message:`✅ ${invite.toName||'Jogador'} aceitou. ${message}`});
}
function refreshInviteReadiness(){
  for(const inv of invitations.values()){
    if(!['accepted-waiting','ready'].includes(inv.status))continue;
    if(inv.expiresAt<=Date.now()){expireInvite(inv,'A reserva do convite expirou.','expired');continue;}
    const dest=rooms.get(inv.targetRoomCode);
    if(!dest||!senderStillInDestination(inv,dest)){expireInvite(inv,'A sala do convite não está mais disponível.','unavailable');continue;}
    if(!roomAllowsInviteEventually(dest,inv.toKey)){expireInvite(inv,'A sala não pode mais receber novos jogadores.','unavailable');continue;}
    const sourceMulti=activeMultiplayerRoomForKey(inv.toKey,dest.code);
    if(sourceMulti){inv.waitingReason='finish-current';continue;}
    if(!roomJoinableNow(dest,inv.toKey)){inv.waitingReason='destination-round';continue;}
    if(inv.status!=='ready'){
      inv.status='ready';inv.waitingReason=null;inv.updatedAt=Date.now();
      emitToPlayerKey(inv.toKey,'inviteReady',{...invitePublic(inv),message:'🎮 Seu convite está pronto. Entre na nova mesa quando quiser.'});
      emitToPlayerKey(inv.fromKey,'inviteStatus',{inviteId:inv.id,status:'ready',message:`🎮 ${inv.toName||'Jogador'} já pode entrar na sua mesa.`});
    }
  }
}
function emitPendingInvitesFor(socket){
  const key=socket.data.auth?.playerKey;if(!key)return;
  for(const inv of invitations.values()){
    if(inv.toKey!==key)continue;
    if(inv.expiresAt<=Date.now())continue;
    if(inv.status==='pending')socket.emit('inviteReceived',invitePublic(inv));
    else if(inv.status==='ready')socket.emit('inviteReady',{...invitePublic(inv),message:'🎮 Seu convite está pronto.'});
    else if(inv.status==='accepted-waiting')socket.emit('inviteWaiting',{...invitePublic(inv),message:inv.waitingReason==='finish-current'?'Termine sua partida atual. A vaga está reservada.':'Aguardando o intervalo da sala convidante. A vaga está reservada.'});
  }
}

io.use((socket,next)=>{
  const session=authFromCookieHeader(socket.handshake.headers.cookie);
  if(!session) return next(new Error('AUTH_REQUIRED'));
  socket.data.auth=session;
  next();
});

io.on('connection', socket => {
  registerPresenceSocket(socket);
  socket.emit('presenceSnapshot',buildPresenceSnapshot());
  socket.emit('matchmakingState',matchmakingPayloadFor(socket.data.auth.playerKey));
  emitPendingInvitesFor(socket);
  setTimeout(broadcastPresence,0);

  socket.on('presenceProfile', payload => {
    updatePresenceFromSocket(socket,payload||{});broadcastPresence();
  });

  socket.on('startMatchmaking', payload => {
    try{
      updatePresenceFromSocket(socket,payload?.profile||{});
      const key=socket.data.auth.playerKey;
      const current=currentSocketRoom(socket);
      if(current&&current.room.status!=='finished')throw new Error('Saia da sala atual antes de buscar jogadores.');
      if(playerHasActiveRoom(key))throw new Error('Você já possui uma vaga ativa em outra mesa.');
      if(playerHasAcceptedInvite(key))throw new Error('Você possui um convite aceito com vaga reservada. Entre nele ou cancele a reserva antes de buscar.');
      if(matchmakingQueue.has(key)){
        socket.emit('matchmakingState',matchmakingPayloadFor(key));
        return;
      }
      const rec=presenceFor(key);if(!rec?.sockets?.size)throw new Error('Sua conexão ainda não está pronta.');
      rec.searching=true;
      matchmakingQueue.set(key,{playerKey:key,joinedAt:Date.now()});
      evaluateMatchmakingQueue();
    }catch(e){err(socket,e);}
  });

  socket.on('cancelMatchmaking', () => {
    try{
      const key=socket.data.auth.playerKey;
      if(removeFromMatchmaking(key,{reason:'Busca cancelada.'}))socket.emit('matchmakingCancelled',{message:'Busca cancelada.'});
      else emitMatchmakingIdle(key,'Você não está na fila.');
    }catch(e){err(socket,e);}
  });

  socket.on('createRoom', payload => {
    try {
      removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Busca encerrada porque você criou uma sala.',notify:true});
      const code = roomCode();
      const room = Engine.createRoom(code, {
        socketId:socket.id,
        token:payload?.token,
        name:payload?.name || socket.data.auth.name,
        avatar:payload?.avatar,
        playerKey:socket.data.auth.playerKey,
      });
      rooms.set(code,room);
      ensureSocial(room);
      if (payload?.withBot) addBotToRoom(room);
      const p=room.players[0];
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitChatHistory(socket, room);
      emitRoom(room);
      broadcastPresence();
    } catch(e){err(socket,e);}
  });

  socket.on('joinRoom', payload => {
    try {
      const code=String(payload?.code||'').trim().toUpperCase();
      const room=rooms.get(code);
      if(!room) throw new Error('Sala não encontrada.');
      ensureSocial(room);
      let p = null;
      if (payload?.token) {
        const existing = room.players.find(x => x.token === payload.token);
        if (existing?.playerKey && existing.playerKey !== socket.data.auth.playerKey) {
          throw new Error('Esta vaga pertence a outra Conta Google.');
        }
        if (existing?.socketId && existing.socketId !== socket.id) {
          io.to(existing.socketId).emit('sessionReplaced');
        }
        const wasDisconnected=!!(existing && !existing.connected);
        const wasAutoControlled=!!existing?.autoControlled;
        if(existing){
          cancelReconnectTimer(room.code,existing.id);
          // Pode haver uma jogada automática já agendada para esta vaga.
          if(room.botTimer){ clearTimeout(room.botTimer); room.botTimer=null; }
        }
        p = Engine.reconnectPlayer(room,payload.token,socket.id);
        if(p && wasDisconnected){
          Engine.appendLog(room, wasAutoControlled
            ? `🟢 ${p.name} voltou e retomou seu lugar da Máquina.`
            : `🟢 ${p.name} voltou à mesa dentro do prazo de reconexão.`, 'system');
          socket.emit('reconnectionEvent',{kind:wasAutoControlled?'returned-from-auto':'returned',playerId:p.id,name:p.name});
          io.to(room.code).except(socket.id).emit('reconnectionEvent',{kind:'returned',playerId:p.id,name:p.name});
        }
      }
      if(!p){
        const byKey=room.players.find(x=>!x.isBot&&x.playerKey===socket.data.auth.playerKey);
        if(byKey){
          cancelReconnectTimer(room.code,byKey.id);if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
          if(byKey.socketId&&byKey.socketId!==socket.id)io.to(byKey.socketId).emit('sessionReplaced');
          p=Engine.reconnectPlayer(room,byKey.token,socket.id);
        }
      }
      if(!p){
        if(!roomHasInviteCapacity(room,socket.data.auth.playerKey))throw new Error('A sala está completa ou possui vaga reservada por convite.');
        p = Engine.addPlayer(room,{socketId:socket.id, token:payload?.token, name:payload?.name || socket.data.auth.name, avatar:payload?.avatar, playerKey:socket.data.auth.playerKey});
      }
      removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Busca encerrada porque você entrou em uma sala.',notify:true});
      const acceptedManualInvite=[...invitations.values()].find(i=>i.toKey===socket.data.auth.playerKey&&i.targetRoomCode===code&&['accepted-waiting','ready'].includes(i.status));
      releaseReservation(room,socket.data.auth.playerKey);
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitChatHistory(socket, room);
      emitRoom(room);
      broadcastPresence();
      if(acceptedManualInvite)completeInvite(acceptedManualInvite,'✅ Você entrou na mesa reservada.');
    } catch(e){err(socket,e);}
  });

  socket.on('addBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode adicionar uma máquina.');
    if(room.status==='playing') throw new Error('Adicione máquinas somente fora de uma rodada.');
    if(!roomHasInviteCapacity(room,null)) throw new Error('Há vaga reservada por convite; não é possível adicionar outra máquina agora.');
    addBotToRoom(room);
    broadcastPresence();
  }));

  socket.on('removeBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode remover uma máquina.');
    if(room.status==='playing') throw new Error('Remova máquinas somente fora de uma rodada.');
    const bot = [...room.players].reverse().find(x => x.isBot);
    if(!bot) throw new Error('Não há jogador automático para remover.');
    room.players = room.players.filter(x => x.id !== bot.id);
    Engine.appendLog(room, `${bot.name} foi removido da mesa.`, 'system');
    ensureHost(room);
    broadcastPresence();
  }));

  socket.on('leaveRoom', () => {
    try {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      const room = rooms.get(code);
      if (!room) {
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.emit('leftRoom');
        return;
      }

      const idx = room.players.findIndex(p => p.id === playerId);
      if (idx < 0) {
        socket.leave(code);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.emit('leftRoom');
        return;
      }

      const leaving = room.players[idx];
      cancelReconnectTimer(code,leaving.id);
      invalidateInvitesFromPlayerInRoom(leaving.playerKey,code);
      const wasPlaying = room.status === 'playing';
      const wasFinished = room.status === 'finished';
      room.players.splice(idx, 1);
      if(Array.isArray(room.replayReadyPlayerIds)) room.replayReadyPlayerIds=room.replayReadyPlayerIds.filter(id=>id!==leaving.id);

      if (!room.players.length || room.players.every(p => p.isBot)) {
        if (room.botTimer) clearTimeout(room.botTimer);
        clearReconnectTimersForRoom(code);
        rooms.delete(code);
        invalidateInvitesForRoom(code);
      } else {
        if (wasPlaying) cancelCurrentRoundAfterLeave(room, leaving.name);
        else Engine.appendLog(room, `${leaving.name} saiu da sala.`, 'system');

        // Se restou somente um participante durante uma partida já iniciada,
        // ele retorna à espera. As regras de entrada tardia continuam valendo.
        if (room.players.length === 1 && room.status === 'between-rounds' && room.round === 0) {
          room.status = 'lobby';
        }
        ensureHost(room);
        if(wasFinished) maybeStartReplay(room);
        emitRoom(room);
      }

      socket.leave(code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      socket.emit('leftRoom');
      broadcastPresence();
    } catch(e) { err(socket,e); }
  });

  socket.on('playAgain', () => withRoom(socket,(room,p)=>{
    if(!replayEligible(room)) throw new Error('Jogar de novo está disponível somente após uma partida entre jogadores humanos.');
    if(p.isBot || !p.connected) throw new Error('Jogador não disponível para continuar.');
    if(!Array.isArray(room.replayReadyPlayerIds)) room.replayReadyPlayerIds=[];
    if(!room.replayReadyPlayerIds.includes(p.id)){
      room.replayReadyPlayerIds.push(p.id);
      Engine.appendLog(room, `🔁 ${p.name} confirmou que quer jogar de novo.`, 'system');
    }
    maybeStartReplay(room);
    broadcastPresence();
  }));

  socket.on('startRound', () => withRoom(socket,(room,p)=>{
    if(room.status==='playing') throw new Error('A rodada já está em andamento.');

    // Failover do anfitrião: se o anfitrião atual estiver realmente desconectado,
    // qualquer jogador conectado pode assumir a sala e iniciar a próxima rodada.
    const connectedHost = room.players.find(x => x.host && x.connected);
    if(!p.host && connectedHost) throw new Error('Somente o anfitrião pode iniciar a rodada.');
    if(!connectedHost) {
      room.players.forEach(x => { x.host = false; });
      p.host = true;
      Engine.appendLog(room, `${p.name} assumiu como anfitrião da sala.`, 'system');
    }

    Engine.startRound(room);
    broadcastPresence();
  }));

  socket.on('declare', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.declare(room,p.id,payload?.type); }));
  socket.on('playCard', payload => withRoom(socket,(room,p)=> {
    // V29: após comprar, o jogador pode jogar qualquer carta válida da mão.
    requireRoundNotPaused(room);
    Engine.playCard(room,p.id,payload.cardId,payload.chosenSuit);
  }));
  socket.on('playDoubleCard', payload => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    Engine.playDoubleCard(room,p.id,payload?.firstCardId,payload?.secondCardId,payload?.chosenSuit);
  }));
  socket.on('burnMatch', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,payload.cardId); }));
  socket.on('quickAction', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.quickAction(room,p.id,payload.cardId); }));
  // Compatibilidade temporária com clientes V10/V9.
  socket.on('burnPair', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,payload.cardId); }));
  socket.on('endBurn', () => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.endBurnContinuation(room,p.id); }));
  socket.on('draw', () => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.drawAction(room,p.id); }));
  socket.on('passTurn', () => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    const oldPlayerId = p.id;
    Engine.passTurn(room,p.id);
    socket.emit('passConfirmed', {
      playerId: oldPlayerId,
      nextPlayerId: room.players[room.currentPlayer]?.id || null,
    });
  }));
  // Compatibilidade com clientes V10/V11.
  socket.on('passAfterDraw', () => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    const oldPlayerId = p.id;
    Engine.passAfterDraw(room,p.id);
    socket.emit('passConfirmed', {
      playerId: oldPlayerId,
      nextPlayerId: room.players[room.currentPlayer]?.id || null,
    });
  }));


  socket.on('sendInvite', payload => {
    try{
      updatePresenceFromSocket(socket,payload?.profile||{});
      const nowInvite=Date.now();
      if(socket.data.lastInviteAt&&nowInvite-socket.data.lastInviteAt<900)throw new Error('Aguarde um instante antes de enviar outro convite.');
      socket.data.lastInviteAt=nowInvite;
      const fromKey=socket.data.auth.playerKey,toKey=String(payload?.targetPlayerKey||'').trim();
      if(!toKey||toKey===fromKey)throw new Error('Escolha outro jogador para convidar.');
      const targetPresence=presenceFor(toKey);
      if(!targetPresence?.sockets?.size)throw new Error('Esse jogador não está disponível online agora.');
      const duplicate=[...invitations.values()].find(i=>i.fromKey===fromKey&&i.toKey===toKey&&['pending','accepted-waiting','ready'].includes(i.status)&&i.expiresAt>Date.now());
      if(duplicate)throw new Error('Já existe um convite ativo para esse jogador.');

      let current=currentSocketRoom(socket),room=current?.room;
      if(room?.players.some(p=>!p.isBot&&p.playerKey===toKey))throw new Error('Esse jogador já está na sua sala.');
      if(room?.status==='finished'){detachSocketFromRoom(socket);room=null;}
      if(!room)room=createRoomForSocket(socket,payload?.profile||{});
      if(!roomAllowsInviteEventually(room,toKey))throw new Error(room.players.length>=5?'Sua mesa já está completa.':'Esta partida já passou do limite para entrada de novos jogadores.');
      const fromPlayer=room.players.find(p=>!p.isBot&&p.playerKey===fromKey);
      if(!fromPlayer)throw new Error('Não foi possível identificar sua vaga na sala.');
      const targetName=cleanPresenceName(targetPresence.name||'Jogador');
      const now=Date.now(),invite={
        id:`inv-${now}-${crypto.randomBytes(4).toString('hex')}`,fromKey,toKey,
        fromName:cleanPresenceName(fromPlayer.name||presenceFor(fromKey)?.name),fromAvatar:cleanAvatar(fromPlayer.avatar||presenceFor(fromKey)?.avatar),
        toName:targetName,targetRoomCode:room.code,status:'pending',createdAt:now,updatedAt:now,expiresAt:now+INVITE_TTL_MS,waitingReason:null,
      };
      invitations.set(invite.id,invite);scheduleInviteTimer(invite,INVITE_TTL_MS);
      emitToPlayerKey(toKey,'inviteReceived',invitePublic(invite));
      socket.emit('inviteSent',{inviteId:invite.id,targetPlayerKey:toKey,targetName,expiresAt:invite.expiresAt});
    }catch(e){err(socket,e);}
  });

  socket.on('respondInvite', payload => {
    try{
      const invite=invitations.get(String(payload?.inviteId||''));
      if(!invite||invite.toKey!==socket.data.auth.playerKey)throw new Error('Convite não encontrado.');
      if(invite.status!=='pending'||invite.expiresAt<=Date.now())throw new Error('Este convite já expirou ou foi respondido.');
      clearInviteTimer(invite.id);
      if(!payload?.accept){
        invite.status='refused';invite.updatedAt=Date.now();
        emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:`❌ ${invite.toName||'Jogador'} recusou o convite.`});
        emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:'Convite recusado.'});
        setTimeout(()=>invitations.delete(invite.id),60000).unref?.();return;
      }
      const dest=rooms.get(invite.targetRoomCode);
      if(!dest||!senderStillInDestination(invite,dest))throw new Error('A sala do convite não está mais disponível.');
      invite.expiresAt=Date.now()+INVITE_RESERVATION_MS;
      if(!reserveInviteSeat(invite))throw new Error('A sala ficou sem vagas antes da sua resposta.');
      removeFromMatchmaking(invite.toKey,{reason:'Busca encerrada porque você aceitou um convite.',notify:true});

      const current=currentSocketRoom(socket),source=current?.room;
      const activeMulti=activeMultiplayerRoomForKey(invite.toKey,dest.code);
      if(activeMulti){
        setInviteWaiting(invite,'finish-current','Sua vaga está reservada. Termine sua partida atual para entrar.');
        return;
      }

      const sourceIsBot=!!(source&&source.code!==dest.code&&source.round>0&&source.status!=='finished'&&source.players.filter(p=>!p.isBot).length===1&&source.players.some(p=>p.isBot));
      if(roomJoinableNow(dest,invite.toKey)){
        if(source&&source.code!==dest.code)detachSocketFromRoom(socket);
        joinSocketIntoRoom(socket,dest,{inviteId:invite.id});completeInvite(invite,'✅ Você entrou na nova mesa.');return;
      }

      // Contra a máquina, aceitar encerra imediatamente a atividade e não registra resultado.
      if(sourceIsBot){
        detachSocketFromRoom(socket,{emitLeft:true,message:'🤖 Partida contra a máquina encerrada sem resultado. Aguardando a sala do convite ficar disponível.'});
      }else if(source&&source.code!==dest.code&&source.round===0){
        detachSocketFromRoom(socket,{emitLeft:true,message:'✅ Convite aceito. Aguardando a sala ficar disponível.'});
      }
      setInviteWaiting(invite,'destination-round','Convite aceito. Aguardando o intervalo da rodada da nova sala.');
    }catch(e){err(socket,e);}
  });

  socket.on('claimInvite', payload => {
    try{
      const invite=invitations.get(String(payload?.inviteId||''));
      if(!invite||invite.toKey!==socket.data.auth.playerKey||!['accepted-waiting','ready'].includes(invite.status))throw new Error('Convite reservado não encontrado.');
      if(invite.expiresAt<=Date.now())throw new Error('A reserva deste convite expirou.');
      const dest=rooms.get(invite.targetRoomCode);
      if(!dest||!senderStillInDestination(invite,dest))throw new Error('A sala do convite não está mais disponível.');
      if(activeMultiplayerRoomForKey(invite.toKey,dest.code))throw new Error('Conclua primeiro sua partida multiplayer atual.');
      if(!roomJoinableNow(dest,invite.toKey))throw new Error('Aguarde o intervalo da rodada da nova sala.');
      const current=currentSocketRoom(socket);if(current?.room?.code!==dest.code&&current)detachSocketFromRoom(socket);
      joinSocketIntoRoom(socket,dest,{inviteId:invite.id});completeInvite(invite,'✅ Você entrou na nova mesa.');
    }catch(e){err(socket,e);}
  });

  socket.on('cancelAcceptedInvite', payload => {
    try{
      const invite=invitations.get(String(payload?.inviteId||''));
      if(!invite||invite.toKey!==socket.data.auth.playerKey||!['accepted-waiting','ready'].includes(invite.status))return;
      expireInvite(invite,'O jogador cancelou a reserva do convite.','cancelled');
    }catch(e){err(socket,e);}
  });


  socket.on('chatMessage', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para conversar.');
      ensureSocial(room);

      const now = Date.now();
      if (socket.data.lastChatAt && now - socket.data.lastChatAt < 550) {
        throw new Error('Aguarde um instante antes de enviar outra mensagem.');
      }
      const text = cleanChatText(payload?.text);
      if (!text) return;
      socket.data.lastChatAt = now;

      const message = {
        id: `chat-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        text,
      };
      room.chat.push(message);
      if (room.chat.length > 60) room.chat.splice(0, room.chat.length - 60);
      io.to(room.code).emit('chatMessage', message);
    } catch(e) { err(socket,e); }
  });


  // Áudio Rápido: repasse efêmero entre os jogadores da sala. Não é salvo no ranking,
  // PostgreSQL nem no histórico de chat. O cliente limita a gravação a 15 s e o servidor
  // também aplica limites de duração declarada, tamanho e frequência de envio.
  socket.on('voiceMessage', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para enviar áudio.');

      const now = Date.now();
      if (socket.data.lastVoiceAt && now - socket.data.lastVoiceAt < QUICK_AUDIO_COOLDOWN_MS) {
        throw new Error('Aguarde alguns segundos antes de enviar outro áudio.');
      }

      const durationMs = Math.round(Number(payload?.durationMs || 0));
      if (!Number.isFinite(durationMs) || durationMs < 200 || durationMs > QUICK_AUDIO_MAX_MS + 400) {
        throw new Error('O Áudio Rápido deve ter no máximo 15 segundos.');
      }

      const mime = String(payload?.mime || '').toLowerCase().slice(0,80);
      if (!/^audio\/(webm|ogg|mp4|mpeg)(;|$)/.test(mime)) throw new Error('Formato de áudio não suportado.');

      const raw = payload?.audio;
      let audio;
      if (Buffer.isBuffer(raw)) audio = raw;
      else if (raw instanceof ArrayBuffer) audio = Buffer.from(raw);
      else if (ArrayBuffer.isView(raw)) audio = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      else throw new Error('Áudio inválido.');
      if (audio.length < 80 || audio.length > QUICK_AUDIO_MAX_BYTES) throw new Error('O arquivo de áudio ficou grande demais. Grave novamente.');

      socket.data.lastVoiceAt = now;
      io.to(room.code).emit('voiceMessage', {
        id: `voice-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        durationMs: Math.min(durationMs, QUICK_AUDIO_MAX_MS),
        mime,
        audio,
      });
    } catch(e) { err(socket,e); }
  });

  socket.on('sendEffect', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para enviar efeito.');
      const effect = String(payload?.effect || '');
      if (!SOCIAL_EFFECTS.has(effect)) throw new Error('Efeito sonoro inválido.');

      const now = Date.now();
      if (socket.data.lastEffectAt && now - socket.data.lastEffectAt < 900) return;
      socket.data.lastEffectAt = now;
      io.to(room.code).emit('soundEffect', {
        id: `fx-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        effect,
      });
    } catch(e) { err(socket,e); }
  });

  socket.on('updateProfile', payload => withRoom(socket,(room,p)=>{
    if(room.status==='playing') throw new Error('Altere nome/avatar somente fora de uma rodada.');
    if(payload?.name) p.name=String(payload.name).slice(0,24);
    if(payload?.avatar) p.avatar=String(payload.avatar).slice(0,24);
    updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
    broadcastPresence();
  }));

  socket.on('disconnect', () => {
    const presenceKey=socket.data.auth?.playerKey;
    queueMicrotask(()=>{
      unregisterPresenceSocket(socket);
      if(!presenceFor(presenceKey)?.sockets?.size)removeFromMatchmaking(presenceKey,{reason:'Busca encerrada porque a conexão foi perdida.',notify:false});
      else broadcastPresence();
      refreshInviteReadiness();
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room=rooms.get(code);
    if(!room) return;
    const p=room.players.find(x=>x.id===playerId);

    // Se outra aba já reconectou com o mesmo token, este socket é antigo.
    // Não devemos marcar o jogador como desconectado por causa da aba antiga.
    if(p && p.socketId === socket.id){
      p.connected=false;
      p.socketId=null;
      p.disconnectedAt=Date.now();

      // Uma jogada automática que já estava agendada é cancelada: durante a janela
      // de 60 s a mesa fica realmente congelada.
      if(room.botTimer){ clearTimeout(room.botTimer); room.botTimer=null; }

      // IMPORTANTE: não retiramos o papel de anfitrião imediatamente. Um F5, uma
      // ligação ou a troca Wi-Fi/5G não podem destruir a vaga do jogador.
      const matchActive=room.status==='playing' || (room.status==='between-rounds' && room.round>0);
      if(matchActive){
        p.autoControlled=false;
        p.reconnectDeadlineAt=Date.now()+RECONNECT_GRACE_MS;
        Engine.appendLog(room, `🔴 ${p.name} perdeu a conexão. 60 segundos para retornar.`, 'system');
        io.to(room.code).emit('reconnectionEvent',{kind:'lost',playerId:p.id,name:p.name,deadlineAt:p.reconnectDeadlineAt});
        scheduleReconnectTakeover(room,p);
        emitRoom(room);
        broadcastPresence();
        return;
      }

      p.autoControlled=false;
      p.reconnectDeadlineAt=Date.now()+RECONNECT_GRACE_MS;
      emitRoom(room);
      broadcastPresence();

      // Antes da primeira rodada a cadeira fica reservada por 60 s. Se o jogador
      // não retornar, a vaga é removida porque ainda não existe partida a preservar.
      const timer=setTimeout(() => {
        reconnectTimers.delete(reconnectTimerKey(code,playerId));
        const currentRoom = rooms.get(code);
        if (!currentRoom || !['lobby','between-rounds'].includes(currentRoom.status)) return;
        const stale = currentRoom.players.find(x => x.id === playerId);
        if (!stale || stale.connected || stale.autoControlled) return;

        const leavingName = stale.name;
        currentRoom.players = currentRoom.players.filter(x => x.id !== playerId);
        if (!currentRoom.players.length || currentRoom.players.every(p => p.isBot)) {
          if (currentRoom.botTimer) clearTimeout(currentRoom.botTimer);
          clearReconnectTimersForRoom(code);
          rooms.delete(code);
          invalidateInvitesForRoom(code);
          broadcastPresence();
          return;
        }

        ensureHost(currentRoom);
        Engine.appendLog(currentRoom, `${leavingName} foi removido após 60 segundos desconectado.`, 'system');
        emitRoom(currentRoom);
        broadcastPresence();
      }, RECONNECT_GRACE_MS);
      if(typeof timer.unref==='function') timer.unref();
      reconnectTimers.set(reconnectTimerKey(code,playerId),timer);
    }
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    const humans=room.players.filter(p=>!p.isBot);
    const allHumansGone=!humans.length || humans.every(p=>!p.connected);
    if(allHumansGone && now-room.createdAt>6*60*60*1000) {
      if (room.botTimer) clearTimeout(room.botTimer);
      clearReconnectTimersForRoom(code);
      rooms.delete(code);
      invalidateInvitesForRoom(code);
    }
  }
}, 30*60*1000).unref();

server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));
