const socket = io({autoConnect:false});
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let passPending=false;
let state=null, pendingCard=null, pendingBurn=false, pendingDouble=null, soundOn=localStorage.getItem('maumauSound')!=='off', previousHandIds=new Set();
const turnVibrationStorage='maumauTurnVibrationV1';
let turnVibrationOn=localStorage.getItem(turnVibrationStorage)!=='off';
let yourTurnAlertTimer=null;
const musicOnStorage='maumauMusicOnV1', musicVolumeStorage='maumauMusicVolumeV1';
let musicOn=localStorage.getItem(musicOnStorage)!=='off';
let musicVolume=Math.min(.45,Math.max(0,Number(localStorage.getItem(musicVolumeStorage)??.18)||.18));
let musicUnlocked=false;
let chatMessages=[], unreadChat=0, activeSideTab='log';
const QUICK_AUDIO_MAX_MS=15000, QUICK_AUDIO_MAX_BYTES=700*1024;
let voiceRecorder=null,voiceStream=null,voiceChunks=[],voiceStartedAt=0,voiceTickTimer=null,voiceMaxTimer=null,voiceCancelOnStop=false,voiceDraft=null;
const playingVoiceAudios=new Set();
const sessionKey='maumauSessionV1';
let googleUser=null;
// V40.1 — presença global e convites efêmeros. A lista é unificada pela playerKey Google.
let onlinePlayers=[],onlineCount=0,presenceSyncTimer=null;
const inviteCards=new Map();
// V40.2 — estado da busca automática recebido do servidor.
let matchmaking={searching:false,players:[],foundCount:0,maxPlayers:5,deadlineAt:null,waitMs:15000,reason:''};
let matchmakingDialogDismissed=false;
let rankingPeriod='day', rankingMode='human';
let lastShownRoundReviewId=null;
const pileSideStorage='maumauPileSideV1';
let pileSide=localStorage.getItem(pileSideStorage)==='deck-left'?'deck-left':'deck-right';
const handSortStorage='maumauHandSortV1';
let handSort=localStorage.getItem(handSortStorage)==='suit'?'suit':'rank';

const rankSortOrder={A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13};
const suitSortOrder={hearts:1,diamonds:2,clubs:3,spades:4};
function compareHandCards(a,b){
  const rankA=rankSortOrder[a.rank]??99,rankB=rankSortOrder[b.rank]??99;
  const suitA=suitSortOrder[a.suit]??99,suitB=suitSortOrder[b.suit]??99;
  if(handSort==='suit') return suitA-suitB||rankA-rankB||String(a.id).localeCompare(String(b.id));
  return rankA-rankB||suitA-suitB||String(a.id).localeCompare(String(b.id));
}
function updateHandSortButton(){
  const btn=$('#sortHandBtn');if(!btn)return;
  if(handSort==='suit'){
    btn.textContent='♠ Naipe';
    btn.title='Organização atual: por naipe. Clique para organizar por número.';
  }else{
    btn.textContent='🔢 Número';
    btn.title='Organização atual: por número. Clique para organizar por naipe.';
  }
  btn.setAttribute('aria-label',btn.title);
}
function toggleHandSort(){
  handSort=handSort==='rank'?'suit':'rank';
  localStorage.setItem(handSortStorage,handSort);
  updateHandSortButton();
  if(state?.me) renderHand();
  toast(handSort==='rank'?'🔢 Mão organizada por número.':'♠ Mão organizada por naipe.');
}

function applyPileSide(mode=pileSide){
  pileSide=mode==='deck-left'?'deck-left':'deck-right';
  const draw=$('#drawPile'),discard=$('#discardPile'),btn=$('#pileSideBtn');
  if(draw&&discard){
    const piles=draw.parentElement;
    // Ordem forçada por JS para não depender de media queries ou cache de regras antigas.
    if(piles) piles.style.setProperty('flex-direction','row','important');
    if(pileSide==='deck-right'){
      discard.style.setProperty('order','1','important');
      draw.style.setProperty('order','2','important');
    }else{
      draw.style.setProperty('order','1','important');
      discard.style.setProperty('order','2','important');
    }
  }
  if(btn){
    btn.dataset.side=pileSide;
    btn.title=pileSide==='deck-right'
      ? 'Atual: carta da mesa à esquerda e baralho à direita. Clique para inverter.'
      : 'Atual: baralho à esquerda e carta da mesa à direita. Clique para inverter.';
    btn.setAttribute('aria-label',btn.title);
  }
  localStorage.setItem(pileSideStorage,pileSide);
}

function togglePileSide(){
  applyPileSide(pileSide==='deck-right'?'deck-left':'deck-right');
  toast(pileSide==='deck-right'
    ? '🃏 Carta da mesa à esquerda • baralho à direita.'
    : '🂠 Baralho à esquerda • carta da mesa à direita.');
}

const suitGlyph={hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'};
const suitName={hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'};
const specialName={A:'PULA',Q:'INVERTE',J:'ESCOLHE NAIPE','7':'+2',K:'ANTERIOR +1','8':'ANTERIOR +2'};
const effectCatalog={applause:{emoji:'👏',label:'Aplausos'},laugh:{emoji:'😂',label:'Risada'},horn:{emoji:'📯',label:'Corneta'},drum:{emoji:'🥁',label:'Tambores'},victory:{emoji:'🎉',label:'Vitória'},wow:{emoji:'😱',label:'Uau!'},jogaBoca:{emoji:'📢',label:'JOGA BOCA ABERTA!'}};

const avatarCatalog={
  macaco:{label:'Macaco',src:'assets/avatars/macaco.webp',grupo:'Animais'},
  boi:{label:'Boi',src:'assets/avatars/boi.webp',grupo:'Animais'},
  jacare:{label:'Jacaré',src:'assets/avatars/jacare.webp',grupo:'Animais'},
  veado:{label:'Veado',src:'assets/avatars/veado.webp',grupo:'Animais'},
  cachorro:{label:'Cachorro',src:'assets/avatars/cachorro.webp',grupo:'Animais'},
  preta:{label:'Tela Preta',src:'assets/avatars/preta.webp',grupo:'Mascotes'},
  costela:{label:'Costela',src:'assets/avatars/costela.webp',grupo:'Mascotes'},
  perna:{label:'Perna',src:'assets/avatars/perna.webp',grupo:'Mascotes'},
  homem:{label:'Homem',src:'assets/avatars/homem.webp',grupo:'Pessoas'},
  mulher:{label:'Mulher',src:'assets/avatars/mulher.webp',grupo:'Pessoas'},
};
function avatarInfo(value){return avatarCatalog[value]||null}
function avatarHTML(value,size='md'){
  const info=avatarInfo(value);
  if(info) return `<img class="avatar-photo avatar-${size}" src="${info.src}" alt="${info.label}" title="${info.label}" />`;
  return `<span class="avatar-emoji avatar-${size}">${esc(value||'🂡')}</span>`;
}
function setAvatarSelection(value='macaco'){
  const chosen=avatarCatalog[value]?value:'macaco';
  const input=$('#avatarSelect');if(input)input.value=chosen;
  $$('.avatar-option').forEach(btn=>{
    const active=btn.dataset.avatar===chosen;
    btn.classList.toggle('selected',active);
    btn.setAttribute('aria-checked',active?'true':'false');
  });
  schedulePresenceSync();
}

function permanentPlayerKey(){ return googleUser?.playerKey || ''; }
function profile(){ return {name:$('#nameInput').value.trim()||googleUser?.name||'Jogador',avatar:$('#avatarSelect').value,playerKey:permanentPlayerKey()}; }
function syncPresenceProfile(){
  if(!googleUser||!socket.connected)return;
  const p=profile();socket.emit('presenceProfile',{name:p.name,avatar:p.avatar});
}
function schedulePresenceSync(){
  if(presenceSyncTimer)clearTimeout(presenceSyncTimer);
  presenceSyncTimer=setTimeout(()=>{presenceSyncTimer=null;syncPresenceProfile()},180);
}
function authStatus(message='',kind=''){
  const el=$('#authStatus');if(!el)return;
  el.textContent=message;el.className=`auth-status ${kind}`.trim();
}
function showAuthGate(message='Entre com sua Conta Google para continuar.'){
  googleUser=null;onlinePlayers=[];onlineCount=0;inviteCards.clear();
  matchmaking={searching:false,players:[],foundCount:0,maxPlayers:5,deadlineAt:null,waitMs:15000,reason:''};matchmakingDialogDismissed=false;
  renderOnlinePresence();renderInviteInbox();renderMatchmaking();
  $('#musicPanel')?.classList.add('hidden');
  if(socket.connected) socket.disconnect();
  $('#game')?.classList.add('hidden');
  $('#landing')?.classList.add('hidden');
  $('#authGate')?.classList.remove('hidden');
  authStatus(message);
  stopMusic();
}
function applyGoogleUser(user,{connect=true}={}){
  const priorRoomSession=saved();
  if(priorRoomSession && priorRoomSession.playerKey!==user?.playerKey) clearSession();
  googleUser=user;
  $('#authGate')?.classList.add('hidden');
  if(!state) $('#landing')?.classList.remove('hidden');
  const name=$('#googleAccountName'),email=$('#googleAccountEmail'),photo=$('#googleAccountPhoto');
  if(name)name.textContent=user?.name||'Jogador';
  if(email)email.textContent=user?.email||'';
  if(photo){
    if(user?.picture){photo.src=user.picture;photo.classList.remove('hidden')}else{photo.removeAttribute('src');photo.classList.add('hidden')}
  }
  const input=$('#nameInput');
  if(input && (!input.value || input.value==='Jogador')) input.value=(user?.name||'Jogador').slice(0,24);
  if(connect && !socket.connected) socket.connect();
  else if(socket.connected) syncPresenceProfile();
  updateMusicUI();setTimeout(()=>{preloadMusic();syncMusicToState()},250);
}
function waitForGoogleIdentity(timeout=10000){
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const tick=()=>{
      if(window.google?.accounts?.id) return resolve(window.google.accounts.id);
      if(Date.now()-started>=timeout) return reject(new Error('Biblioteca de login do Google não carregou. Verifique sua internet e tente novamente.'));
      setTimeout(tick,120);
    };tick();
  });
}
async function handleGoogleCredential(response){
  try{
    authStatus('Validando sua Conta Google...');
    const res=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response?.credential||''})});
    const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
    if(!res.ok||!data.ok) throw new Error(data.message||'Não foi possível entrar com Google.');
    applyGoogleUser(data.user);
    authStatus('Conta Google conectada.','success');
    toast(`✅ Bem-vindo, ${data.user?.name||'Jogador'}!`);
  }catch(e){authStatus(e.message||'Falha no login Google.','error')}
}
async function renderGoogleSignIn(){
  const target=$('#googleSignInButton');if(!target)return;
  try{
    authStatus('Carregando login Google...');
    const cfgRes=await fetch('/api/auth/config');
    const cfg=await cfgRes.json();
    if(!cfg?.configured||!cfg?.clientId) throw new Error('Login Google ainda não foi configurado no servidor.');
    const gis=await waitForGoogleIdentity();
    target.innerHTML='';
    gis.initialize({client_id:cfg.clientId,callback:handleGoogleCredential,auto_select:false,cancel_on_tap_outside:false});
    const buttonWidth=Math.min(300,Math.max(220,window.innerWidth-72));
    gis.renderButton(target,{theme:'outline',size:'large',shape:'pill',text:'signin_with',logo_alignment:'left',width:buttonWidth});
    authStatus('Escolha sua Conta Google para entrar.');
  }catch(e){authStatus(e.message||'Não foi possível carregar o login Google.','error')}
}
async function initializeGoogleAuth(){
  try{
    const res=await fetch('/api/auth/me',{cache:'no-store'});
    const data=await res.json().catch(()=>({ok:false}));
    if(res.ok&&data.ok&&data.user){applyGoogleUser(data.user);return;}
  }catch{}
  showAuthGate('Entre com sua Conta Google para continuar.');
  renderGoogleSignIn();
}
async function logoutGoogle(){
  if(state) return toast('Saia da sala antes de desconectar a Conta Google.');
  try{await fetch('/api/auth/logout',{method:'POST'});}catch{}
  clearSession();
  googleUser=null;
  if(socket.connected)socket.disconnect();
  try{window.google?.accounts?.id?.disableAutoSelect?.()}catch{}
  showAuthGate('Você saiu da Conta Google. Entre novamente para jogar.');
  renderGoogleSignIn();
}
function saved(){try{return JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{return null}}
function saveSession(data){localStorage.setItem(sessionKey,JSON.stringify(data))}
function clearSession(){localStorage.removeItem(sessionKey)}
function setConnection(status){
  const chip=$('#connectionChip'); if(!chip) return;
  chip.className=`connection-chip ${status}`;
  chip.textContent=status==='online'?'● Online':status==='offline'?'● Sem conexão':'● Conectando';
}

function vibrationSupported(){return typeof navigator.vibrate==='function'}
function updateVibrationUI(){
  const btn=$('#vibrationBtn');if(!btn)return;
  const supported=vibrationSupported();
  btn.classList.toggle('hidden',!supported);
  btn.textContent=turnVibrationOn?'📳':'📵';
  btn.classList.toggle('vibration-off',!turnVibrationOn);
  btn.title=turnVibrationOn?'Vibração de SUA VEZ ativada':'Vibração de SUA VEZ desativada';
  btn.setAttribute('aria-label',btn.title);
  btn.setAttribute('aria-pressed',turnVibrationOn?'true':'false');
}
function vibrateYourTurn(){
  if(!turnVibrationOn||!vibrationSupported())return;
  try{navigator.vibrate(0);navigator.vibrate([70,45,110]);}catch{}
}
function showYourTurnAlert(){
  const el=$('#yourTurnAlert');if(!el)return;
  if(yourTurnAlertTimer)clearTimeout(yourTurnAlertTimer);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  yourTurnAlertTimer=setTimeout(()=>el.classList.remove('show'),1850);
}
function newLogEntries(prev,next){
  if(!next?.log?.length)return [];
  if(!prev?.log?.length)return next.log;
  const oldIds=new Set(prev.log.map(x=>x?.id).filter(Boolean));
  return next.log.filter(x=>!x?.id||!oldIds.has(x.id));
}
function shouldCueMyTurn(prev,next){
  if(!next?.me||next.status!=='playing'||next.paused||next.currentPlayerId!==next.me.id)return false;
  if(!prev||prev.status!=='playing')return true;
  if(prev.paused&&!next.paused)return true;
  if(prev.currentPlayerId!==next.currentPlayerId)return true;
  // Em partidas com 2 jogadores, Ás ou Dama podem devolver a vez ao mesmo
  // jogador sem alterar currentPlayerId. Detectamos essa nova jogada pelo
  // descarte de uma carta e pelo registro do efeito especial.
  const before=Number(prev.me?.hand?.length??prev.players?.find(p=>p.id===next.me.id)?.cardCount??0);
  const after=Number(next.me?.hand?.length??0);
  if(after>=before)return false;
  return newLogEntries(prev,next).some(e=>e?.kind==='special'&&/perdeu a vez|joga novamente/i.test(String(e.message||'')));
}
function triggerYourTurnCue(){
  if(!state?.me||state.status!=='playing'||state.paused||state.currentPlayerId!==state.me.id)return;
  showYourTurnAlert();
  setTimeout(()=>playGameSound('yourTurn'),90);
  setTimeout(vibrateYourTurn,110);
}

function audioCtx(){
  try{
    const ac=audioCtx.ac||(audioCtx.ac=new (window.AudioContext||window.webkitAudioContext)());
    if(ac.state==='suspended') ac.resume().catch(()=>{});
    return ac;
  }catch{return null}
}

const musicCatalog={
  lobby:{file:'/assets/music/lobby_mesa_aberta.mp3',label:'Mesa Aberta'},
  gameA:{file:'/assets/music/mesa_de_mau_mau_a.mp3',label:'Mesa de Mau-Mau • A'},
  gameB:{file:'/assets/music/mesa_de_mau_mau_b.mp3',label:'Mesa de Mau-Mau • B'},
  tension:{file:'/assets/music/ultima_carta.mp3',label:'Última Carta'},
  review:{file:'/assets/music/conferencia_rodada.mp3',label:'Conferência da Rodada'},
  roundWin:{file:'/assets/music/vitoria_rodada.mp3',label:'Vitória da Rodada',stinger:true},
  champion:{file:'/assets/music/campeao_partida.mp3',label:'Campeão da Partida',stinger:true}
};
const musicEngine={
  buffers:new Map(),loading:new Map(),current:null,currentKey:null,desiredKey:null,
  loopBus:null,stingerBus:null,speechDuck:1,speechDuckToken:0,voiceDuck:1,stingerDuck:1,stingerTimer:null
};
function musicNodes(){
  const ac=audioCtx();if(!ac)return null;
  if(!musicEngine.loopBus){
    musicEngine.loopBus=ac.createGain();musicEngine.stingerBus=ac.createGain();
    musicEngine.loopBus.connect(ac.destination);musicEngine.stingerBus.connect(ac.destination);
  }
  refreshMusicBusGains(true);
  return ac;
}
function refreshMusicBusGains(instant=false){
  if(!musicEngine.loopBus||!musicEngine.stingerBus)return;
  const ac=musicEngine.loopBus.context,now=ac.currentTime;
  const base=musicOn?musicVolume:0;
  const loopTarget=base*musicEngine.speechDuck*musicEngine.voiceDuck*musicEngine.stingerDuck;
  const stingerTarget=base*musicEngine.speechDuck*musicEngine.voiceDuck*.95;
  for(const [gain,target] of [[musicEngine.loopBus.gain,loopTarget],[musicEngine.stingerBus.gain,stingerTarget]]){
    gain.cancelScheduledValues(now);
    if(instant) gain.setValueAtTime(target,now);
    else{gain.setValueAtTime(gain.value,now);gain.linearRampToValueAtTime(target,now+.16)}
  }
}
async function loadMusicBuffer(key){
  if(musicEngine.buffers.has(key))return musicEngine.buffers.get(key);
  if(musicEngine.loading.has(key))return musicEngine.loading.get(key);
  const item=musicCatalog[key];if(!item)return null;
  const job=(async()=>{
    const ac=musicNodes();if(!ac)return null;
    const response=await fetch(item.file,{cache:'force-cache'});
    if(!response.ok)throw new Error(`Falha ao carregar ${item.label}`);
    const buffer=await ac.decodeAudioData(await response.arrayBuffer());
    musicEngine.buffers.set(key,buffer);musicEngine.loading.delete(key);return buffer;
  })().catch(err=>{musicEngine.loading.delete(key);console.warn('[music]',err);return null});
  musicEngine.loading.set(key,job);return job;
}
function preferredGameMusicKey(){
  const code=String(state?.code||'MAUMAU');
  let hash=0;for(const ch of code)hash=(hash*31+ch.charCodeAt(0))>>>0;
  return hash%2===0?'gameA':'gameB';
}
function desiredMusicKey(){
  if(!googleUser)return null;
  if(!state)return 'lobby';
  if(state.status==='lobby')return 'lobby';
  if(state.status==='playing'){
    const atOne=(state.players||[]).some(p=>!p.finishedRound&&Number(p.cardCount)===1);
    return atOne?'tension':preferredGameMusicKey();
  }
  if(state.status==='between-rounds'||state.status==='finished')return 'review';
  return 'lobby';
}
async function switchMusic(key,{fade=1.15}={}){
  musicEngine.desiredKey=key;
  updateMusicUI();
  if(!musicOn||!musicUnlocked||!key)return;
  if(musicEngine.currentKey===key&&musicEngine.current)return;
  const buffer=await loadMusicBuffer(key);
  if(!buffer||musicEngine.desiredKey!==key||!musicOn||!musicUnlocked)return;
  const ac=musicNodes();if(!ac)return;
  const src=ac.createBufferSource(),gain=ac.createGain(),now=ac.currentTime;
  src.buffer=buffer;src.loop=true;gain.gain.setValueAtTime(0,now);
  src.connect(gain).connect(musicEngine.loopBus);src.start(now+.015);
  gain.gain.linearRampToValueAtTime(1,now+fade);
  const prior=musicEngine.current;
  musicEngine.current={source:src,gain,key};musicEngine.currentKey=key;
  if(prior){
    prior.gain.gain.cancelScheduledValues(now);prior.gain.gain.setValueAtTime(prior.gain.gain.value,now);
    prior.gain.gain.linearRampToValueAtTime(0,now+fade);
    setTimeout(()=>{try{prior.source.stop()}catch{};try{prior.source.disconnect();prior.gain.disconnect()}catch{}},(fade+.15)*1000);
  }
  updateMusicUI();
}
function stopMusic({fade=.45}={}){
  musicEngine.desiredKey=null;
  const prior=musicEngine.current;if(!prior){musicEngine.currentKey=null;updateMusicUI();return}
  const ac=prior.gain.context,now=ac.currentTime;
  prior.gain.gain.cancelScheduledValues(now);prior.gain.gain.setValueAtTime(prior.gain.gain.value,now);
  prior.gain.gain.linearRampToValueAtTime(0,now+fade);
  musicEngine.current=null;musicEngine.currentKey=null;
  setTimeout(()=>{try{prior.source.stop()}catch{};try{prior.source.disconnect();prior.gain.disconnect()}catch{}},(fade+.12)*1000);
  updateMusicUI();
}
function syncMusicToState(){
  const key=desiredMusicKey();
  if(!key){stopMusic();return}
  switchMusic(key);
}
function unlockMusic(){
  if(musicUnlocked)return;
  musicUnlocked=true;musicNodes();syncMusicToState();
}
function beginMusicSpeechDuck(){
  const token=++musicEngine.speechDuckToken;
  musicEngine.speechDuck=.28;refreshMusicBusGains(false);
  return ()=>{
    if(token!==musicEngine.speechDuckToken)return;
    musicEngine.speechDuck=1;refreshMusicBusGains(false);
  };
}
function refreshQuickAudioMusicDuck(){
  const recording=!!voiceRecorder&&voiceRecorder.state==='recording';
  musicEngine.voiceDuck=(recording||playingVoiceAudios.size)?0.18:1;
  refreshMusicBusGains(false);
}
async function playMusicStinger(key){
  if(!musicOn||!musicUnlocked)return;
  const item=musicCatalog[key];if(!item?.stinger)return;
  const buffer=await loadMusicBuffer(key);if(!buffer||!musicOn)return;
  const ac=musicNodes();if(!ac)return;
  if(musicEngine.stingerTimer)clearTimeout(musicEngine.stingerTimer);
  musicEngine.stingerDuck=.34;refreshMusicBusGains(false);
  const src=ac.createBufferSource(),g=ac.createGain(),now=ac.currentTime;
  src.buffer=buffer;g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(1,now+.08);
  const tail=Math.max(.18,buffer.duration-.45);g.gain.setValueAtTime(1,now+tail);g.gain.linearRampToValueAtTime(0,now+buffer.duration);
  src.connect(g).connect(musicEngine.stingerBus);src.start(now+.01);
  src.onended=()=>{try{src.disconnect();g.disconnect()}catch{}};
  musicEngine.stingerTimer=setTimeout(()=>{musicEngine.stingerDuck=1;refreshMusicBusGains(false)},Math.max(500,(buffer.duration-.2)*1000));
}
function maybeMusicStinger(prev,next){
  if(!prev||prev.status!=='playing'||!next)return;
  if(next.status==='finished')playMusicStinger('champion');
  else if(next.status==='between-rounds')playMusicStinger('roundWin');
}
function setMusicEnabled(enabled){
  musicOn=!!enabled;localStorage.setItem(musicOnStorage,musicOn?'on':'off');
  if(musicOn){unlockMusic();refreshMusicBusGains(false);syncMusicToState();toast('🎵 Música ativada.');}
  else{refreshMusicBusGains(false);toast('🔇 Música desligada.');}
  updateMusicUI();
}
function setMusicVolume(value){
  musicVolume=Math.min(.45,Math.max(0,Number(value)||0));
  localStorage.setItem(musicVolumeStorage,String(musicVolume));refreshMusicBusGains(false);updateMusicUI();
}
function updateMusicUI(){
  const buttons=$$('.music-btn'),toggle=$('#musicToggle'),slider=$('#musicVolume'),value=$('#musicVolumeValue'),now=$('#musicNow');
  for(const btn of buttons){btn.textContent='🎵';btn.classList.toggle('music-off',!musicOn);btn.title=musicOn?'Música da mesa':'Música desligada';btn.setAttribute('aria-label',musicOn?'Abrir configurações de música':'Abrir configurações de música — música desligada');}
  if(toggle){toggle.textContent=musicOn?'🎵 Música ligada':'🔇 Música desligada';toggle.classList.toggle('active',musicOn)}
  if(slider)slider.value=String(Math.round(musicVolume*100));
  if(value)value.textContent=`${Math.round(musicVolume*100)}%`;
  if(now){
    if(!musicOn) now.textContent='Música desativada';
    else if(!musicUnlocked) now.textContent='Toque na tela para iniciar';
    else if(musicEngine.currentKey) now.textContent=`Tocando: ${musicCatalog[musicEngine.currentKey]?.label||'Mau-Mau'}`;
    else if(musicEngine.desiredKey) now.textContent=`Carregando: ${musicCatalog[musicEngine.desiredKey]?.label||'Mau-Mau'}`;
    else now.textContent='Aguardando a mesa';
  }
}
function preloadMusic(){
  if(!googleUser)return;
  // O carregamento começa em baixa prioridade depois do login; o navegador mantém os arquivos em cache.
  const run=()=>Promise.allSettled(['lobby','gameA','gameB','tension','review','roundWin','champion'].map(loadMusicBuffer));
  if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:2500});else setTimeout(run,900);
}

function tone(ac,freq,start,dur,type='sine',gain=.035){
  if(!ac)return;
  const o=ac.createOscillator(),g=ac.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,start);
  g.gain.setValueAtTime(gain,start);g.gain.exponentialRampToValueAtTime(.001,start+dur);
  o.connect(g).connect(ac.destination);o.start(start);o.stop(start+dur+.02);
}
function noiseBurst(ac,start,dur=.08,gain=.025){
  if(!ac)return;
  const len=Math.max(1,Math.floor(ac.sampleRate*dur));
  const buffer=ac.createBuffer(1,len,ac.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
  const src=ac.createBufferSource(),g=ac.createGain(),filter=ac.createBiquadFilter();
  src.buffer=buffer;filter.type='bandpass';filter.frequency.value=1500;filter.Q.value=.7;
  g.gain.value=gain;src.connect(filter).connect(g).connect(ac.destination);src.start(start);
}
function playGameSound(type='play'){
  if(!soundOn) return;
  const ac=audioCtx(); if(!ac)return;
  const t=ac.currentTime+.015;
  const seq=(notes,shape='sine',gain=.032)=>notes.forEach(([freq,off,dur])=>tone(ac,freq,t+off,dur,shape,gain));
  if(type==='play'){
    noiseBurst(ac,t,.035,.018); tone(ac,420,t,.045,'triangle',.024);
  } else if(type==='draw'){
    noiseBurst(ac,t,.085,.026); tone(ac,210,t+.02,.07,'sine',.022);
  } else if(type==='yourTurn'){
    // Campainha curta em três notas: perceptível sem competir com vozes ou música.
    seq([[659,0,.075],[880,.085,.085],[1175,.18,.14]],'triangle',.031);
    seq([[523,.01,.12],[784,.11,.13]],'sine',.014);
  } else if(type==='pass'){
    seq([[430,0,.055],[330,.07,.075]],'sine',.024);
  } else if(type==='burn'){
    noiseBurst(ac,t,.16,.03); seq([[520,0,.06],[760,.055,.08],[1040,.12,.12]],'sawtooth',.026);
  } else if(type==='quick'){
    seq([[980,0,.045],[1320,.05,.065],[880,.10,.055]],'square',.018);
  } else if(type==='double'){
    noiseBurst(ac,t,.032,.018); noiseBurst(ac,t+.105,.032,.018); seq([[470,0,.045],[470,.105,.045]],'triangle',.025);
  } else if(type==='reverse'){
    seq([[660,0,.07],[520,.08,.07],[660,.16,.09]],'triangle',.027);
  } else if(type==='skip'){
    seq([[620,0,.045],[310,.065,.075]],'square',.019);
  } else if(type==='suit'){
    seq([[523,0,.07],[659,.075,.07],[784,.15,.10]],'sine',.027);
  } else if(type==='seven'){
    seq([[310,0,.07],[245,.08,.08],[185,.17,.12]],'sawtooth',.022);
  } else if(type==='penalty'){
    seq([[180,0,.10],[135,.11,.13]],'sawtooth',.022);
  } else if(type==='mau'){
    seq([[740,0,.07],[980,.08,.07],[1240,.16,.15]],'triangle',.036);
  } else if(type==='opponentMau'){
    // Alerta forte e inconfundível quando um adversário realmente fica com 1 carta.
    noiseBurst(ac,t,.18,.052); noiseBurst(ac,t+.23,.16,.048);
    seq([[880,0,.11],[1175,.12,.13],[880,.27,.11],[1320,.40,.22]],'square',.065);
    seq([[440,.03,.18],[587,.30,.18]],'sawtooth',.038);
  } else if(type==='round'){
    for(let i=0;i<7;i++) noiseBurst(ac,t+i*.055,.045,.014+Math.random()*.006);
    seq([[392,.05,.08],[523,.16,.08],[659,.27,.11]],'triangle',.018);
  } else if(type==='winner'){
    seq([[523,0,.11],[659,.12,.11],[784,.24,.11],[1046,.36,.28]],'triangle',.038);
  } else if(type==='champion'){
    seq([[523,0,.12],[659,.12,.12],[784,.24,.12],[1046,.36,.18],[1318,.55,.30]],'triangle',.043);
    for(let i=0;i<10;i++) noiseBurst(ac,t+.18+i*.055,.045,.012);
  } else if(type==='chat'){
    seq([[720,0,.045],[900,.055,.065]],'sine',.018);
  } else if(type==='error'){
    seq([[180,0,.11],[150,.08,.14]],'square',.018);
  } else {
    tone(ac,420,t,.055,'sine',.028);
  }
}
function soundForLog(entry){
  if(!entry)return null;
  const m=String(entry.message||'');
  if(entry.kind==='champion') return 'champion';
  if(entry.kind==='winner') return 'winner';
  if(entry.kind==='burn') return 'burn';
  if(entry.kind==='quick') return 'quick';
  if(entry.kind==='mau') return 'mau';
  if(entry.kind==='penalty') return 'penalty';
  if(entry.kind==='draw') return 'draw';
  if(entry.kind==='round') return 'round';
  if(entry.kind==='turn' && /passou a vez/i.test(m)) return 'pass';
  if(entry.kind==='play' && /CARTA DUPLA/i.test(m)) return 'double';
  if(entry.kind==='play') return 'play';
  if(entry.kind==='special'){
    if(/Dama|inverteu o sentido/i.test(m)) return 'reverse';
    if(/Ás|perdeu a vez/i.test(m)) return 'skip';
    if(/escolheu|naipe/i.test(m)) return 'suit';
    if(/7|cadeia/i.test(m)) return 'seven';
    if(/Rei|Oito|comprou/i.test(m)) return 'penalty';
    return 'play';
  }
  return null;
}
function speakMauMau(){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    // Evita sobreposição caso dois avisos sejam disparados quase ao mesmo tempo.
    window.speechSynthesis.cancel();
    const releaseMusicDuck=beginMusicSpeechDuck();
    const utterance=new SpeechSynthesisUtterance('Mau-Mau!');
    utterance.onend=utterance.onerror=releaseMusicDuck;
    utterance.lang='pt-BR';
    utterance.rate=.92;
    utterance.pitch=1.12;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function speakOpponentMauMau(name='Adversário'){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    window.speechSynthesis.cancel();
    const safeName=String(name||'Adversário').slice(0,24);
    const releaseMusicDuck=beginMusicSpeechDuck();
    const utterance=new SpeechSynthesisUtterance(`Atenção! ${safeName} está de Mau-Mau! Uma carta!`);
    utterance.onend=utterance.onerror=releaseMusicDuck;
    utterance.lang='pt-BR';
    utterance.rate=.86;
    utterance.pitch=.96;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function speakJogaBocaAberta(){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    window.speechSynthesis.cancel();
    const releaseMusicDuck=beginMusicSpeechDuck();
    const utterance=new SpeechSynthesisUtterance('JOGA BOCA ABERTA!');
    utterance.onend=utterance.onerror=releaseMusicDuck;
    utterance.lang='pt-BR';
    // Volume máximo permitido pelo navegador. Ritmo mais lento e voz firme
    // deixam a frase mais destacada nos celulares e computadores.
    utterance.rate=.78;
    utterance.pitch=1.02;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function announceOpponentMauMau(player){
  if(!player || player.id===state?.me?.id) return;
  playGameSound('opponentMau');
  showReaction(player.name||'Adversário','🚨','MAU-MAU! • 1 CARTA',player.avatar);
  setTimeout(()=>speakOpponentMauMau(player.name||'Adversário'),280);
}
function detectOpponentMauMau(prev,next){
  if(!prev?.players || !next?.players || next.status!=='playing') return;
  for(const player of next.players){
    if(player.id===next.me?.id || player.finishedRound || player.cardCount!==1) continue;
    const before=prev.players.find(p=>p.id===player.id);
    if(before && before.cardCount>1){
      announceOpponentMauMau(player);
    }
  }
}
function beep(type='play'){ playGameSound(type); }
function playSocialEffect(effect){
  if(!soundOn)return;
  const ac=audioCtx(); if(!ac)return;
  const t=ac.currentTime+.02;
  if(effect==='applause'){
    for(let i=0;i<12;i++) noiseBurst(ac,t+i*.045+Math.random()*.018,.055,.018+Math.random()*.014);
  } else if(effect==='laugh'){
    [520,440,540,410,500,370].forEach((f,i)=>tone(ac,f,t+i*.095,.075,'sine',.028));
  } else if(effect==='horn'){
    [392,523,659].forEach((f,i)=>tone(ac,f,t+i*.12,.19,'sawtooth',.025));
  } else if(effect==='drum'){
    [0,.18,.36].forEach((off,i)=>{tone(ac,i===2?70:92,t+off,.14,'sine',.055);noiseBurst(ac,t+off,.045,.014)});
  } else if(effect==='victory'){
    [523,659,784,1046].forEach((f,i)=>tone(ac,f,t+i*.13,i===3?.34:.16,'triangle',.035));
  } else if(effect==='wow'){
    [280,360,470,620].forEach((f,i)=>tone(ac,f,t+i*.07,.12,'sine',.026));
  } else if(effect==='jogaBoca'){
    // Chamada forte antes da fala para o efeito se destacar na mesa.
    noiseBurst(ac,t,.20,.075);
    [330,440,660,880].forEach((f,i)=>tone(ac,f,t+i*.07,.15,'sawtooth',.060));
    setTimeout(()=>speakJogaBocaAberta(),180);
  }
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}


const rankPeriodLabel={day:'Hoje',month:'Mês',year:'Ano',all:'Geral'};
const rankModeLabel={human:'Pessoas',bot:'Com máquina'};
function rankMedal(rank){return rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':String(rank)}
function pct(wins,games){return games?`${((wins/games)*100).toFixed(1).replace('.',',')}%`:'0%'}
function scoreFmt(value){return Number(value||0).toFixed(1).replace('.',',')}
async function loadRanking(){
  const body=$('#rankingBody'), mine=$('#rankingMine');
  if(!body||!mine)return;
  body.innerHTML='<tr><td colspan="7" class="ranking-empty">Carregando ranking...</td></tr>';
  mine.innerHTML='<span class="ranking-loading">Consultando seu perfil...</span>';
  $('#rankingScopeLabel').textContent=`${rankPeriodLabel[rankingPeriod]} • ${rankModeLabel[rankingMode]}`;
  try{
    const [rankRes,profileRes]=await Promise.all([
      fetch(`/api/ranking?period=${encodeURIComponent(rankingPeriod)}&mode=${encodeURIComponent(rankingMode)}`),
      fetch(`/api/profile?playerKey=${encodeURIComponent(permanentPlayerKey())}&period=${encodeURIComponent(rankingPeriod)}&mode=${encodeURIComponent(rankingMode)}`)
    ]);
    const rank=await rankRes.json(), prof=await profileRes.json();
    if(!rank.ok) throw new Error(rank.message||'Ranking indisponível.');
    if(!rank.rows?.length){
      body.innerHTML='<tr><td colspan="7" class="ranking-empty">Ainda não há partidas concluídas neste ranking.</td></tr>';
    }else{
      body.innerHTML=rank.rows.map(r=>`<tr class="${r.playerKey===permanentPlayerKey()?'ranking-me-row':''}"><td class="rank-pos" data-label="Posição">${rankMedal(r.rank)}</td><td data-label="Jogador"><div class="rank-player">${avatarHTML(r.avatar,'sm')}<span>${esc(r.name)}</span></div></td><td data-label="Jogos">${r.games}</td><td data-label="Vitórias"><strong>${r.wins}</strong></td><td data-label="Aproveit.">${pct(r.wins,r.games)}</td><td data-label="Média">${scoreFmt(r.avgScore)}</td><td data-label="Melhor">${r.bestScore??'-'}</td></tr>`).join('');
    }
    if(prof.ok&&prof.stats){
      const r=prof.stats;
      mine.innerHTML=`<div class="mine-avatar">${avatarHTML(r.avatar,'md')}</div><div><small>SEU DESEMPENHO</small><strong>${esc(r.name)}</strong><span>${r.wins} vitória(s) em ${r.games} partida(s) • ${pct(r.wins,r.games)} • média ${scoreFmt(r.avgScore)} pts</span></div>${r.rank?`<div class="mine-rank">${rankMedal(r.rank)}<small>posição</small></div>`:''}`;
    }else{
      mine.innerHTML='<div class="ranking-new-player">🎯 Você ainda não possui resultado neste período e modalidade.</div>';
    }
  }catch(e){
    body.innerHTML=`<tr><td colspan="7" class="ranking-empty">${esc(e.message||'Não foi possível carregar o ranking.')}</td></tr>`;
    mine.innerHTML='<div class="ranking-new-player">Tente novamente em alguns instantes.</div>';
  }
}
function openRanking(){
  const dlg=$('#rankingDialog'); if(!dlg)return;
  dlg.showModal(); loadRanking();
}
$$('[data-rank-period]').forEach(btn=>btn.onclick=()=>{
  rankingPeriod=btn.dataset.rankPeriod;
  $$('[data-rank-period]').forEach(x=>x.classList.toggle('active',x===btn));
  loadRanking();
});
$$('[data-rank-mode]').forEach(btn=>btn.onclick=()=>{
  rankingMode=btn.dataset.rankMode;
  $$('[data-rank-mode]').forEach(x=>x.classList.toggle('active',x===btn));
  loadRanking();
});
$('#rankingOpen').onclick=openRanking;
$('#rankingOpen2').onclick=openRanking;
$('#rankingClose').onclick=()=>$('#rankingDialog').close();

// ========================= V40.1 — JOGADORES ONLINE + CONVITES =========================
const onlineStatusOrder={available:0,searching:1,reconnecting:2,bot:3,multiplayer:4};
function renderOnlinePresence(){
  const count=Number(onlineCount||0);
  for(const el of [$('#onlineCount'),$('#onlineDialogCount'),$('#onlineTopBadge')])if(el)el.textContent=String(count);
  const box=$('#onlinePlayersList');if(!box)return;
  const mine=permanentPlayerKey();
  const rows=(onlinePlayers||[]).slice().sort((a,b)=>(onlineStatusOrder[a.status]??9)-(onlineStatusOrder[b.status]??9)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  if(!rows.length){box.innerHTML='<div class="online-empty">Nenhum jogador conectado neste momento.</div>';return;}
  box.innerHTML=rows.map(p=>{
    const self=p.playerKey===mine;
    const disabled=self||!p.inviteable||!p.connected;
    const label=self?'VOCÊ':p.status==='reconnecting'?'AGUARDE':'CONVIDAR';
    return `<div class="online-player-row ${self?'is-self':''}" data-player-key="${esc(p.playerKey||'')}">
      <div class="online-player-avatar">${avatarHTML(p.avatar,'md')}</div>
      <div class="online-player-info"><div class="online-player-name">${esc(p.name||'Jogador')}${self?'<span class="online-you">VOCÊ</span>':''}</div><div class="online-player-status ${esc(p.status||'available')}">${esc(p.statusEmoji||'🟢')} ${esc(p.statusLabel||'Disponível')}</div></div>
      <button class="online-invite-btn" type="button" data-invite-key="${esc(p.playerKey||'')}" ${disabled?'disabled':''}>${label}</button>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-invite-key]').forEach(btn=>btn.onclick=()=>sendOnlineInvite(btn.dataset.inviteKey,btn));
}
function openOnlinePlayers(){const dlg=$('#onlinePlayersDialog');if(!dlg)return;renderOnlinePresence();if(!dlg.open)dlg.showModal();}
function closeOnlinePlayers(){const dlg=$('#onlinePlayersDialog');if(dlg?.open)dlg.close();}

function matchmakingSeconds(){
  if(!matchmaking?.deadlineAt)return null;
  return Math.max(0,Math.ceil((Number(matchmaking.deadlineAt)-Date.now())/1000));
}
function openMatchmaking(){const dlg=$('#matchmakingDialog');if(!dlg)return;matchmakingDialogDismissed=false;renderMatchmaking();if(!dlg.open)dlg.showModal();}
function closeMatchmaking(markDismissed=true){const dlg=$('#matchmakingDialog');if(markDismissed)matchmakingDialogDismissed=true;if(dlg?.open)dlg.close();}
function renderMatchmaking(){
  const btn=$('#matchmakingStart'),title=$('#matchmakingBtnTitle'),sub=$('#matchmakingBtnSubtitle');
  const searching=!!matchmaking?.searching;
  if(btn)btn.classList.toggle('searching',searching);
  if(title)title.textContent=searching?'PROCURANDO JOGADORES...':'BUSCAR JOGADORES';
  if(sub)sub.textContent=searching?'Clique para acompanhar a busca':'Encontre alguém automaticamente';

  const status=$('#matchmakingStatus'),count=$('#matchmakingFoundCount'),list=$('#matchmakingPlayersList'),countdown=$('#matchmakingCountdown');
  if(count)count.textContent=String(matchmaking?.foundCount||0);
  if(!searching){
    if(status)status.textContent=matchmaking?.reason||'Encontre jogadores automaticamente para uma partida de 2 a 5 pessoas.';
    if(list)list.innerHTML='<div class="matchmaking-empty">Clique em BUSCAR JOGADORES para entrar na fila.</div>';
    if(countdown)countdown.innerHTML='<strong>Até 5 jogadores</strong><span>A partida começa quando houver pelo menos 2.</span>';
    return;
  }

  const players=Array.isArray(matchmaking.players)?matchmaking.players:[];
  if(list){
    list.innerHTML=players.map((p,i)=>`<div class="matchmaking-player">
      <div class="matchmaking-avatar">${avatarHTML(p.avatar||'macaco','md')}</div>
      <div><strong>${esc(p.name||'Jogador')}</strong><small>${p.playerKey===permanentPlayerKey()?'VOCÊ':'ENCONTRADO'}</small></div>
      <span class="matchmaking-check">✓</span>
    </div>`).join('')||'<div class="matchmaking-empty">Entrando na fila...</div>';
  }
  const n=players.length;
  if(status)status.textContent=n<2?'Aguardando mais um jogador...':n>=5?'5 jogadores encontrados! Iniciando...':'Mais jogadores podem entrar enquanto o relógio corre.';
  updateMatchmakingCountdown();
}
function updateMatchmakingCountdown(){
  const el=$('#matchmakingCountdown');if(!el||!matchmaking?.searching)return;
  const n=Number(matchmaking?.foundCount||0);
  if(n<2||!matchmaking.deadlineAt){
    el.innerHTML='<strong>⏳ Aguardando</strong><span>A contagem começa quando o 2º jogador entrar.</span>';
    return;
  }
  const sec=matchmakingSeconds();
  if(n>=5||sec<=0){
    el.innerHTML='<strong>🎮 Partida encontrada!</strong><span>Preparando a mesa...</span>';
    return;
  }
  el.innerHTML=`<strong>⏱️ ${sec}s</strong><span>Com ${n} jogador${n===1?'':'es'} encontrado${n===1?'':'s'}. Se chegar a 5, começa imediatamente.</span>`;
}
function startMatchmaking(){
  if(!googleUser)return showAuthGate('Entre com Google para buscar jogadores.');
  if(!socket.connected)return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  if(matchmaking.searching){openMatchmaking();return;}
  const btn=$('#matchmakingStart');if(btn)btn.disabled=true;
  socket.emit('startMatchmaking',{profile:profile()});
  setTimeout(()=>{if(btn)btn.disabled=false},700);
  openMatchmaking();
}
function cancelMatchmaking(){
  if(!matchmaking.searching){closeMatchmaking();return;}
  if(!socket.connected)return toast('Sem conexão com o servidor.');
  socket.emit('cancelMatchmaking');
}
function sendOnlineInvite(targetPlayerKey,button){
  if(!googleUser)return showAuthGate('Entre com Google para convidar jogadores.');
  if(!socket.connected)return toast('Sem conexão com o servidor.');
  if(!targetPlayerKey||targetPlayerKey===permanentPlayerKey())return;
  if(button){button.disabled=true;button.textContent='ENVIANDO...';setTimeout(()=>renderOnlinePresence(),900)}
  socket.emit('sendInvite',{targetPlayerKey,profile:profile()});
}
function inviteSeconds(expiresAt){return Math.max(0,Math.ceil((Number(expiresAt||0)-Date.now())/1000))}
function upsertInviteCard(data,uiState){
  if(!data?.id)return;
  const prior=inviteCards.get(data.id)||{};inviteCards.set(data.id,{...prior,...data,uiState:uiState||prior.uiState||data.status||'pending'});renderInviteInbox();
}
function removeInviteCard(id){inviteCards.delete(id);renderInviteInbox()}
function renderInviteInbox(){
  const box=$('#inviteInbox');if(!box)return;
  const cards=[...inviteCards.values()].filter(x=>!['refused','expired','cancelled','completed','unavailable'].includes(x.uiState));
  if(!cards.length){box.innerHTML='';return;}
  box.innerHTML=cards.slice(-4).reverse().map(inv=>{
    const pending=inv.uiState==='pending',ready=inv.uiState==='ready',waiting=inv.uiState==='accepted-waiting';
    const seconds=inviteSeconds(inv.expiresAt);
    const mainText=pending?`${esc(inv.fromName||'Jogador')} quer jogar Mau-Mau com você.`:ready?'Sua nova mesa está pronta para entrar.':esc(inv.message||'Convite aceito. Sua vaga está reservada temporariamente.');
    const actions=pending?`<div class="invite-actions"><button class="invite-refuse" data-invite-refuse="${esc(inv.id)}">RECUSAR</button><button class="invite-accept" data-invite-accept="${esc(inv.id)}">ACEITAR</button></div>`:
      ready?`<div class="invite-actions"><button class="invite-cancel" data-invite-cancel="${esc(inv.id)}">CANCELAR</button><button class="invite-ready-btn" data-invite-claim="${esc(inv.id)}">🎮 ENTRAR AGORA</button></div>`:
      `<div class="invite-wait-status">⏳ <span>${mainText}</span></div><div class="invite-actions"><button class="invite-cancel" data-invite-cancel="${esc(inv.id)}">Cancelar reserva</button></div>`;
    return `<div class="invite-card ${ready?'ready':waiting?'waiting':''}" data-invite-card="${esc(inv.id)}"><div class="invite-card-head">${avatarHTML(inv.fromAvatar||'macaco','sm')}<div><small>🃏 CONVITE PARA JOGAR</small><strong>${esc(inv.fromName||'Jogador')}</strong></div></div>${waiting?'':`<p>${mainText}${pending?` <span class="invite-countdown">${seconds}s</span>`:''}</p>`}${actions}</div>`;
  }).join('');
  box.querySelectorAll('[data-invite-accept]').forEach(b=>b.onclick=()=>{b.disabled=true;socket.emit('respondInvite',{inviteId:b.dataset.inviteAccept,accept:true})});
  box.querySelectorAll('[data-invite-refuse]').forEach(b=>b.onclick=()=>socket.emit('respondInvite',{inviteId:b.dataset.inviteRefuse,accept:false}));
  box.querySelectorAll('[data-invite-claim]').forEach(b=>b.onclick=()=>{b.disabled=true;socket.emit('claimInvite',{inviteId:b.dataset.inviteClaim})});
  box.querySelectorAll('[data-invite-cancel]').forEach(b=>b.onclick=()=>socket.emit('cancelAcceptedInvite',{inviteId:b.dataset.inviteCancel}));
}
setInterval(()=>{
  let changed=false;
  for(const inv of inviteCards.values())if(inv.uiState==='pending'&&inviteSeconds(inv.expiresAt)<=0){inv.uiState='expired';changed=true;}
  if(changed||inviteCards.size)renderInviteInbox();
},500);
$('#onlinePlayersOpen').onclick=openOnlinePlayers;
$('#onlinePlayersOpen2').onclick=openOnlinePlayers;
$('#onlinePlayersClose').onclick=closeOnlinePlayers;
$('#matchmakingStart').onclick=startMatchmaking;
$('#matchmakingClose').onclick=closeMatchmaking;
$('#matchmakingCancel').onclick=cancelMatchmaking;
setInterval(updateMatchmakingCountdown,250);

$$('.avatar-option').forEach(btn=>btn.onclick=()=>setAvatarSelection(btn.dataset.avatar));
setAvatarSelection($('#avatarSelect')?.value||'macaco');
$('#googleLogoutBtn').onclick=logoutGoogle;
$('#nameInput').addEventListener('input',schedulePresenceSync);
$('#nameInput').addEventListener('change',schedulePresenceSync);

$('#createBtn').onclick=()=>{
  if(!googleUser) return showAuthGate('Entre com sua Conta Google para criar uma sala.');
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  clearSession();
  socket.emit('createRoom',{...profile(),token:crypto.randomUUID()});
};
$('#botGameBtn').onclick=()=>{
  if(!googleUser) return showAuthGate('Entre com sua Conta Google para jogar.');
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  clearSession();
  socket.emit('createRoom',{...profile(),token:crypto.randomUUID(),withBot:true});
};
$('#joinBtn').onclick=()=>{
  if(!googleUser) return showAuthGate('Entre com sua Conta Google para entrar na sala.');
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  const code=$('#roomInput').value.trim().toUpperCase();
  if(!code) return toast('Informe o código da sala.');
  const sess=saved();
  const token=sess?.code===code&&sess?.token?sess.token:crypto.randomUUID();
  socket.emit('joinRoom',{...profile(),code,token});
};
$('#roomInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#joinBtn').click()});
$('#copyInvite').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',state.code);await navigator.clipboard.writeText(url.toString());toast('Link da sala copiado.');};
$('#leaveBtn').onclick=()=>{
  if(!state) return;
  const duringRound=state.status==='playing';
  const message=duringRound
    ? 'Deseja sair da sala? A rodada atual será cancelada para os jogadores que permanecerem.'
    : 'Deseja sair desta sala?';
  if(!window.confirm(message)) return;
  if(!socket.connected){
    clearSession();
    returnToLanding('Você saiu da sala.');
    return;
  }
  socket.emit('leaveRoom');
};

applyPileSide();
$('#pileSideBtn').onclick=togglePileSide;
updateHandSortButton();
$('#sortHandBtn').onclick=toggleHandSort;

$('#soundBtn').textContent=soundOn?'🔊':'🔇';
$('#soundBtn').onclick=()=>{soundOn=!soundOn;localStorage.setItem('maumauSound',soundOn?'on':'off');$('#soundBtn').textContent=soundOn?'🔊':'🔇';toast(soundOn?'🔊 Efeitos sonoros ativados.':'🔇 Efeitos sonoros desativados.');if(soundOn){audioCtx();playGameSound('yourTurn')}};
updateVibrationUI();
$('#vibrationBtn').onclick=()=>{
  turnVibrationOn=!turnVibrationOn;
  localStorage.setItem(turnVibrationStorage,turnVibrationOn?'on':'off');
  updateVibrationUI();
  if(turnVibrationOn){vibrateYourTurn();toast('📳 Vibração de SUA VEZ ativada.')}
  else{try{navigator.vibrate?.(0)}catch{};toast('📵 Vibração de SUA VEZ desativada.')}
};
updateMusicUI();
function toggleMusicPanel(){
  const panel=$('#musicPanel');if(!panel)return;
  panel.classList.toggle('hidden');updateMusicUI();
}
$$('.music-btn').forEach(btn=>btn.onclick=toggleMusicPanel);
$('#musicClose').onclick=()=>$('#musicPanel').classList.add('hidden');
$('#musicToggle').onclick=()=>setMusicEnabled(!musicOn);
$('#musicVolume').addEventListener('input',e=>setMusicVolume(Number(e.target.value)/100));
document.addEventListener('pointerdown',()=>{audioCtx();unlockMusic()},{once:true});
document.addEventListener('keydown',()=>{audioCtx();unlockMusic()},{once:true});
function quickAudioSupported(){return !!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder)}
function quickAudioMime(){const c=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm'];return c.find(x=>MediaRecorder.isTypeSupported?.(x))||''}
function formatVoiceDuration(ms){return `${Math.max(0,Math.min(15,Math.ceil(Number(ms||0)/1000)))} s`}
function formatRecordClock(ms){const sec=Math.max(0,Math.min(15,Math.floor(Number(ms||0)/1000)));return `00:${String(sec).padStart(2,'0')} / 00:15`}
function stopVoiceTracks(){try{voiceStream?.getTracks?.().forEach(t=>t.stop())}catch{} voiceStream=null}
function clearVoiceTimers(){if(voiceTickTimer)clearInterval(voiceTickTimer);if(voiceMaxTimer)clearTimeout(voiceMaxTimer);voiceTickTimer=null;voiceMaxTimer=null}
function clearVoiceDraft(){if(voiceDraft?.url)try{URL.revokeObjectURL(voiceDraft.url)}catch{} voiceDraft=null;const a=$('#voicePreviewAudio');if(a){a.pause();a.removeAttribute('src');a.load?.()}$('#voicePreviewPanel')?.classList.add('hidden')}
function setVoiceIdleUI(){$('#voiceRecorderPanel')?.classList.add('hidden');const b=$('#voiceRecordBtn');if(b){b.disabled=false;b.classList.remove('recording');b.textContent='🎙️';b.title='Gravar Áudio Rápido de até 15 segundos'}}
function showVoiceDraft(blob,durationMs){clearVoiceDraft();const url=URL.createObjectURL(blob);voiceDraft={blob,url,durationMs,mime:blob.type||'audio/webm'};const a=$('#voicePreviewAudio');if(a)a.src=url;const t=$('#voicePreviewTime');if(t)t.textContent=formatVoiceDuration(durationMs);$('#voicePreviewPanel')?.classList.remove('hidden')}
function finishVoiceRecording(){clearVoiceTimers();stopVoiceTracks();const canceled=voiceCancelOnStop;voiceCancelOnStop=false;const durationMs=Math.min(QUICK_AUDIO_MAX_MS,Math.max(200,Date.now()-voiceStartedAt));voiceStartedAt=0;const mime=voiceRecorder?.mimeType||quickAudioMime()||'audio/webm';voiceRecorder=null;setVoiceIdleUI();refreshQuickAudioMusicDuck();if(canceled){voiceChunks=[];return}const blob=new Blob(voiceChunks,{type:mime});voiceChunks=[];if(blob.size<80)return toast('Não foi possível gravar o áudio. Tente novamente.');if(blob.size>QUICK_AUDIO_MAX_BYTES)return toast('O áudio ficou grande demais. Grave novamente.');showVoiceDraft(blob,durationMs)}
async function startQuickAudio(){if(!state||!socket.connected)return toast('Sem conexão com a sala.');if(!quickAudioSupported())return toast('Este navegador não oferece gravação de áudio compatível.');if(voiceRecorder?.state==='recording')return;clearVoiceDraft();try{voiceStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});const mime=quickAudioMime();try{voiceRecorder=new MediaRecorder(voiceStream,mime?{mimeType:mime,audioBitsPerSecond:48000}:{audioBitsPerSecond:48000})}catch{voiceRecorder=new MediaRecorder(voiceStream)}voiceChunks=[];voiceCancelOnStop=false;voiceStartedAt=Date.now();voiceRecorder.ondataavailable=e=>{if(e.data?.size)voiceChunks.push(e.data)};voiceRecorder.onerror=()=>{voiceCancelOnStop=true;toast('Falha durante a gravação do áudio.');try{voiceRecorder?.stop()}catch{}};voiceRecorder.onstop=finishVoiceRecording;voiceRecorder.start(250);$('#voiceRecorderPanel')?.classList.remove('hidden');const b=$('#voiceRecordBtn');if(b){b.disabled=true;b.classList.add('recording');b.textContent='🔴'}const t=$('#voiceRecordTime');if(t)t.textContent='00:00 / 00:15';refreshQuickAudioMusicDuck();voiceTickTimer=setInterval(()=>{const e=Date.now()-voiceStartedAt,x=$('#voiceRecordTime');if(x)x.textContent=formatRecordClock(e)},200);voiceMaxTimer=setTimeout(()=>stopQuickAudio(false),QUICK_AUDIO_MAX_MS)}catch(e){stopVoiceTracks();voiceRecorder=null;clearVoiceTimers();setVoiceIdleUI();refreshQuickAudioMusicDuck();toast(e?.name==='NotAllowedError'?'Permita o uso do microfone para gravar Áudio Rápido.':'Não foi possível acessar o microfone neste dispositivo.')}}
function stopQuickAudio(cancel=false){if(!voiceRecorder||voiceRecorder.state==='inactive'){if(cancel){clearVoiceDraft();setVoiceIdleUI()}return}voiceCancelOnStop=!!cancel;clearVoiceTimers();try{voiceRecorder.stop()}catch{stopVoiceTracks();voiceRecorder=null;setVoiceIdleUI();refreshQuickAudioMusicDuck()}}
async function sendVoiceDraft(){if(!voiceDraft)return;if(!state||!socket.connected)return toast('Sem conexão com a sala.');const d=voiceDraft;try{const audio=await d.blob.arrayBuffer();if(audio.byteLength>QUICK_AUDIO_MAX_BYTES)throw new Error();socket.emit('voiceMessage',{audio,mime:d.mime,durationMs:d.durationMs});clearVoiceDraft();toast('🎙️ Áudio enviado.')}catch{toast('Não foi possível enviar o áudio. Tente novamente.')}}

$('#chatToggleBtn').onclick=()=>{setSideTab('chat',true)};
$('#logTabBtn').onclick=()=>setSideTab('log',true);
$('#chatTabBtn').onclick=()=>setSideTab('chat',true);
$('#sideCloseBtn').onclick=()=>$('#sidePanel').classList.remove('open');
$('#voiceRecordBtn').onclick=startQuickAudio;
$('#voiceStopBtn').onclick=()=>stopQuickAudio(false);
$('#voiceCancelBtn').onclick=()=>stopQuickAudio(true);
$('#voiceDiscardBtn').onclick=clearVoiceDraft;
$('#voiceSendBtn').onclick=sendVoiceDraft;
const voicePreviewAudio=$('#voicePreviewAudio');
if(voicePreviewAudio){
  voicePreviewAudio.addEventListener('play',()=>{$$('#chatMessages audio.chat-audio').forEach(a=>{if(!a.paused)a.pause()});playingVoiceAudios.add(voicePreviewAudio);refreshQuickAudioMusicDuck()});
  const releasePreview=()=>{playingVoiceAudios.delete(voicePreviewAudio);refreshQuickAudioMusicDuck()};
  voicePreviewAudio.addEventListener('pause',releasePreview);voicePreviewAudio.addEventListener('ended',releasePreview);voicePreviewAudio.addEventListener('error',releasePreview);
}
$('#chatForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!state||!socket.connected)return toast('Sem conexão com a sala.');
  const input=$('#chatInput'),text=input.value.trim();
  if(!text)return;
  socket.emit('chatMessage',{text});input.value='';input.focus();
});
$$('[data-effect]').forEach(btn=>btn.onclick=()=>{
  if(!state||!socket.connected)return toast('Sem conexão com a sala.');
  audioCtx();
  socket.emit('sendEffect',{effect:btn.dataset.effect});
});

$('#drawPile').onclick=()=>{if(canAct()) socket.emit('draw')};
$('#mauBtn').onclick=()=>socket.emit('declare',{type:'mau-mau'});
$('#batendoBtn').onclick=()=>socket.emit('declare',{type:'batendo'});
$('#endBurnBtn').onclick=()=>socket.emit('endBurn');
$('#passTurnBtn').onclick=()=>{
  if(passPending) return;
  passPending=true;
  $('#passTurnBtn').disabled=true;
  $('#passTurnBtn').textContent='⏳ Passando...';
  const afterBurn=state?.continuationPlayerId===state?.me?.id;
  toast(afterBurn
    ? (state?.me?.justDrawnCardId
      ? '⏭️ Passando a vez após a queima. A carta comprada ficará na sua mão.'
      : '⏭️ Passando a vez após a queima sem jogar outra carta.')
    : '⏭️ Passando a vez. A carta comprada ficará na sua mão.');
  socket.emit('passTurn');
};

const rules=$('#rulesDialog');
$('#rulesOpen').onclick=$('#rulesOpen2').onclick=()=>rules.showModal();
$('#rulesClose').onclick=()=>rules.close();
$('#roundReviewClose').onclick=closeRoundReview;
$('#roundReviewDone').onclick=closeRoundReview;
$('#roundReviewReplay').onclick=requestPlayAgain;
$('#roundReviewDialog').addEventListener('click',e=>{
  if(e.target===$('#roundReviewDialog')) closeRoundReview();
});

$$('#suitDialog [data-suit]').forEach(btn=>btn.onclick=()=>{
  const suit=btn.dataset.suit;$('#suitDialog').close();
  if(pendingDouble){
    socket.emit('playDoubleCard',{firstCardId:pendingDouble.cardIds[0],secondCardId:pendingDouble.cardIds[1],chosenSuit:suit});
    pendingDouble=null;pendingCard=null;pendingBurn=false;
    return;
  }
  socket.emit('playCard',{cardId:pendingCard.id,chosenSuit:suit});
  pendingCard=null;pendingBurn=false;
});

function requestPlayAgain(){
  if(!socket.connected)return toast('Sem conexão com o servidor.');
  if(!state?.replay?.eligible)return toast('Jogar de novo está disponível após uma partida entre jogadores.');
  socket.emit('playAgain');
}
function updateReplayControls(){
  const replay=state?.replay||{};
  const eligible=!!(state?.status==='finished'&&replay.eligible);
  const btn=$('#roundReviewReplay');
  const info=$('#roundReviewReplayInfo');
  if(btn){
    btn.classList.toggle('hidden',!eligible);
    btn.disabled=!eligible||!!replay.meReady||Number(replay.requiredCount||0)<2;
    btn.textContent=replay.meReady
      ? `✅ CONFIRMADO • ${replay.readyCount||0}/${replay.requiredCount||0}`
      : '🔁 JOGAR DE NOVO';
  }
  if(info){
    info.classList.toggle('hidden',!eligible);
    if(eligible){
      const required=Number(replay.requiredCount||0);
      const ready=Number(replay.readyCount||0);
      info.textContent=required<2
        ? 'Aguardando pelo menos mais 1 jogador conectado.'
        : replay.meReady
          ? `Aguardando os demais jogadores confirmarem (${ready}/${required}).`
          : 'Continue na mesma sala com o mesmo grupo. A nova partida terá 5 rodadas e placar zerado.';
    }
  }
}

function closeRoundReview(){
  const dlg=$('#roundReviewDialog');
  if(dlg?.open) dlg.close();
}
function roundReviewCardHTML(card){
  return `<div class="round-review-card-wrap">${cardHTML(card,true)}<div class="round-review-card-points">${Number(card.points)||0} pt${Number(card.points)===1?'':'s'}</div></div>`;
}
function openRoundReview(review=state?.roundReview){
  const dlg=$('#roundReviewDialog');
  if(!dlg||!review)return;
  const winner=review.players?.find(p=>p.id===review.winnerId);
  $('#roundReviewTitle').textContent=`🧮 Conferência — Rodada ${review.round}`;
  $('#roundReviewWinner').innerHTML=`🏆 <strong>${esc(review.winnerName||winner?.name||'Jogador')}</strong> venceu a rodada.`;
  $('#roundReviewBadge').textContent=`Rodada ${review.round}/${state?.rounds||5}`;
  const jack=$('#roundReviewJackNote');
  if(review.doubledByJack){
    jack.classList.remove('hidden');
    jack.innerHTML='🃏 <strong>Batida com Valete:</strong> a soma das cartas dos adversários foi multiplicada por 2.';
  }else{
    jack.classList.add('hidden');
    jack.textContent='';
  }
  const box=$('#roundReviewPlayers');
  const players=[...(review.players||[])].sort((a,b)=>{
    if(a.isWinner!==b.isWinner)return a.isWinner?-1:1;
    return (a.roundScore||0)-(b.roundScore||0)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
  });
  box.innerHTML=players.map(p=>{
    const cards=[...(p.cards||[])].sort(compareHandCards);
    const cardList=cards.length?cards.map(roundReviewCardHTML).join(''):'<div class="round-review-empty">Sem cartas — venceu a rodada</div>';
    const calc=p.isWinner
      ? '<strong>0 ponto</strong>'
      : `${p.basePoints||0}${p.multiplier===2?' × 2':''} = <strong>${p.roundScore||0} ponto${p.roundScore===1?'':'s'}</strong>`;
    return `<article class="round-review-player ${p.isWinner?'winner':''}">
      <div class="round-review-player-head">
        <div class="round-review-person">${avatarHTML(p.avatar,'sm')}<div><strong>${esc(p.name||'Jogador')}</strong>${p.isBot?' <small class="score-bot">BOT</small>':p.autoControlled?' <small class="score-auto">AUTO</small>':''}${p.isWinner?'<span class="round-review-winner-tag">🏆 VENCEDOR</span>':''}</div></div>
        <div class="round-review-score"><span>Rodada</span><b>+${p.roundScore||0}</b><span>Acumulado</span><strong>${p.scoreAfter||0}</strong></div>
      </div>
      <div class="round-review-cards">${cardList}</div>
      <div class="round-review-calc"><span>Cálculo:</span> ${calc}</div>
    </article>`;
  }).join('');
  updateReplayControls();
  if(!dlg.open) dlg.showModal();
}
function maybeShowRoundReview(nextState){
  if(nextState?.status==='playing'){
    closeRoundReview();
    return;
  }
  const review=nextState?.roundReview;
  if(!review?.id)return;
  if(nextState.status!=='between-rounds'&&nextState.status!=='finished')return;
  if(lastShownRoundReviewId===review.id)return;
  lastShownRoundReviewId=review.id;
  // Pequeno atraso para o aviso de vitória acontecer antes da conferência.
  setTimeout(()=>{
    if(state?.roundReview?.id===review.id) openRoundReview(review);
  },420);
}

function reconnectWaitingPlayers(){
  return state?.status==='playing' ? (state.players||[]).filter(p=>!p.isBot&&!p.connected&&!p.autoControlled&&p.reconnectDeadlineAt) : [];
}
function reconnectSeconds(deadlineAt){return Math.max(0,Math.ceil((Number(deadlineAt||0)-Date.now())/1000))}
function reconnectBannerText(){
  const waiting=reconnectWaitingPlayers();
  if(!waiting.length)return '';
  if(waiting.length===1){const p=waiting[0];return `⏸️ ${p.name} perdeu a conexão — ${reconnectSeconds(p.reconnectDeadlineAt)}s para retornar`;}
  const max=Math.max(...waiting.map(p=>reconnectSeconds(p.reconnectDeadlineAt)));
  return `⏸️ ${waiting.length} jogadores reconectando — até ${max}s`;
}
function updateReconnectCountdown(){
  if(!state)return;
  const banner=reconnectBannerText();
  if(banner&&$('#turnBanner'))$('#turnBanner').textContent=banner;
  $$('.reconnect-countdown[data-deadline]').forEach(el=>{el.textContent=`${reconnectSeconds(el.dataset.deadline)}s`;});
}
setInterval(updateReconnectCountdown,250);

socket.on('joined',data=>{
  saveSession({code:data.code,token:data.token,name:profile().name,avatar:profile().avatar,playerKey:permanentPlayerKey()});
  if(data?.inviteId)removeInviteCard(data.inviteId);
  if(data?.source==='matchmaking'){
    matchmaking={searching:false,players:[],foundCount:0,maxPlayers:5,deadlineAt:null,waitMs:15000,reason:'Partida encontrada.'};
    closeMatchmaking(false);
    toast(`🎮 ${data?.matchSize||2} jogadores encontrados! Partida iniciada.`);
  }
  closeOnlinePlayers();
  renderMatchmaking();
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
  syncPresenceProfile();
});
socket.on('state',s=>{
  const prev=state;
  state=s;
  if(passPending && state?.me && state.currentPlayerId !== state.me.id){
    passPending=false;
  }
  render();
  if($('#roundReviewDialog')?.open)updateReplayControls();
  syncMusicToState();
  maybeShowRoundReview(s);
  if(prev){
    maybeMusicStinger(prev,s);
    const last=s.log.at(-1);
    const old=prev.log.at(-1);
    if(last&&last.id!==old?.id){
      const fx=soundForLog(last);
      if(fx){
        playGameSound(fx);
        // O anúncio falado simples continua para o próprio jogador. Para adversários,
        // o alerta mais forte é disparado quando a mão realmente chega a 1 carta.
        if(fx==='mau' && last.playerId===s.me?.id) speakMauMau();
      }
    }
    detectOpponentMauMau(prev,s);
  }
  if(shouldCueMyTurn(prev,s)) triggerYourTurnCue();
});
socket.on('presenceSnapshot',payload=>{
  onlineCount=Number(payload?.onlineCount||0);onlinePlayers=Array.isArray(payload?.players)?payload.players:[];renderOnlinePresence();
});
socket.on('matchmakingState',payload=>{
  matchmaking={
    searching:!!payload?.searching,
    players:Array.isArray(payload?.players)?payload.players:[],
    foundCount:Number(payload?.foundCount||0),
    maxPlayers:Number(payload?.maxPlayers||5),
    deadlineAt:payload?.deadlineAt?Number(payload.deadlineAt):null,
    waitMs:Number(payload?.waitMs||15000),
    reason:String(payload?.reason||''),
  };
  renderMatchmaking();
  if(matchmaking.searching&&!matchmakingDialogDismissed&&$('#matchmakingDialog')?.open===false)openMatchmaking();
  if(!matchmaking.searching&&$('#matchmakingDialog')?.open&&payload?.reason)closeMatchmaking(false);
});
socket.on('matchmakingMatched',info=>{
  matchmaking={...matchmaking,searching:true,foundCount:Number(info?.count||matchmaking.foundCount||2),deadlineAt:Date.now(),players:Array.isArray(info?.players)?info.players:matchmaking.players};
  renderMatchmaking();playGameSound('yourTurn');
});
socket.on('matchmakingCancelled',info=>{if(info?.message)toast(info.message);});
socket.on('matchmakingError',info=>{toast(info?.message||'Não foi possível formar a partida agora.');});
socket.on('inviteReceived',invite=>{
  upsertInviteCard(invite,'pending');playGameSound('chat');
  try{if(document.visibilityState!=='visible')navigator.vibrate?.([45,45,45])}catch{}
  toast(`🃏 ${invite?.fromName||'Jogador'} convidou você para jogar.`);
});
socket.on('inviteSent',info=>toast(`🃏 Convite enviado para ${info?.targetName||'jogador'}. Expira em 30 segundos.`));
socket.on('inviteWaiting',info=>{
  upsertInviteCard(info,'accepted-waiting');toast(info?.message||'✅ Convite aceito. Vaga reservada.');
});
socket.on('inviteReady',info=>{
  upsertInviteCard(info,'ready');playGameSound('yourTurn');toast('🎮 Seu convite está pronto. Você já pode entrar na nova mesa.');
});
socket.on('inviteStatus',info=>{
  const inv=inviteCards.get(info?.inviteId);
  if(inv&&['refused','expired','cancelled','completed','unavailable'].includes(info?.status)){inv.uiState=info.status;renderInviteInbox();setTimeout(()=>removeInviteCard(info.inviteId),300);}
  if(info?.message)toast(info.message);
});

socket.on('chatHistory',messages=>{for(const m of chatMessages){if(m?.audioUrl)try{URL.revokeObjectURL(m.audioUrl)}catch{}}for(const a of [...playingVoiceAudios]){if(a?.classList?.contains('chat-audio'))playingVoiceAudios.delete(a)}chatMessages=Array.isArray(messages)?messages.slice(-60):[];unreadChat=0;refreshQuickAudioMusicDuck();renderChat();renderChatBadge()});
socket.on('chatMessage',message=>{
  chatMessages.push(message);if(chatMessages.length>60)chatMessages=chatMessages.slice(-60);
  const panelOpen=$('#sidePanel').classList.contains('open')||window.innerWidth>900;
  if(message.playerId!==state?.me?.id && (activeSideTab!=='chat'||!panelOpen)) unreadChat++;
  renderChat();renderChatBadge();
  if(activeSideTab==='chat'&&panelOpen) unreadChat=0,renderChatBadge();
  if(message.playerId!==state?.me?.id) playGameSound('chat');
});
socket.on('voiceMessage',message=>{
  try{
    const blob=new Blob([message.audio],{type:message.mime||'audio/webm'});
    const voice={...message,kind:'voice',audio:null,audioUrl:URL.createObjectURL(blob)};
    chatMessages.push(voice);
    while(chatMessages.length>60){const removed=chatMessages.shift();if(removed?.audioUrl)try{URL.revokeObjectURL(removed.audioUrl)}catch{}}
    const panelOpen=$('#sidePanel').classList.contains('open')||window.innerWidth>900;
    if(message.playerId!==state?.me?.id && (activeSideTab!=='chat'||!panelOpen)) unreadChat++;
    renderChat();renderChatBadge();
    if(activeSideTab==='chat'&&panelOpen) unreadChat=0,renderChatBadge();
    if(message.playerId!==state?.me?.id) playGameSound('chat');
  }catch{toast('Recebemos um áudio que este navegador não conseguiu abrir.')}
});
socket.on('soundEffect',event=>{
  const fx=effectCatalog[event.effect];if(!fx)return;
  playSocialEffect(event.effect);showReaction(event.name||'Jogador',fx.emoji,fx.label,event.avatar);
});
socket.on('passConfirmed',data=>{
  const next=state?.players?.find(p=>p.id===data?.nextPlayerId);
  toast(`✅ Vez passada${next?.name?`. Agora é a vez de ${next.name}.`:'.'}`);
});
socket.on('gameError',e=>{passPending=false;playGameSound('error');toast(e.message);render();});
socket.on('leftRoom',data=>{
  clearSession();
  returnToLanding(data?.message||'Você saiu da sala.');
  syncPresenceProfile();
});
socket.on('reconnectionEvent',event=>{
  if(event?.kind==='lost') toast(`🔴 ${event.name||'Jogador'} perdeu a conexão. 60 segundos para retornar.`);
  else if(event?.kind==='auto') toast(`🤖 Máquina assumiu temporariamente as jogadas de ${event.name||'Jogador'}.`);
  else if(event?.kind==='returned-from-auto') toast('🟢 Conexão restabelecida. Você retomou seu lugar.');
  else if(event?.kind==='returned') toast(`🟢 ${event.name||'Jogador'} voltou à mesa.`);
});
socket.on('sessionReplaced',()=>toast('Esta sessão foi aberta em outra aba. Esta aba ficará inativa.'));
socket.on('connect',()=>{
  setConnection('online');
  syncPresenceProfile();
  const urlRoom=(new URLSearchParams(location.search).get('room')||'').toUpperCase();
  const sess=saved();

  // Um link de convite para outra sala tem prioridade sobre uma sessão antiga.
  if(urlRoom && (!sess?.code || sess.code !== urlRoom)){
    $('#roomInput').value=urlRoom;
    return;
  }
  if(sess?.code&&sess?.token){
    $('#nameInput').value=sess.name||'Jogador';setAvatarSelection(sess.avatar||'macaco');
    socket.emit('joinRoom',{code:sess.code,token:sess.token,name:sess.name,avatar:sess.avatar});
  } else if(urlRoom) $('#roomInput').value=urlRoom;
});
socket.on('disconnect',()=>{setConnection('offline');toast('Conexão perdida. Tentando reconectar...');renderControls();});
socket.on('connect_error',e=>{
  setConnection('offline');
  if(e?.message==='AUTH_REQUIRED'){showAuthGate('Sua sessão expirou. Entre novamente com Google.');renderGoogleSignIn();}
});
socket.io.on('reconnect_attempt',()=>setConnection('connecting'));

function returnToLanding(message=''){
  state=null;pendingCard=null;pendingBurn=false;pendingDouble=null;previousHandIds=new Set();stopQuickAudio(true);clearVoiceDraft();for(const m of chatMessages){if(m?.audioUrl)try{URL.revokeObjectURL(m.audioUrl)}catch{}}chatMessages=[];playingVoiceAudios.clear();refreshQuickAudioMusicDuck();unreadChat=0;activeSideTab='log';lastShownRoundReviewId=null;
  closeRoundReview();
  $('#sidePanel')?.classList.remove('open');renderChatBadge();
  try{
    const url=new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState({},'',url.pathname+(url.search||'')+url.hash);
  }catch{}
  $('#game').classList.add('hidden');
  $('#landing').classList.remove('hidden');
  $('#roomInput').value='';
  syncMusicToState();
  syncPresenceProfile();
  if(message) toast(message);
}


function setSideTab(tab,openMobile=false){
  activeSideTab=tab==='chat'?'chat':'log';
  $('#logTabBtn').classList.toggle('active',activeSideTab==='log');
  $('#chatTabBtn').classList.toggle('active',activeSideTab==='chat');
  $('#logView').classList.toggle('hidden',activeSideTab!=='log');
  $('#chatView').classList.toggle('hidden',activeSideTab!=='chat');
  if(openMobile) $('#sidePanel').classList.add('open');
  if(activeSideTab==='chat'){unreadChat=0;renderChatBadge();setTimeout(()=>$('#chatInput')?.focus(),30)}
}
function renderChatBadge(){
  const text=unreadChat>9?'9+':String(unreadChat);
  for(const el of [$('#chatBadge'),$('#chatTopBadge')]){if(!el)continue;el.textContent=text;el.classList.toggle('hidden',unreadChat===0)}
}
function renderChat(){
  const box=$('#chatMessages');if(!box)return;
  const activeAudio=[...box.querySelectorAll('audio.chat-audio')].find(a=>!a.paused&&!a.ended);
  const activeVoiceId=activeAudio?.dataset.voiceId||null,activeTime=activeAudio?.currentTime||0;
  if(!chatMessages.length){box.innerHTML='<div class="chat-empty">Converse com os jogadores da sala ou envie um Áudio Rápido.</div>';return}
  for(const a of [...playingVoiceAudios]){if(a?.classList?.contains('chat-audio'))playingVoiceAudios.delete(a)}
  refreshQuickAudioMusicDuck();
  box.innerHTML=chatMessages.map(m=>{
    const mine=m.playerId===state?.me?.id;
    const time=new Date(m.at||Date.now()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const body=m.kind==='voice'&&m.audioUrl?`<div class="chat-bubble voice-bubble"><div class="voice-bubble-title">🎙️ Áudio Rápido <span>${formatVoiceDuration(m.durationMs)}</span></div><audio class="chat-audio" data-voice-id="${esc(m.id||'')}" controls preload="metadata" src="${esc(m.audioUrl)}"></audio></div>`:`<div class="chat-bubble">${esc(m.text)}</div>`;
    return `<div class="chat-message ${mine?'mine':''}"><div class="chat-meta">${avatarHTML(m.avatar,'xs')} <b>${esc(m.name||'Jogador')}</b> <span>${time}</span></div>${body}</div>`;
  }).join('');
  box.querySelectorAll('audio.chat-audio').forEach(audio=>{
    audio.addEventListener('play',()=>{
      box.querySelectorAll('audio.chat-audio').forEach(other=>{if(other!==audio&&!other.paused)other.pause()});
      if(voicePreviewAudio&&!voicePreviewAudio.paused)voicePreviewAudio.pause();
      playingVoiceAudios.add(audio);refreshQuickAudioMusicDuck();
    });
    const release=()=>{playingVoiceAudios.delete(audio);refreshQuickAudioMusicDuck()};
    audio.addEventListener('pause',release);audio.addEventListener('ended',release);audio.addEventListener('error',release);
  });
  if(activeVoiceId){
    const resumed=[...box.querySelectorAll('audio.chat-audio')].find(a=>a.dataset.voiceId===activeVoiceId);
    if(resumed){try{resumed.currentTime=activeTime}catch{};resumed.play().catch(()=>{})}
  }
  box.scrollTop=box.scrollHeight;
}
function showReaction(name,emoji,label,avatar=null){
  const layer=$('#reactionLayer');if(!layer)return;
  const el=document.createElement('div');el.className='reaction-pop';
  el.innerHTML=`<div class="reaction-emoji">${emoji}</div>${avatar?avatarHTML(avatar,'sm'):''}<div><strong>${esc(name)}</strong><span>${esc(label)}</span></div>`;
  layer.appendChild(el);setTimeout(()=>el.remove(),2100);
}

function canAct(){return !passPending&&socket.connected&&state?.status==='playing'&&!state.paused&&state.currentPlayerId===state.me?.id}
function render(){
  if(!state)return;
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
  const myTurnNow=state.status==='playing'&&!state.paused&&state.currentPlayerId===state.me?.id;
  $('#game').classList.toggle('my-turn',!!myTurnNow);
  $('#roomCode').textContent=state.code;$('#roundText').textContent=`Rodada ${state.round}/${state.rounds}`;
  $('#directionText').textContent=state.direction===1?'↻ horário':'↺ anti-horário';$('#deckCount').textContent=state.deckCount;
  $('#meLabel').innerHTML=`${avatarHTML(state.me.avatar,'sm')} <span>${esc(state.me.name)}</span>`;$('#handCount').textContent=`• ${state.me.hand.length} carta(s)`;
  renderPlayers();renderScore();renderCenter();renderHand();renderLog();renderControls();
}
function renderPlayers(){
  const ring=$('#playersRing');ring.innerHTML='';const n=state.players.length;
  const mobile=window.innerWidth<=900;
  const desktopSpots=n===2?[[50,12],[50,88]]:n===3?[[50,10],[18,72],[82,72]]:n===4?[[50,8],[12,50],[50,90],[88,50]]:[[50,7],[12,35],[22,84],[78,84],[88,35]];
  // No celular, a própria posição fica escondida (a mão já identifica você),
  // e os adversários ocupam a parte superior/lateral da mesa para liberar o centro.
  const opponents=state.players.filter(p=>p.id!==state.me.id);
  const mobileSpots=opponents.length===1?[[50,12]]:
    opponents.length===2?[[25,13],[75,13]]:
    opponents.length===3?[[18,18],[50,10],[82,18]]:
    [[17,18],[39,9],[61,9],[83,18]];
  let oi=0;
  state.players.forEach((p,i)=>{
    const d=document.createElement('div');d.className='player-seat'+(p.id===state.me.id?' self-seat':'');
    const spot=mobile?(p.id===state.me.id?[50,90]:mobileSpots[oi++]):desktopSpots[i];
    d.style.left=spot[0]+'%';d.style.top=spot[1]+'%';d.dataset.playerName=p.name||'Jogador';
    const active=state.currentPlayerId===p.id?' active':'';
    const waitingReconnect=!p.isBot&&!p.connected&&!p.autoControlled;
    const disc=waitingReconnect?' disconnect':'';
    const auto=p.autoControlled?' auto-control':'';
    const you=p.id===state.me.id?' <span class="you-tag">(você)</span>':'';
    const bot=p.isBot?' <span class="bot-tag">BOT</span>':'';
    const autoTag=p.autoControlled?' <span class="auto-tag">🤖 AUTO</span>':'';
    const reconnectTag=waitingReconnect&&p.reconnectDeadlineAt?` <span class="reconnect-tag">🔴 <span class="reconnect-countdown" data-deadline="${p.reconnectDeadlineAt}">${reconnectSeconds(p.reconnectDeadlineAt)}s</span></span>`:'';
    const countClass=p.cardCount===1?' mau-count':p.cardCount===2?' warning-count':'';
    const countWord=p.cardCount===1?'CARTA':'CARTAS';
    d.innerHTML=`<div class="player-card${active}${disc}${auto}${countClass}"><span class="avatar">${avatarHTML(p.avatar,'md')}</span><div class="player-meta"><div class="player-name">${p.host?'<span class="crown">★</span> ':''}${esc(p.name)}${bot}${autoTag}${you}</div><div class="player-stats">${p.score} pts${reconnectTag}</div></div><div class="card-count-badge${countClass}" aria-label="${p.cardCount} ${countWord.toLowerCase()}"><strong>${p.cardCount}</strong><span>${countWord}</span></div></div>`;
    ring.appendChild(d);
  });
}
function renderScore(){
  const box=$('#scoreboard');box.innerHTML='<div class="score-title">Placar acumulado</div>'+state.players.slice().sort((a,b)=>a.score-b.score).map(p=>`<div class="score-row"><span class="score-avatar">${avatarHTML(p.avatar,'sm')}</span><span>${esc(p.name)}${p.isBot?' <small class="score-bot">BOT</small>':p.autoControlled?' <small class="score-auto">AUTO</small>':''}</span><span class="round-score">+${p.roundScore||0}</span><strong>${p.score}</strong></div>`).join('');
}
function renderCenter(){
  const top=state.topCard;$('#discardPile').innerHTML=top?cardHTML(top,false):'';
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  let banner='Aguardando jogadores...';
  if(state.status==='playing'){
    const reconnectBanner=reconnectBannerText();
    banner=reconnectBanner || (current?.autoControlled
      ? `🤖 Máquina jogando temporariamente por ${current.name||'Jogador'}...`
      : (current?.id===state.me.id?'✨ Sua vez':`Vez de ${current?.name||'Jogador'}`));
  }
  if(state.status==='playing'&&!state.paused&&state.continuationPlayerId===state.me.id){
    if(state.me?.justDrawnCardId) banner='🔥 Após a queima: jogue qualquer carta válida ou passe e guarde a comprada';
    else if(state.me?.burnMustDraw) banner='🔥 Após a queima: sem carta compatível — compre 1 carta';
    else banner='🔥 Após a queima: jogue mais uma carta compatível ou passe a vez';
  }
  else if(state.status==='playing'&&!state.paused&&state.me?.burnableCardIds?.length&&state.me?.quickActionCardIds?.length) banner='🔥 QUEIMA ou ⚡ AÇÃO RÁPIDA disponível! Escolha sua reação';
  else if(state.status==='playing'&&!state.paused&&state.me?.burnableCardIds?.length) banner=state.openingReaction?'🔥 QUEIMA DA ABERTURA! Você pode jogar a carta exatamente igual mesmo fora da vez':'🔥 QUEIMA DISPONÍVEL! Jogue a carta igual e decida se continua ou passa';
  else if(state.status==='playing'&&!state.paused&&state.me?.quickActionCardIds?.length) banner='⚡ AÇÃO RÁPIDA! Jogue a carta igual antes do próximo';
  else if(state.status==='playing'&&!state.paused&&state.currentPlayerId===state.me?.id&&state.me?.doublePairs?.length) banner='🃏🃏 CARTA DUPLA disponível! Use ×2 (somente carta normal)';
  if(state.status==='between-rounds'){const w=state.players.find(p=>p.id===state.winnerId);banner=`🏆 ${w?.name||'Jogador'} venceu a rodada`}
  if(state.status==='finished'){const min=Math.min(...state.players.map(p=>p.score));const ws=state.players.filter(p=>p.score===min);banner=`🏆 ${ws.map(p=>p.name).join(' e ')} ${ws.length>1?'empataram':'venceu'}!`}
  $('#turnBanner').textContent=banner;
  $('#turnBanner').classList.toggle('reconnect-wait',!!reconnectBannerText());
  $('#suitRequest').classList.toggle('hidden',!state.requestedSuit);if(state.requestedSuit)$('#suitRequest').textContent=`Naipe pedido: ${suitGlyph[state.requestedSuit]} ${suitName[state.requestedSuit]}`;
  $('#sevenPenalty').classList.toggle('hidden',!state.pendingSeven);if(state.pendingSeven)$('#sevenPenalty').textContent=`⚠️ Cadeia de 7: comprar ${state.pendingSeven} ou rebater com outro 7`;
  const canChooseAfterDraw=state.status==='playing'&&!state.paused&&current?.id===state.me?.id&&!!state.me?.justDrawnCardId;
  $('#drawChoice').classList.toggle('hidden',!canChooseAfterDraw);
}

function renderHand(){
  const h=$('#hand');h.innerHTML='';
  const legal=new Set(state.me.legalCardIds),burn=new Set(state.me.burnableCardIds),quick=new Set(state.me.quickActionCardIds||[]);
  const doublePairs=state.me.doublePairs||[];
  // O botão ×2 aparece nas DUAS cópias da dupla, para o jogador não depender
  // de qual delas o servidor listou primeiro.
  const doubleByCard=new Map();
  doublePairs.forEach(pair=>(pair.cardIds||[]).forEach(id=>doubleByCard.set(id,pair)));
  const visibleHand=[...state.me.hand].sort(compareHandCards);
  visibleHand.forEach(card=>{
    const wrap=document.createElement('div');wrap.innerHTML=cardHTML(card,true);const el=wrap.firstElementChild;
    if(!previousHandIds.has(card.id)) el.classList.add('deal-in');
    const ok=legal.has(card.id)&&canAct();
    const canBurn=burn.has(card.id)&&socket.connected&&!state.paused&&!state.me.justDrawnCardId;
    const canQuick=quick.has(card.id)&&socket.connected&&!state.paused&&!state.me.justDrawnCardId;
    el.classList.add(ok?'playable':'disabled');
    if(canBurn) el.classList.add('burnable');
    if(canQuick) el.classList.add('quickable');
    if(ok)el.onclick=()=>play(card,false);
    if(canBurn){const b=document.createElement('button');b.className='burn-btn';b.textContent='🔥';b.title=state.openingReaction?'QUEIMAR A ABERTURA: jogue a carta exatamente igual e assuma a jogada':'QUEIMAR: jogar esta carta igual à mesa; depois você pode jogar outra compatível ou passar';b.onclick=e=>{e.stopPropagation();play(card,true)};el.appendChild(b)}
    if(canQuick){const q=document.createElement('button');q.className='quick-btn';q.textContent='⚡';q.title='AÇÃO RÁPIDA: descartar esta carta igual sem tomar a vez';q.onclick=e=>{e.stopPropagation();playQuick(card)};el.appendChild(q)}
    const doublePair=doubleByCard.get(card.id);
    const canDouble=!!(doublePair&&canAct()&&!state.paused&&!state.continuationPlayerId);
    if(canDouble){
      el.classList.add('double-available');
      const d=document.createElement('button');d.className='double-btn';d.textContent='×2';
      d.title='CARTA DUPLA: jogar as duas cartas idênticas juntas';
      d.onclick=e=>{e.stopPropagation();playDouble(doublePair)};el.appendChild(d);
    }
    if(card.id===state.me.justDrawnCardId)el.style.outline='3px solid #65dc96';
    h.appendChild(el);
  });
  const myTurn=canAct();
  const burnOpportunity=(state.me.burnableCardIds||[]).length>0;
  const quickOpportunity=(state.me.quickActionCardIds||[]).length>0;
  const doubleOpportunity=(state.me.doublePairs||[]).length>0;
  // Mau-Mau pode ser anunciado fora da vez quando uma reação válida deixará 1 carta.
  const canDeclareMau=(state.me.hand.length===2&&(myTurn||burnOpportunity||quickOpportunity))||(state.me.hand.length===3&&(burnOpportunity||doubleOpportunity));
  $('#mauBtn').disabled=!canDeclareMau;$('#batendoBtn').disabled=!canBatendo();
  // V18: a continuação da queima é opcional.
  $('#endBurnBtn').classList.add('hidden');

  const passBlockedBySeven=state.pendingSeven>0;
  const inBurn=state.continuationPlayerId===state.me.id;
  const boughtThisTurn=!!state.me.justDrawnCardId;
  const legalAfterBurn=(state.me.legalCardIds||[]).length>0;

  // Regra normal: só passa depois de comprar.
  // Regra especial da queima:
  //   - se já há carta compatível, pode jogar OU passar sem comprar;
  //   - se não há carta compatível, primeiro compra 1;
  //   - depois da compra, pode jogar qualquer carta válida OU passar e guardar a comprada.
  const canPassBurn=!!(inBurn&&(boughtThisTurn||legalAfterBurn));
  const canPassNormal=!!(!inBurn&&boughtThisTurn);
  const canPassTurn=!!(myTurn&&!state.paused&&!passBlockedBySeven&&(canPassBurn||canPassNormal));

  $('#passTurnBtn').classList.toggle('hidden',state.status!=='playing');
  $('#passTurnBtn').disabled=!canPassTurn;
  $('#passTurnBtn').textContent=passPending?'⏳ Passando...':'⏭️ Passar a vez';
  $('#passTurnBtn').title=canPassTurn
    ? (inBurn
      ? (boughtThisTurn
        ? 'Passar após a queima e guardar a carta comprada.'
        : 'Passar após a queima sem jogar uma segunda carta.')
      : 'Passar a vez após a compra obrigatória de 1 carta.')
    : passBlockedBySeven
      ? 'Resolva primeiro a cadeia de 7: rebata ou compre a penalidade.'
      : inBurn&&state.me.burnMustDraw
        ? 'Você não tem carta compatível após a queima. Compre 1 carta antes de passar.'
        : myTurn
          ? 'Para passar a vez normal, primeiro compre 1 carta do monte.'
          : 'Aguarde sua vez.';

  // Compra normal: uma carta por turno.
  // Após a queima, a compra só é habilitada quando não existe carta compatível.
  const burnDrawBlocked=inBurn&&!boughtThisTurn&&!state.me.burnMustDraw;
  $('#drawPile').disabled=!!(passPending
    ||(myTurn&&boughtThisTurn&&!state.pendingSeven)
    ||(myTurn&&burnDrawBlocked));
  $('#drawPile').title=boughtThisTurn
    ? (inBurn
      ? 'Você já comprou após a queima. Jogue qualquer carta válida ou passe e guarde a comprada.'
      : 'Você já comprou nesta vez. Jogue qualquer carta válida da mão ou passe a vez.')
    : inBurn
      ? (state.me.burnMustDraw
        ? 'Comprar 1 carta porque não há continuação compatível.'
        : 'Você já tem carta compatível: jogue-a ou passe a vez sem comprar.')
      : 'Comprar 1 carta';
  previousHandIds=new Set(state.me.hand.map(c=>c.id));
}
function renderLog(){const l=$('#log');l.innerHTML=state.log.slice().reverse().map(x=>`<div class="log-item ${x.kind}">${esc(x.message)}</div>`).join('')}
function renderControls(){
  const box=$('#hostControls');
  if(!state?.me){box.innerHTML='';return}
  const me=state.players.find(p=>p.id===state.me.id);box.innerHTML='';
  const connected=state.players.filter(p=>p.connected).length;
  const available=state.players.filter(p=>p.connected||p.isBot||p.autoControlled).length;
  const disconnected=state.players.filter(p=>!p.isBot&&!p.connected&&!p.autoControlled).length;

  const host=state.players.find(p=>p.host);
  const connectedHost=state.players.find(p=>p.host&&p.connected);
  const canTakeHost=!connectedHost;
  const canStart=(me?.host||canTakeHost)&&(state.status==='lobby'||state.status==='between-rounds');
  const bots=state.players.filter(p=>p.isBot);

  if(state.roundReview && (state.status==='between-rounds'||state.status==='finished')){
    const reviewBtn=document.createElement('button');
    reviewBtn.className='round-review-open-btn';
    reviewBtn.textContent='🔍 Conferir cartas e pontuação';
    reviewBtn.onclick=()=>openRoundReview(state.roundReview);
    box.appendChild(reviewBtn);
  }

  if(state.status==='finished'&&state.replay?.eligible){
    const replayWrap=document.createElement('div');replayWrap.className='replay-controls';
    const replayBtn=document.createElement('button');replayBtn.className='replay-btn';
    replayBtn.disabled=!socket.connected||state.replay.meReady||Number(state.replay.requiredCount||0)<2;
    replayBtn.textContent=state.replay.meReady
      ? `✅ Confirmado • ${state.replay.readyCount||0}/${state.replay.requiredCount||0}`
      : '🔁 JOGAR DE NOVO';
    replayBtn.onclick=requestPlayAgain;
    const replayInfo=document.createElement('div');replayInfo.className='replay-info';
    replayInfo.textContent=Number(state.replay.requiredCount||0)<2
      ? 'Aguardando pelo menos mais 1 jogador conectado.'
      : state.replay.meReady
        ? `Aguardando os demais jogadores (${state.replay.readyCount||0}/${state.replay.requiredCount||0}).`
        : 'Nova partida na mesma sala, com placar zerado.';
    replayWrap.append(replayBtn,replayInfo);box.appendChild(replayWrap);
  }

  if(canStart){
    if(me?.host){
      const botBar=document.createElement('div');botBar.className='bot-controls';
      const addBot=document.createElement('button');addBot.className='bot-control-btn';addBot.textContent='🤖 Adicionar máquina';
      addBot.disabled=!socket.connected||state.players.length>=5||(state.status==='between-rounds'&&state.round>=3);
      addBot.onclick=()=>socket.emit('addBot');
      botBar.appendChild(addBot);
      if(bots.length){
        const removeBot=document.createElement('button');removeBot.className='bot-control-btn remove';removeBot.textContent='− Remover máquina';
        removeBot.disabled=!socket.connected;removeBot.onclick=()=>socket.emit('removeBot');botBar.appendChild(removeBot);
      }
      box.appendChild(botBar);
    }
    const b=document.createElement('button');
    const normalLabel=state.status==='lobby'?'Iniciar 1ª rodada':`Iniciar rodada ${state.round+1}`;
    b.textContent=me?.host?normalLabel:`Assumir sala e ${normalLabel.toLowerCase()}`;
    const blocked=!socket.connected||available<2||(state.status==='between-rounds'&&disconnected>0);
    b.disabled=blocked;
    b.onclick=()=>{
      if(!socket.connected) return toast('Sem conexão com o servidor.');
      b.disabled=true;b.textContent='Iniciando...';
      socket.emit('startRound');
    };
    box.appendChild(b);
    const info=document.createElement('div');info.className='host-status';
    if(connected<2) info.textContent='Aguardando pelo menos mais 1 jogador conectado.';
    else if(disconnected>0&&state.status==='lobby') info.textContent=`${disconnected} jogador(es) desconectado(s): cadeira reservada por até 60 segundos.`;
    else if(disconnected>0) info.textContent='Aguarde a reconexão ou o fim dos 60 segundos para a Máquina assumir temporariamente.';
    else if(!me?.host) info.textContent='O anfitrião está desconectado. Você pode assumir a sala e iniciar.';
    else info.textContent=`${connected} jogador(es) conectado(s). Pronto para iniciar.`;
    box.appendChild(info);
    if(state.status==='between-rounds'&&state.round<3){const s=document.createElement('div');s.className='wait';s.textContent='Novos jogadores ainda podem entrar antes do início da próxima rodada.';box.appendChild(s)}
  } else if(state.status==='lobby') {
    const hostName=host?`${avatarHTML(host.avatar,'xs')} ${esc(host.name)}`:'outro jogador';
    box.innerHTML=`<div class="wait">Aguardando o anfitrião ★ ${hostName} iniciar a partida.<br><small>O jogador marcado com ★ controla o início da rodada.</small></div>`;
  }
}
function play(card,burn){
  pendingCard=card;pendingBurn=burn;
  if(burn){
    socket.emit('burnMatch',{cardId:card.id});
    pendingCard=null;pendingBurn=false;
    return;
  }
  // O Valete jogado normalmente pede o naipe quando ainda restarem cartas.
  if(card.rank==='J'&&state.me.hand.length>1){$('#suitDialog').showModal();return}
  socket.emit('playCard',{cardId:card.id});
  pendingCard=null;pendingBurn=false;
}
function playQuick(card){
  if(!card||!socket.connected||state?.paused)return;
  socket.emit('quickAction',{cardId:card.id});
}

function playDouble(pair){
  if(!pair?.cardIds?.length||pair.cardIds.length<2)return;
  pendingDouble=pair;
  const first=state.me.hand.find(c=>c.id===pair.cardIds[0]);
  const remainingAfter=state.me.hand.length-2;
  if(first?.rank==='J'&&remainingAfter>0){$('#suitDialog').showModal();return}
  socket.emit('playDoubleCard',{firstCardId:pair.cardIds[0],secondCardId:pair.cardIds[1]});
  pendingDouble=null;
}
function canBatendo(){
  return state.me.hand.length===2 && ((state.me.burnFinishableCardIds||[]).length>0 || (state.me.doublePairs||[]).length>0);
}
function cardHTML(c,small){const red=c.suit==='hearts'||c.suit==='diamonds';return `<div class="playing-card ${red?'red-suit':'black-suit'}"><div class="corner"><span class="corner-rank">${c.rank}</span><span class="corner-suit">${suitGlyph[c.suit]}</span></div><div class="suit-big">${suitGlyph[c.suit]}</div><div class="corner bottom"><span class="corner-rank">${c.rank}</span><span class="corner-suit">${suitGlyph[c.suit]}</span></div>${specialName[c.rank]?`<div class="special-tag">${specialName[c.rank]}</div>`:''}</div>`}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}

let mobileResizeTimer;window.addEventListener('resize',()=>{clearTimeout(mobileResizeTimer);mobileResizeTimer=setTimeout(()=>{if(state)renderPlayers()},120)});
window.addEventListener('orientationchange',()=>setTimeout(()=>{if(state)renderPlayers()},180));


// V38: o jogo só conecta ao Socket.IO depois que a sessão Google foi validada.
initializeGoogleAuth();
