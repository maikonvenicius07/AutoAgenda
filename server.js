require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '3.8.0';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Porto_Velho';

function hojeApp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function agoraApp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { data: `${map.year}-${map.month}-${map.day}`, hora: `${map.hour}:${map.minute}` };
}

if (!process.env.DATABASE_URL) {
  console.warn('ATENÇÃO: DATABASE_URL não configurada.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.disable('x-powered-by');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// No Render há um proxy reverso na frente da aplicação.
// Confiar em apenas um salto permite que req.ip represente o cliente sem
// aceitar cegamente qualquer X-Forwarded-For enviado pelo navegador.
if (IS_PRODUCTION) app.set('trust proxy', 1);

// O AutoAgenda usa apenas parâmetros de consulta simples (chave=valor).
// Evita o parser estendido de objetos/arrays aninhados e reduz superfície de ataque.
app.set('query parser', 'simple');

// V3.0 — login individual.
// As variáveis antigas do Render continuam sendo usadas APENAS para criar o
// primeiro administrador quando a tabela de usuários ainda está vazia.
// Depois disso, a autenticação passa a ser exclusivamente por usuários do PostgreSQL.
const BOOTSTRAP_USER = String(process.env.AUTOAGENDA_USER || '').trim();
const BOOTSTRAP_PASSWORD = String(process.env.AUTOAGENDA_PASSWORD || '');
const BOOTSTRAP_CONFIGURED = Boolean(BOOTSTRAP_USER && BOOTSTRAP_PASSWORD);
let LOGIN_READY = false;

const SESSION_COOKIE = 'autoagenda_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Proteção contra tentativas repetidas de login.
const AUTH_MAX_FAILURES = 8;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_BLOCK_MS = 15 * 60 * 1000;
const authAttempts = new Map();

// Hash fictício: não é uma credencial. Serve apenas para executar o mesmo custo
// de scrypt quando o login não existe, reduzindo diferença de tempo que poderia
// ajudar na enumeração de usuários.
const AUTH_DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$T6Bmx1TlqCzAWgkP5FCGCg==$GtP+wpFzAk2UKxJmS5vCJDwrvuIkGUGz8oNrPlnOoYywRz4TzGgXxWuiaHkhoKpmfPIoTkXzgbfpMtzmTU9pHQ==';

function authClientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'desconhecido');
}

function authState(req) {
  const key = authClientKey(req);
  const now = Date.now();
  let state = authAttempts.get(key);
  if (!state) return { key, blocked: false, retryAfter: 0 };

  if (state.blockedUntil && state.blockedUntil > now) {
    return { key, blocked: true, retryAfter: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)) };
  }

  if ((state.firstFailureAt || 0) + AUTH_WINDOW_MS <= now || (state.blockedUntil && state.blockedUntil <= now)) {
    authAttempts.delete(key);
    return { key, blocked: false, retryAfter: 0 };
  }
  return { key, blocked: false, retryAfter: 0 };
}

function registrarFalhaAuth(key) {
  const now = Date.now();

  // Limpeza defensiva para impedir crescimento indefinido do mapa em caso de
  // muitas origens diferentes tentando autenticar.
  if (authAttempts.size > 5000) {
    for (const [chave, item] of authAttempts) {
      const terminouBloqueio = !item.blockedUntil || item.blockedUntil <= now;
      const terminouJanela = (item.firstFailureAt || 0) + AUTH_WINDOW_MS <= now;
      if (terminouBloqueio && terminouJanela) authAttempts.delete(chave);
    }
  }

  let state = authAttempts.get(key);
  if (!state || (state.firstFailureAt || 0) + AUTH_WINDOW_MS <= now) {
    state = { failures: 0, firstFailureAt: now, blockedUntil: 0 };
  }
  state.failures += 1;
  if (state.failures >= AUTH_MAX_FAILURES) state.blockedUntil = now + AUTH_BLOCK_MS;
  authAttempts.set(key, state);
  return state;
}

function limparFalhasAuth(key) {
  authAttempts.delete(key);
}

function hashSha256(valor) {
  return crypto.createHash('sha256').update(String(valor || ''), 'utf8').digest('hex');
}

function cookieValor(req, nome) {
  const raw = String(req.headers.cookie || '');
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (k !== nome) continue;
    try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return parte.slice(i + 1).trim(); }
  }
  return '';
}

function definirCookieSessao(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const partes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (IS_PRODUCTION) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function limparCookieSessao(res) {
  const partes = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (IS_PRODUCTION) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function scryptAsync(senha, salt, opcoes) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, salt, 64, opcoes, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function criarHashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = await scryptAsync(String(senha), salt, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verificarHashSenha(senha, armazenado) {
  try {
    const [alg, nStr, rStr, pStr, saltB64, hashB64] = String(armazenado || '').split('$');
    if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
    const N = Number(nStr), r = Number(rStr), p = Number(pStr);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    const esperado = Buffer.from(hashB64, 'base64');
    const atual = await scryptAsync(String(senha), Buffer.from(saltB64, 'base64'), {
      N, r, p, maxmem: 64 * 1024 * 1024
    });
    return esperado.length === atual.length && crypto.timingSafeEqual(esperado, atual);
  } catch {
    return false;
  }
}

function normalizarLogin(valor) {
  return String(valor || '').trim().toLowerCase();
}

function validarLoginUsuario(login) {
  return /^[a-z0-9._-]{3,60}$/.test(login);
}

function validarSenhaNova(senha) {
  const s = String(senha || '');
  if (s.length < 8 || s.length > 128) return 'A senha deve ter entre 8 e 128 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'A senha deve conter pelo menos uma letra e um número.';
  return '';
}

function perfilUsuario(valor) {
  const p = String(valor || '').trim().toUpperCase();
  return ['ADMIN','INSTRUTOR'].includes(p) ? p : '';
}

async function autenticarSessao(req) {
  const token = cookieValor(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashSha256(token);
  const r = await query(`
    SELECT
      s.id AS sessao_id,
      s.expira_em,
      u.id, u.nome, u.login, u.email, u.perfil, u.ativo, u.instrutor_id,
      i.nome AS instrutor_nome
    FROM autoagenda.sessoes s
    JOIN autoagenda.usuarios u ON u.id = s.usuario_id
    LEFT JOIN autoagenda.instrutores i ON i.id = u.instrutor_id
    WHERE s.token_hash = $1
      AND s.revogada_em IS NULL
      AND s.expira_em > NOW()
      AND u.ativo = TRUE
    LIMIT 1
  `, [tokenHash]);
  if (!r.rowCount) return null;

  const sessao = r.rows[0];
  query(`
    UPDATE autoagenda.sessoes
    SET ultimo_uso_em = NOW()
    WHERE id = $1
      AND ultimo_uso_em < NOW() - INTERVAL '15 minutes'
  `, [sessao.sessao_id]).catch(() => {});

  return {
    sessao_id: Number(sessao.sessao_id),
    id: Number(sessao.id),
    nome: sessao.nome,
    login: sessao.login,
    email: sessao.email,
    perfil: sessao.perfil,
    ativo: sessao.ativo,
    instrutor_id: sessao.instrutor_id ? Number(sessao.instrutor_id) : null,
    instrutor_nome: sessao.instrutor_nome || null
  };
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.perfil !== 'ADMIN') {
    return res.status(403).json({ error: 'Apenas administradores podem gerenciar usuários.' });
  }
  next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (req.path.startsWith('/api/') || req.path.startsWith('/whatsapp/') || req.path.startsWith('/confirmar/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// V3.5 — restauração de backup JSON.
// O parser ampliado é aplicado SOMENTE às duas rotas de restauração. As demais
// APIs continuam limitadas a 1 MB, reduzindo a superfície de consumo de memória.
const RESTORE_MAX_BYTES = 10 * 1024 * 1024;
const backupRestoreRawParser = express.raw({ type: 'application/json', limit: '10mb' });
app.use('/api/backup/restaurar/validar', backupRestoreRawParser);
app.use('/api/backup/restaurar/executar', backupRestoreRawParser);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// Os arquivos estáticos (inclusive a tela de login) podem ser carregados sem sessão.
// Os dados e ações do backend continuam protegidos pelo middleware logo abaixo.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.use(async (req, res, next) => {
  const publico = req.path === '/api/health'
    || req.path === '/api/auth/status'
    || req.path === '/api/auth/login';
  if (publico) return next();

  if (!req.path.startsWith('/api/') && !req.path.startsWith('/whatsapp/')) return next();

  if (!LOGIN_READY) {
    return res.status(503).json({
      error: 'Login individual ainda não foi inicializado. Configure AUTOAGENDA_USER e AUTOAGENDA_PASSWORD no Render para criar o primeiro administrador.',
      security_setup_required: true
    });
  }

  try {
    const usuario = await autenticarSessao(req);
    if (!usuario) {
      limparCookieSessao(res);
      return res.status(401).json({ error: 'Sessão expirada ou usuário não autenticado.', login_required: true });
    }
    req.usuario = usuario;
    req.sessaoId = usuario.sessao_id;
    next();
  } catch (error) {
    console.error('Erro ao validar sessão:', error);
    res.status(500).json({ error: 'Erro ao validar a sessão.' });
  }
});

async function query(text, params = []) {
  return pool.query(text, params);
}

// ========================= V3.0 — AUTENTICAÇÃO INDIVIDUAL =========================
app.get('/api/auth/status', async (req, res) => {
  if (!LOGIN_READY) {
    return res.json({
      authenticated: false,
      setup_required: true,
      version: APP_VERSION
    });
  }

  try {
    const usuario = await autenticarSessao(req);
    if (!usuario) {
      limparCookieSessao(res);
      return res.json({ authenticated: false, setup_required: false, version: APP_VERSION });
    }
    res.json({
      authenticated: true,
      setup_required: false,
      version: APP_VERSION,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        login: usuario.login,
        email: usuario.email,
        perfil: usuario.perfil,
        instrutor_id: usuario.instrutor_id,
        instrutor_nome: usuario.instrutor_nome
      }
    });
  } catch (error) {
    console.error('Erro ao consultar sessão:', error);
    res.status(500).json({ error: 'Erro ao consultar a sessão.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!LOGIN_READY) {
    return res.status(503).json({
      error: 'O login individual ainda não foi inicializado. Configure AUTOAGENDA_USER e AUTOAGENDA_PASSWORD no Render e faça novo deploy.',
      security_setup_required: true
    });
  }

  const state = authState(req);
  if (state.blocked) {
    res.setHeader('Retry-After', String(state.retryAfter));
    return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
  }

  const login = normalizarLogin(req.body?.login);
  const senha = String(req.body?.senha || '');
  if (!login || !senha) return res.status(400).json({ error: 'Informe login e senha.' });

  try {
    const q = await query(`
      SELECT u.id, u.nome, u.login, u.email, u.senha_hash, u.perfil, u.ativo,
             u.instrutor_id, i.nome AS instrutor_nome
      FROM autoagenda.usuarios u
      LEFT JOIN autoagenda.instrutores i ON i.id = u.instrutor_id
      WHERE LOWER(u.login) = LOWER($1)
      LIMIT 1
    `, [login]);

    const usuario = q.rows[0];
    const hashParaVerificar = usuario?.senha_hash || AUTH_DUMMY_PASSWORD_HASH;
    const senhaConfere = await verificarHashSenha(senha, hashParaVerificar);
    const valido = usuario?.ativo === true && senhaConfere;
    if (!valido) {
      registrarFalhaAuth(state.key);
      return res.status(401).json({ error: 'Login ou senha inválidos.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashSha256(token);
    const sessionTtlSeconds = Math.floor(SESSION_TTL_MS / 1000);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    const ipHash = hashSha256(authClientKey(req));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        DELETE FROM autoagenda.sessoes
        WHERE expira_em <= NOW()
           OR (revogada_em IS NOT NULL AND revogada_em < NOW() - INTERVAL '7 days')
      `);
      await client.query(`
        INSERT INTO autoagenda.sessoes
          (usuario_id, token_hash, expira_em, ultimo_uso_em, user_agent, ip_hash)
        VALUES ($1,$2,NOW() + ($3 * INTERVAL '1 second'),NOW(),$4,$5)
      `, [usuario.id, tokenHash, sessionTtlSeconds, userAgent || null, ipHash]);
      await client.query(`
        UPDATE autoagenda.usuarios
        SET ultimo_login_em = NOW(), atualizado_em = NOW()
        WHERE id = $1
      `, [usuario.id]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }

    limparFalhasAuth(state.key);
    definirCookieSessao(res, token);
    res.json({
      ok: true,
      usuario: {
        id: Number(usuario.id),
        nome: usuario.nome,
        login: usuario.login,
        email: usuario.email,
        perfil: usuario.perfil,
        instrutor_id: usuario.instrutor_id ? Number(usuario.instrutor_id) : null,
        instrutor_nome: usuario.instrutor_nome || null
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao realizar login.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    if (req.sessaoId) {
      await query(`
        UPDATE autoagenda.sessoes
        SET revogada_em = NOW()
        WHERE id = $1 AND revogada_em IS NULL
      `, [req.sessaoId]);
    }
  } catch (error) {
    console.error('Erro ao encerrar sessão:', error);
  } finally {
    limparCookieSessao(res);
  }
  res.json({ ok: true });
});

app.get('/api/usuarios', exigirAdmin, async (req, res) => {
  try {
    const r = await query(`
      SELECT u.id, u.nome, u.login, u.email, u.perfil, u.ativo,
             u.instrutor_id, i.nome AS instrutor_nome,
             u.ultimo_login_em, u.criado_em, u.atualizado_em
      FROM autoagenda.usuarios u
      LEFT JOIN autoagenda.instrutores i ON i.id = u.instrutor_id
      ORDER BY u.ativo DESC, u.nome, u.login
    `);
    res.json(r.rows);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao carregar usuários.' });
  }
});

app.post('/api/usuarios', exigirAdmin, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const login = normalizarLogin(req.body?.login);
  const email = String(req.body?.email || '').trim().toLowerCase() || null;
  const perfil = perfilUsuario(req.body?.perfil);
  const senha = String(req.body?.senha || '');
  const instrutorId = perfil === 'INSTRUTOR' ? Number(req.body?.instrutor_id) : null;

  if (nome.length < 2 || nome.length > 150) return res.status(400).json({ error: 'Informe um nome válido.' });
  if (!validarLoginUsuario(login)) return res.status(400).json({ error: 'Login inválido. Use 3 a 60 caracteres: letras, números, ponto, hífen ou sublinhado.' });
  if (!perfil) return res.status(400).json({ error: 'Perfil inválido.' });
  if (perfil === 'INSTRUTOR' && (!Number.isInteger(instrutorId) || instrutorId < 1)) {
    return res.status(400).json({ error: 'Selecione o instrutor vinculado a esta conta.' });
  }
  const erroSenha = validarSenhaNova(senha);
  if (erroSenha) return res.status(400).json({ error: erroSenha });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (perfil === 'INSTRUTOR') {
      const iq = await client.query('SELECT id, ativo FROM autoagenda.instrutores WHERE id=$1 FOR SHARE', [instrutorId]);
      if (!iq.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Instrutor vinculado não encontrado.' });
      }
      if (iq.rows[0].ativo === false) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'O instrutor vinculado está inativo.' });
      }
    }

    const senhaHash = await criarHashSenha(senha);
    const r = await client.query(`
      INSERT INTO autoagenda.usuarios (nome, login, email, senha_hash, perfil, instrutor_id, ativo)
      VALUES ($1,$2,$3,$4,$5,$6,TRUE)
      RETURNING id, nome, login, email, perfil, instrutor_id, ativo, ultimo_login_em, criado_em, atualizado_em
    `, [nome, login, email, senhaHash, perfil, instrutorId]);
    await client.query('COMMIT');

    const usuario = r.rows[0];
    if (usuario.instrutor_id) {
      const iq = await query('SELECT nome FROM autoagenda.instrutores WHERE id=$1', [usuario.instrutor_id]);
      usuario.instrutor_nome = iq.rows[0]?.nome || null;
    } else {
      usuario.instrutor_nome = null;
    }
    res.status(201).json(usuario);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe usuário com este login, e-mail ou instrutor vinculado.' });
    }
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  } finally {
    client.release();
  }
});

app.put('/api/usuarios/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const nome = String(req.body?.nome || '').trim();
  const login = normalizarLogin(req.body?.login);
  const email = String(req.body?.email || '').trim().toLowerCase() || null;
  const perfil = perfilUsuario(req.body?.perfil);
  const senha = String(req.body?.senha || '');
  const instrutorId = perfil === 'INSTRUTOR' ? Number(req.body?.instrutor_id) : null;

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (nome.length < 2 || nome.length > 150) return res.status(400).json({ error: 'Informe um nome válido.' });
  if (!validarLoginUsuario(login)) return res.status(400).json({ error: 'Login inválido. Use 3 a 60 caracteres: letras, números, ponto, hífen ou sublinhado.' });
  if (!perfil) return res.status(400).json({ error: 'Perfil inválido.' });
  if (perfil === 'INSTRUTOR' && (!Number.isInteger(instrutorId) || instrutorId < 1)) {
    return res.status(400).json({ error: 'Selecione o instrutor vinculado a esta conta.' });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (senha) {
    const erroSenha = validarSenhaNova(senha);
    if (erroSenha) return res.status(400).json({ error: erroSenha });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const atualQ = await client.query(`
      SELECT id, nome, login, perfil, instrutor_id, ativo
      FROM autoagenda.usuarios
      WHERE id = $1
      FOR UPDATE
    `, [id]);
    if (!atualQ.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const atual = atualQ.rows[0];

    if (atual.perfil === 'ADMIN' && perfil !== 'ADMIN' && atual.ativo) {
      const admins = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM autoagenda.usuarios
        WHERE ativo = TRUE AND perfil = 'ADMIN' AND id <> $1
      `, [id]);
      if (Number(admins.rows[0].total || 0) < 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Não é possível remover o perfil do último administrador ativo.' });
      }
    }

    if (perfil === 'INSTRUTOR') {
      const iq = await client.query('SELECT id, ativo FROM autoagenda.instrutores WHERE id=$1 FOR SHARE', [instrutorId]);
      if (!iq.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Instrutor vinculado não encontrado.' });
      }
      if (iq.rows[0].ativo === false) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'O instrutor vinculado está inativo.' });
      }
    }

    const senhaHash = senha ? await criarHashSenha(senha) : null;
    const r = await client.query(`
      UPDATE autoagenda.usuarios
      SET nome = $1,
          login = $2,
          email = $3,
          perfil = $4,
          instrutor_id = $5,
          senha_hash = COALESCE($6, senha_hash),
          atualizado_em = NOW()
      WHERE id = $7
      RETURNING id, nome, login, email, perfil, instrutor_id, ativo, ultimo_login_em, criado_em, atualizado_em
    `, [nome, login, email, perfil, instrutorId, senhaHash, id]);

    if (senha || perfil !== atual.perfil || Number(instrutorId || 0) !== Number(atual.instrutor_id || 0)) {
      await client.query(`
        UPDATE autoagenda.sessoes
        SET revogada_em = NOW()
        WHERE usuario_id = $1
          AND revogada_em IS NULL
          AND id <> $2
      `, [id, req.sessaoId]);
    }

    await client.query('COMMIT');

    const usuario = r.rows[0];
    if (usuario.instrutor_id) {
      const iq = await query('SELECT nome FROM autoagenda.instrutores WHERE id=$1', [usuario.instrutor_id]);
      usuario.instrutor_nome = iq.rows[0]?.nome || null;
    } else {
      usuario.instrutor_nome = null;
    }
    res.json(usuario);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe usuário com este login, e-mail ou instrutor vinculado.' });
    }
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  } finally {
    client.release();
  }
});

app.patch('/api/usuarios/:id/situacao', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const ativo = req.body?.ativo === true;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (id === Number(req.usuario?.id) && !ativo) {
    return res.status(409).json({ error: 'Você não pode desativar o próprio usuário enquanto está conectado.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`
      SELECT id, perfil, ativo
      FROM autoagenda.usuarios
      WHERE id = $1
      FOR UPDATE
    `, [id]);
    if (!q.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const u = q.rows[0];

    if (!ativo && u.ativo && u.perfil === 'ADMIN') {
      const admins = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM autoagenda.usuarios
        WHERE ativo = TRUE AND perfil = 'ADMIN' AND id <> $1
      `, [id]);
      if (Number(admins.rows[0].total || 0) < 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Não é possível desativar o último administrador ativo.' });
      }
    }

    const r = await client.query(`
      UPDATE autoagenda.usuarios
      SET ativo = $1, atualizado_em = NOW()
      WHERE id = $2
      RETURNING id, nome, login, email, perfil, instrutor_id, ativo, ultimo_login_em, criado_em, atualizado_em
    `, [ativo, id]);

    if (!ativo) {
      await client.query(`
        UPDATE autoagenda.sessoes
        SET revogada_em = NOW()
        WHERE usuario_id = $1 AND revogada_em IS NULL
      `, [id]);
    }

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erro ao alterar situação do usuário:', error);
    res.status(500).json({ error: 'Erro ao alterar situação do usuário.' });
  } finally {
    client.release();
  }
});

function normalizarWhatsAppParaLink(valor) {
  let d = String(valor || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (!d.startsWith('55')) {
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    else return '';
  }
  return /^55\d{10,11}$/.test(d) ? d : '';
}

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS autoagenda');

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        login VARCHAR(60) NOT NULL,
        email VARCHAR(180),
        senha_hash TEXT NOT NULL,
        perfil VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        ultimo_login_em TIMESTAMP,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (perfil IN ('ADMIN','INSTRUTOR'))
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_usuarios_login
      ON autoagenda.usuarios(LOWER(login))
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_usuarios_email
      ON autoagenda.usuarios(LOWER(email))
      WHERE email IS NOT NULL AND email <> ''
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.sessoes (
        id BIGSERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES autoagenda.usuarios(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expira_em TIMESTAMP NOT NULL,
        ultimo_uso_em TIMESTAMP NOT NULL DEFAULT NOW(),
        revogada_em TIMESTAMP,
        user_agent VARCHAR(500),
        ip_hash CHAR(64),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_sessoes_usuario ON autoagenda.sessoes(usuario_id, expira_em)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_sessoes_expira ON autoagenda.sessoes(expira_em)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.instrutores (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        whatsapp VARCHAR(30),
        email VARCHAR(180),
        categorias VARCHAR(20) DEFAULT 'AB',
        disponibilidade_personalizada BOOLEAN NOT NULL DEFAULT FALSE,
        dias_trabalho INTEGER[],
        hora_inicio TIME,
        hora_fim TIME,
        intervalo_inicio TIME,
        intervalo_fim TIME,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // V3.1 — vínculo entre a conta de login e o cadastro operacional do instrutor.
    // A coluna é adicionada somente depois da tabela de instrutores existir, mantendo migração segura.
    await client.query(`ALTER TABLE autoagenda.usuarios ADD COLUMN IF NOT EXISTS instrutor_id INTEGER`);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_autoagenda_usuarios_instrutor'
            AND conrelid = 'autoagenda.usuarios'::regclass
        ) THEN
          ALTER TABLE autoagenda.usuarios
          ADD CONSTRAINT fk_autoagenda_usuarios_instrutor
          FOREIGN KEY (instrutor_id) REFERENCES autoagenda.instrutores(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_usuarios_instrutor
      ON autoagenda.usuarios(instrutor_id)
      WHERE instrutor_id IS NOT NULL AND perfil = 'INSTRUTOR'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.instrutor_indisponibilidades (
        id SERIAL PRIMARY KEY,
        instrutor_id INTEGER NOT NULL REFERENCES autoagenda.instrutores(id) ON DELETE CASCADE,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        motivo VARCHAR(250),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (data_fim >= data_inicio)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.alunos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        cpf VARCHAR(11),
        whatsapp VARCHAR(30) NOT NULL,
        email VARCHAR(180),
        data_nascimento DATE,
        categoria VARCHAR(10) DEFAULT 'B',
        aulas_contratadas INTEGER NOT NULL DEFAULT 20 CHECK (aulas_contratadas > 0),
        -- Campo legado mantido por compatibilidade com versões anteriores.
        aulas_realizadas INTEGER NOT NULL DEFAULT 0 CHECK (aulas_realizadas >= 0),
        -- Aulas realizadas antes de começar a usar o AutoAgenda.
        aulas_realizadas_anteriores INTEGER NOT NULL DEFAULT 0 CHECK (aulas_realizadas_anteriores >= 0),
        observacoes TEXT,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // V3.8 — avaliação do aluno para encaminhamento à prova.
    // Cada nova avaliação vira um registro histórico; a avaliação mais recente representa o status atual.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.avaliacoes_aluno (
        id SERIAL PRIMARY KEY,
        aluno_id INTEGER NOT NULL REFERENCES autoagenda.alunos(id) ON DELETE CASCADE,
        instrutor_id INTEGER REFERENCES autoagenda.instrutores(id) ON DELETE SET NULL,
        avaliador_nome VARCHAR(150) NOT NULL,
        avaliador_perfil VARCHAR(20) NOT NULL CHECK (avaliador_perfil IN ('ADMIN','INSTRUTOR')),
        resultado VARCHAR(20) NOT NULL CHECK (resultado IN ('EM_AVALIACAO','APTO','NAO_APTO')),
        observacoes TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_avaliacoes_aluno_data ON autoagenda.avaliacoes_aluno(aluno_id, criado_em DESC, id DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_avaliacoes_instrutor ON autoagenda.avaliacoes_aluno(instrutor_id, criado_em DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.veiculos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        placa VARCHAR(15),
        categoria VARCHAR(10) DEFAULT 'B',
        situacao VARCHAR(20) NOT NULL DEFAULT 'DISPONIVEL',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.veiculo_indisponibilidades (
        id SERIAL PRIMARY KEY,
        veiculo_id INTEGER NOT NULL REFERENCES autoagenda.veiculos(id) ON DELETE CASCADE,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'INDISPONIVEL',
        motivo VARCHAR(250),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (data_fim >= data_inicio)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.locais (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        endereco VARCHAR(300),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.configuracoes (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        dias_funcionamento INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
        hora_abertura TIME NOT NULL DEFAULT '07:00',
        hora_encerramento TIME NOT NULL DEFAULT '20:00',
        duracao_padrao_minutos INTEGER NOT NULL DEFAULT 50
          CHECK (duracao_padrao_minutos BETWEEN 10 AND 240),
        intervalo_minutos INTEGER NOT NULL DEFAULT 0
          CHECK (intervalo_minutos BETWEEN 0 AND 120),
        lembrete_dia_anterior_ativo BOOLEAN NOT NULL DEFAULT TRUE,
        lembrete_dia_anterior_hora TIME NOT NULL DEFAULT '18:00',
        lembrete_horas_antes_ativo BOOLEAN NOT NULL DEFAULT TRUE,
        lembrete_horas_antes INTEGER NOT NULL DEFAULT 2
          CHECK (lembrete_horas_antes BETWEEN 1 AND 24),
        whatsapp_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE,
        email_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE,
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO autoagenda.configuracoes
        (id, dias_funcionamento, hora_abertura, hora_encerramento, duracao_padrao_minutos, intervalo_minutos)
      VALUES (1, ARRAY[0,1,2,3,4,5,6], '07:00', '20:00', 50, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.planos_aula (
        id SERIAL PRIMARY KEY,
        aluno_id INTEGER NOT NULL REFERENCES autoagenda.alunos(id),
        instrutor_id INTEGER NOT NULL REFERENCES autoagenda.instrutores(id),
        veiculo_id INTEGER NOT NULL REFERENCES autoagenda.veiculos(id),
        local_id INTEGER NOT NULL REFERENCES autoagenda.locais(id),
        data_inicio DATE NOT NULL,
        hora_inicio TIME NOT NULL,
        duracao_base_minutos INTEGER NOT NULL DEFAULT 50 CHECK (duracao_base_minutos > 0),
        aulas_por_encontro INTEGER NOT NULL DEFAULT 1 CHECK (aulas_por_encontro BETWEEN 1 AND 4),
        total_aulas INTEGER NOT NULL CHECK (total_aulas > 0),
        dias_semana INTEGER[] NOT NULL,
        observacoes TEXT,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.aulas (
        id SERIAL PRIMARY KEY,
        aluno_id INTEGER NOT NULL REFERENCES autoagenda.alunos(id),
        instrutor_id INTEGER NOT NULL REFERENCES autoagenda.instrutores(id),
        veiculo_id INTEGER NOT NULL REFERENCES autoagenda.veiculos(id),
        local_id INTEGER NOT NULL REFERENCES autoagenda.locais(id),
        data_aula DATE NOT NULL,
        hora_inicio TIME NOT NULL,
        duracao_minutos INTEGER NOT NULL DEFAULT 50 CHECK (duracao_minutos > 0),
        status VARCHAR(30) NOT NULL DEFAULT 'AGENDADA'
          CHECK (status IN ('AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU')),
        confirmacao_status VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO'
          CHECK (confirmacao_status IN ('AGUARDANDO','CONFIRMADA','PEDIU_REAGENDAMENTO')),
        confirmacao_origem VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
          CHECK (confirmacao_origem IN ('MANUAL','WHATSAPP','SISTEMA')),
        confirmacao_atualizada_em TIMESTAMP,
        confirmacao_token_hash VARCHAR(64),
        confirmacao_token_expira_em TIMESTAMP,
        confirmacao_token_usado_em TIMESTAMP,
        lembrete_dia_anterior_em TIMESTAMP,
        lembrete_dia_anterior_enviado BOOLEAN NOT NULL DEFAULT FALSE,
        lembrete_dia_anterior_enviado_em TIMESTAMP,
        lembrete_horas_antes_em TIMESTAMP,
        lembrete_horas_antes_enviado BOOLEAN NOT NULL DEFAULT FALSE,
        lembrete_horas_antes_enviado_em TIMESTAMP,
        observacoes TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // V3.3 — fila auditável de envios de lembretes pelo WhatsApp oficial.
    // O estado fica separado da aula para registrar pendência, falha e aceite da API
    // sem remover os campos legados de lembrete usados pela interface atual.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.lembrete_envios (
        id BIGSERIAL PRIMARY KEY,
        aula_id INTEGER NOT NULL REFERENCES autoagenda.aulas(id) ON DELETE CASCADE,
        tipo VARCHAR(20) NOT NULL
          CHECK (tipo IN ('DIA_ANTERIOR','HORAS_ANTES')),
        canal VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP'
          CHECK (canal = 'WHATSAPP'),
        agendado_em TIMESTAMP NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
          CHECK (status IN ('PENDENTE','PROCESSANDO','ENVIADO','FALHOU','CANCELADO')),
        automatico BOOLEAN NOT NULL DEFAULT TRUE,
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
        ultima_tentativa_em TIMESTAMP,
        processando_em TIMESTAMP,
        enviado_em TIMESTAMP,
        provider_message_id VARCHAR(255),
        erro TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (aula_id, tipo, canal)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_lembrete_envios_fila ON autoagenda.lembrete_envios(status, agendado_em)');

    // V3.7 — fila auditável de comunicações transacionais pelo WhatsApp oficial.
    // Usa um template genérico aprovado para agendamento, reagendamento, cancelamento
    // e resumos de plano. Lembretes continuam na fila histórica V3.3.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.whatsapp_envios (
        id BIGSERIAL PRIMARY KEY,
        aula_id INTEGER REFERENCES autoagenda.aulas(id) ON DELETE SET NULL,
        plan_id INTEGER REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL,
        evento VARCHAR(40) NOT NULL
          CHECK (evento IN (
            'AGENDAMENTO','REAGENDAMENTO','CANCELAMENTO',
            'PLANO_AGENDADO','PLANO_ATUALIZADO','PLANO_CANCELADO'
          )),
        destinatario VARCHAR(30) NOT NULL,
        chave_idempotencia VARCHAR(256) NOT NULL UNIQUE,
        agendado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
          CHECK (status IN ('PENDENTE','PROCESSANDO','ENVIADO','FALHOU','CANCELADO')),
        automatico BOOLEAN NOT NULL DEFAULT TRUE,
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
        ultima_tentativa_em TIMESTAMP,
        processando_em TIMESTAMP,
        enviado_em TIMESTAMP,
        provider_message_id VARCHAR(255),
        erro TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (aula_id IS NOT NULL OR plan_id IS NOT NULL)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_whatsapp_envios_fila ON autoagenda.whatsapp_envios(status, agendado_em)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_whatsapp_envios_aula ON autoagenda.whatsapp_envios(aula_id, evento)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_whatsapp_envios_plano ON autoagenda.whatsapp_envios(plan_id, evento)');

    // V3.4 — fila auditável de e-mails transacionais e lembretes.
    // O envio usa uma API HTTPS oficial (Resend) e nasce desativado.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.email_envios (
        id BIGSERIAL PRIMARY KEY,
        aula_id INTEGER REFERENCES autoagenda.aulas(id) ON DELETE SET NULL,
        plan_id INTEGER REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL,
        evento VARCHAR(40) NOT NULL
          CHECK (evento IN (
            'AGENDAMENTO','REAGENDAMENTO','CANCELAMENTO',
            'LEMBRETE_DIA_ANTERIOR','LEMBRETE_HORAS_ANTES',
            'PLANO_AGENDADO','PLANO_ATUALIZADO','PLANO_CANCELADO'
          )),
        destinatario VARCHAR(180) NOT NULL,
        assunto VARCHAR(250) NOT NULL,
        corpo_html TEXT NOT NULL,
        corpo_texto TEXT,
        chave_idempotencia VARCHAR(256) NOT NULL UNIQUE,
        agendado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
          CHECK (status IN ('PENDENTE','PROCESSANDO','ENVIADO','FALHOU','CANCELADO')),
        automatico BOOLEAN NOT NULL DEFAULT TRUE,
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
        ultima_tentativa_em TIMESTAMP,
        processando_em TIMESTAMP,
        enviado_em TIMESTAMP,
        provider_message_id VARCHAR(255),
        erro TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_email_envios_fila ON autoagenda.email_envios(status, agendado_em)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_email_envios_aula ON autoagenda.email_envios(aula_id, evento)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_email_envios_plano ON autoagenda.email_envios(plan_id, evento)');

    // V3.6 — auditoria do backup nativo do PostgreSQL executado externamente.
    // A rotina de dump roda em um Cron Job separado e registra aqui apenas metadados
    // seguros (status, nome do arquivo, destino, tamanho e hash), nunca credenciais.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.backup_execucoes (
        id BIGSERIAL PRIMARY KEY,
        tipo VARCHAR(30) NOT NULL DEFAULT 'POSTGRES_S3'
          CHECK (tipo IN ('POSTGRES_S3')),
        status VARCHAR(20) NOT NULL DEFAULT 'INICIADO'
          CHECK (status IN ('INICIADO','ENVIADO','FALHOU')),
        arquivo VARCHAR(255),
        destino TEXT,
        tamanho_bytes BIGINT CHECK (tamanho_bytes IS NULL OR tamanho_bytes >= 0),
        sha256 CHAR(64),
        retencao_dias INTEGER CHECK (retencao_dias IS NULL OR retencao_dias BETWEEN 1 AND 3650),
        iniciado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        concluido_em TIMESTAMP,
        erro TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_backup_execucoes_inicio ON autoagenda.backup_execucoes(iniciado_em DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_backup_execucoes_status ON autoagenda.backup_execucoes(status, iniciado_em DESC)');

    // V2.8 — financeiro simples separado da lógica da agenda.
    // O saldo financeiro é calculado a partir de valor_pacote - valor_pago para evitar divergências.
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.financeiro (
        id SERIAL PRIMARY KEY,
        aluno_id INTEGER NOT NULL REFERENCES autoagenda.alunos(id) ON DELETE RESTRICT,
        pacote VARCHAR(150) NOT NULL,
        valor_pacote NUMERIC(12,2) NOT NULL CHECK (valor_pacote > 0),
        quantidade_aulas INTEGER NOT NULL DEFAULT 1 CHECK (quantidade_aulas > 0),
        valor_pago NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
        data_pagamento DATE,
        vencimento DATE,
        forma_pagamento VARCHAR(30),
        observacoes TEXT,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (valor_pago <= valor_pacote)
      )
    `);

    // Migrações seguras da disponibilidade individual dos instrutores.
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS disponibilidade_personalizada BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS dias_trabalho INTEGER[]');
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS hora_inicio TIME');
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS hora_fim TIME');
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS intervalo_inicio TIME');
    await client.query('ALTER TABLE autoagenda.instrutores ADD COLUMN IF NOT EXISTS intervalo_fim TIME');

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.instrutor_indisponibilidades (
        id SERIAL PRIMARY KEY,
        instrutor_id INTEGER NOT NULL REFERENCES autoagenda.instrutores(id) ON DELETE CASCADE,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        motivo VARCHAR(250),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (data_fim >= data_inicio)
      )
    `);

    // Migrações seguras da disponibilidade dos veículos.
    await client.query("ALTER TABLE autoagenda.veiculos ADD COLUMN IF NOT EXISTS situacao VARCHAR(20) NOT NULL DEFAULT 'DISPONIVEL'");
    await client.query(`
      UPDATE autoagenda.veiculos
      SET situacao = CASE
        WHEN ativo = FALSE THEN 'INATIVO'
        WHEN situacao IS NULL OR situacao = '' THEN 'DISPONIVEL'
        ELSE UPPER(situacao)
      END
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.veiculo_indisponibilidades (
        id SERIAL PRIMARY KEY,
        veiculo_id INTEGER NOT NULL REFERENCES autoagenda.veiculos(id) ON DELETE CASCADE,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'INDISPONIVEL',
        motivo VARCHAR(250),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (data_fim >= data_inicio)
      )
    `);

    // Migrações seguras das versões anteriores.
    // CPF é opcional apenas para registros legados; novos cadastros exigem CPF válido.
    await client.query('ALTER TABLE autoagenda.alunos ADD COLUMN IF NOT EXISTS cpf VARCHAR(11)');
    await client.query('ALTER TABLE autoagenda.alunos ADD COLUMN IF NOT EXISTS data_nascimento DATE');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_alunos_cpf
      ON autoagenda.alunos(cpf)
      WHERE cpf IS NOT NULL AND cpf <> ''
    `);

    // Se a coluna nova ainda não existir, copiamos o valor legado como ponto de partida.
    await client.query('ALTER TABLE autoagenda.alunos ADD COLUMN IF NOT EXISTS aulas_realizadas_anteriores INTEGER');
    await client.query(`
      UPDATE autoagenda.alunos
      SET aulas_realizadas_anteriores = COALESCE(aulas_realizadas, 0)
      WHERE aulas_realizadas_anteriores IS NULL
    `);
    await client.query('ALTER TABLE autoagenda.alunos ALTER COLUMN aulas_realizadas_anteriores SET DEFAULT 0');
    await client.query('ALTER TABLE autoagenda.alunos ALTER COLUMN aulas_realizadas_anteriores SET NOT NULL');

    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS plan_id INTEGER');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS numero_plano INTEGER');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS aulas_unidades INTEGER NOT NULL DEFAULT 1');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS excecao_plano BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS arquivada BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMP');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS reposicao_de_id INTEGER');

    // V2.4 — confirmação da aula separada do status operacional.
    await client.query("ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_status VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO'");
    await client.query("ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_origem VARCHAR(20) NOT NULL DEFAULT 'MANUAL'");
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_atualizada_em TIMESTAMP');

    // V3.2 — link público e seguro para o próprio aluno confirmar a aula.
    // Somente o hash do token é armazenado; o token bruto existe apenas no link enviado ao aluno.
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_token_hash VARCHAR(64)');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_token_expira_em TIMESTAMP');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_token_usado_em TIMESTAMP');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_aulas_confirmacao_token ON autoagenda.aulas(confirmacao_token_hash) WHERE confirmacao_token_hash IS NOT NULL');

    // V2.5 — estrutura de lembretes, ainda com envio manual pelo WhatsApp.
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_ativo BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_hora TIME NOT NULL DEFAULT '18:00'");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes_ativo BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes INTEGER NOT NULL DEFAULT 2");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS whatsapp_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS email_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE");

    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_em TIMESTAMP');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_enviado BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_enviado_em TIMESTAMP');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_em TIMESTAMP');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_enviado BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_enviado_em TIMESTAMP');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_lembrete_dia ON autoagenda.aulas(lembrete_dia_anterior_em)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_lembrete_horas ON autoagenda.aulas(lembrete_horas_antes_em)');

    await client.query(`
      UPDATE autoagenda.aulas
      SET confirmacao_status = 'CONFIRMADA',
          confirmacao_origem = 'SISTEMA',
          confirmacao_atualizada_em = COALESCE(confirmacao_atualizada_em, atualizado_em, NOW())
      WHERE status = 'CONFIRMADA'
        AND confirmacao_status = 'AGUARDANDO'
        AND confirmacao_atualizada_em IS NULL
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'aulas_confirmacao_status_check'
            AND conrelid = 'autoagenda.aulas'::regclass
        ) THEN
          ALTER TABLE autoagenda.aulas
          ADD CONSTRAINT aulas_confirmacao_status_check
          CHECK (confirmacao_status IN ('AGUARDANDO','CONFIRMADA','PEDIU_REAGENDAMENTO'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'aulas_confirmacao_origem_check'
            AND conrelid = 'autoagenda.aulas'::regclass
        ) THEN
          ALTER TABLE autoagenda.aulas
          ADD CONSTRAINT aulas_confirmacao_origem_check
          CHECK (confirmacao_origem IN ('MANUAL','WHATSAPP','SISTEMA'));
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'aulas_plan_id_fkey'
            AND conrelid = 'autoagenda.aulas'::regclass
        ) THEN
          ALTER TABLE autoagenda.aulas
          ADD CONSTRAINT aulas_plan_id_fkey
          FOREIGN KEY (plan_id) REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'aulas_reposicao_de_id_fkey'
            AND conrelid = 'autoagenda.aulas'::regclass
        ) THEN
          ALTER TABLE autoagenda.aulas
          ADD CONSTRAINT aulas_reposicao_de_id_fkey
          FOREIGN KEY (reposicao_de_id) REFERENCES autoagenda.aulas(id) ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_data ON autoagenda.aulas(data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_ativas_data ON autoagenda.aulas(data_aula, hora_inicio) WHERE arquivada = FALSE');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_instrutor_data ON autoagenda.aulas(instrutor_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_veiculo_data ON autoagenda.aulas(veiculo_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_aluno_data ON autoagenda.aulas(aluno_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_plan ON autoagenda.aulas(plan_id, data_aula, hora_inicio)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_reposicao ON autoagenda.aulas(reposicao_de_id) WHERE reposicao_de_id IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_planos_aluno_ativo ON autoagenda.planos_aula(aluno_id, ativo)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_instrutor_indisp_periodo ON autoagenda.instrutor_indisponibilidades(instrutor_id, data_inicio, data_fim)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_veiculo_indisp_periodo ON autoagenda.veiculo_indisponibilidades(veiculo_id, data_inicio, data_fim)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_financeiro_aluno ON autoagenda.financeiro(aluno_id, ativo)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_financeiro_vencimento ON autoagenda.financeiro(vencimento) WHERE ativo = TRUE');

    await client.query(`
      INSERT INTO autoagenda.instrutores (nome, whatsapp, email, categorias)
      SELECT 'Instrutor Principal', '(69) 99999-0000', 'instrutor@autoagenda.com.br', 'AB'
      WHERE NOT EXISTS (SELECT 1 FROM autoagenda.instrutores)
    `);

    await client.query(`
      INSERT INTO autoagenda.veiculos (nome, placa, categoria)
      SELECT 'Carro de Aula', 'AAA1A11', 'B'
      WHERE NOT EXISTS (SELECT 1 FROM autoagenda.veiculos)
    `);

    await client.query(`
      INSERT INTO autoagenda.locais (nome, endereco)
      SELECT 'Ponto de Encontro', 'Endereço a definir'
      WHERE NOT EXISTS (SELECT 1 FROM autoagenda.locais)
    `);

    // V3.0 — cria o primeiro administrador usando as variáveis já existentes
    // do Render, somente quando ainda não há nenhum usuário cadastrado.
    const qtdUsuarios = await client.query('SELECT COUNT(*)::int AS total FROM autoagenda.usuarios');
    if (Number(qtdUsuarios.rows[0].total || 0) === 0 && BOOTSTRAP_CONFIGURED) {
      const loginInicial = normalizarLogin(BOOTSTRAP_USER);
      const senhaHashInicial = await criarHashSenha(BOOTSTRAP_PASSWORD);
      await client.query(`
        INSERT INTO autoagenda.usuarios (nome, login, email, senha_hash, perfil, ativo)
        VALUES ($1,$2,NULL,$3,'ADMIN',TRUE)
      `, ['Administrador AutoAgenda', loginInicial, senhaHashInicial]);
      console.log(`Login individual: primeiro administrador criado a partir de AUTOAGENDA_USER (${loginInicial}).`);
    }

    await client.query(`
      DELETE FROM autoagenda.sessoes
      WHERE expira_em <= NOW()
         OR (revogada_em IS NOT NULL AND revogada_em < NOW() - INTERVAL '7 days')
    `);

    const adminsAtivos = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM autoagenda.usuarios
      WHERE ativo = TRUE AND perfil = 'ADMIN'
    `);
    const loginReadyAfterCommit = Number(adminsAtivos.rows[0].total || 0) > 0;

    await client.query('COMMIT');
    LOGIN_READY = loginReadyAfterCommit;
    console.log(`Schema autoagenda V${APP_VERSION} verificado/criado com sucesso.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar schema autoagenda:', error);
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const result = await query(`
      SELECT NOW() AS agora,
             EXISTS (
               SELECT 1 FROM information_schema.schemata
               WHERE schema_name = 'autoagenda'
             ) AS schema_autoagenda
    `);
    res.json({ ok: true, version: APP_VERSION, login_individual: true, security_ready: LOGIN_READY, setup_required: !LOGIN_READY, database: true, schema_autoagenda: result.rows[0].schema_autoagenda, agora: result.rows[0].agora });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, database: false, error: 'Falha ao conectar ao banco.' });
  }
});

// ========================= V3.1 — NÍVEIS DE ACESSO =========================
function instrutorIdDaSessao(req) {
  if (req.usuario?.perfil !== 'INSTRUTOR') return 0;
  const id = Number(req.usuario?.instrutor_id || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function usuarioEhAdmin(req) {
  return req.usuario?.perfil === 'ADMIN';
}


function rotaPermitidaAoInstrutor(req) {
  const metodo = String(req.method || 'GET').toUpperCase();
  const caminho = req.path;

  if (metodo === 'GET') {
    if (/^\/whatsapp\/aula\/\d+$/.test(caminho)) return true;
    return caminho === '/api/alunos'
      || /^\/api\/alunos\/\d+$/.test(caminho)
      || /^\/api\/alunos\/\d+\/historico$/.test(caminho)
      || caminho === '/api/instrutores'
      || caminho === '/api/veiculos'
      || caminho === '/api/locais'
      || caminho === '/api/configuracoes/funcionamento'
      || caminho === '/api/horarios-livres'
      || caminho === '/api/aulas'
      || /^\/api\/aulas\/\d+$/.test(caminho);
  }

  if (metodo === 'PATCH') {
    return /^\/api\/aulas\/\d+\/(status|confirmacao)$/.test(caminho);
  }

  if (metodo === 'POST') {
    return /^\/api\/aulas\/\d+\/reposicao$/.test(caminho)
      || /^\/api\/alunos\/\d+\/avaliacoes$/.test(caminho);
  }

  return false;
}

// Permissões são aplicadas no backend; esconder botões no frontend é apenas uma camada de UX.
// Administrador continua com acesso integral. Instrutor só alcança as rotas operacionais previstas.
app.use((req, res, next) => {
  const rotaProtegidaPorPerfil = req.path.startsWith('/api/') || req.path.startsWith('/whatsapp/');
  if (!rotaProtegidaPorPerfil) return next();
  if (usuarioEhAdmin(req)) return next();
  if (req.usuario?.perfil !== 'INSTRUTOR') {
    return res.status(403).json({ error: 'Perfil sem permissão para esta operação.' });
  }

  const instrutorId = instrutorIdDaSessao(req);
  if (!instrutorId) {
    return res.status(403).json({
      error: 'Esta conta de instrutor ainda não está vinculada a um cadastro de instrutor. Peça ao administrador para realizar o vínculo.',
      instructor_link_required: true
    });
  }

  if (!rotaPermitidaAoInstrutor(req)) {
    return res.status(403).json({ error: 'Seu perfil de instrutor não possui permissão para este módulo ou operação.' });
  }
  next();
});

// ========================= UTILITÁRIOS =========================
function dateOnlyUTC(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateTimeUTC(data, hora) {
  const [y, m, d] = String(data).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(hora).slice(0, 5).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
}

function isoDateUTC(d) {
  return d.toISOString().slice(0, 10);
}

function hhmmUTC(d) {
  return d.toISOString().slice(11, 16);
}

function normalizarDias(dias, dataInicio) {
  const validos = Array.from(new Set((Array.isArray(dias) ? dias : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))).sort((a, b) => a - b);
  if (validos.length) return validos;
  return [dateOnlyUTC(dataInicio).getUTCDay()];
}

function statusContaSaldo(status, dataAula) {
  const st = String(status || '').toUpperCase();
  // REALIZADA e FALTOU consomem o saldo do pacote.
  // FALTOU representa falta sem justificativa: permanece registrada como falta no histórico,
  // mas para o saldo equivale a uma aula consumida.
  if (['REALIZADA','FALTOU'].includes(st)) return true;
  if (['AGENDADA','CONFIRMADA'].includes(st)) return String(dataAula || '').slice(0,10) >= hojeApp();
  return false;
}

async function saldoAluno(client, alunoId, excluirAulaIds = []) {
  const ids = (Array.isArray(excluirAulaIds) ? excluirAulaIds : [excluirAulaIds]).map(Number).filter(Boolean);
  const r = await client.query(`
    SELECT a.id, a.aulas_contratadas,
           (
             COALESCE(a.aulas_realizadas_anteriores, 0)
             + COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id
                 AND au.status IN ('REALIZADA','FALTOU')
                 AND au.arquivada = FALSE
                 AND (cardinality($3::int[]) = 0 OR NOT (au.id = ANY($3::int[])))
             ), 0)
           )::int AS realizadas,
           COALESCE((
             SELECT SUM(au.aulas_unidades)
             FROM autoagenda.aulas au
             WHERE au.aluno_id = a.id
               AND au.data_aula >= $2::date
               AND au.status IN ('AGENDADA','CONFIRMADA')
               AND au.arquivada = FALSE
               AND (cardinality($3::int[]) = 0 OR NOT (au.id = ANY($3::int[])))
           ), 0)::int AS agendadas
    FROM autoagenda.alunos a
    WHERE a.id = $1 AND a.ativo = TRUE
  `, [Number(alunoId), hojeApp(), ids]);

  if (!r.rowCount) return null;
  const x = r.rows[0];
  return {
    ...x,
    disponiveis: Math.max(0, Number(x.aulas_contratadas) - Number(x.realizadas) - Number(x.agendadas))
  };
}

async function validarSaldoAula(client, { aluno_id, status, data_aula, aulas_unidades }, excluirAulaIds = []) {
  if (!statusContaSaldo(status, data_aula)) return null;
  const unidades = Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4));
  const saldo = await saldoAluno(client, aluno_id, excluirAulaIds);
  if (!saldo) throw erroHttp(404, 'Aluno não encontrado ou inativo.');
  if (unidades > Number(saldo.disponiveis)) {
    throw erroHttp(409, `O aluno possui somente ${saldo.disponiveis} aula(s) disponível(is). Ajuste a quantidade de aulas consumidas ou o pacote contratado.`);
  }
  return saldo;
}

function validarDataParaStatus(dataAula, status) {
  const data = String(dataAula || '').slice(0,10);
  const st = String(status || '').toUpperCase();
  if (['AGENDADA','CONFIRMADA'].includes(st) && data < hojeApp()) {
    throw erroHttp(400, 'Aulas agendadas ou confirmadas não podem ser criadas em data passada. Use REALIZADA para registrar uma aula já ocorrida.');
  }
  if (['REALIZADA','FALTOU'].includes(st) && data > hojeApp()) {
    throw erroHttp(400, `${st === 'REALIZADA' ? 'Uma aula realizada' : 'Uma falta'} não pode ser registrada em data futura.`);
  }
}

function validarInteiroPositivo(valor, padrao, maximo = 10000) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > maximo) return padrao;
  return n;
}

function validarInteiroNaoNegativo(valor, padrao = 0, maximo = 10000) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > maximo) return padrao;
  return n;
}

function validarValorMonetario(valor, campo = 'Valor', maximo = 99999999.99) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 0 || n > maximo) {
    throw erroHttp(400, `${campo} inválido.`);
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function validarDataOpcional(valor, campo) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const data = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw erroHttp(400, `${campo} inválida.`);
  const d = dateOnlyUTC(data);
  if (isoDateUTC(d) !== data) throw erroHttp(400, `${campo} inválida.`);
  return data;
}

function validarDataNascimento(valor) {
  const data = validarDataOpcional(valor, 'Data de nascimento');
  if (data && data > hojeApp()) {
    throw erroHttp(400, 'A data de nascimento não pode ser futura.');
  }
  return data;
}

function normalizarCpf(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 11);
}

function cpfValido(valor) {
  const cpf = normalizarCpf(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digito = tamanho => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

const NOMES_DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];

function minutosDoHorario(valor) {
  const m = String(valor || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function horarioDeMinutos(total) {
  const n = Math.max(0, Math.min(23 * 60 + 59, Number(total) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function diaSemanaDaData(data) {
  return dateOnlyUTC(data).getUTCDay();
}

async function obterConfigFuncionamento(client) {
  const r = await client.query(`
    SELECT id, dias_funcionamento,
           TO_CHAR(hora_abertura, 'HH24:MI') AS hora_abertura,
           TO_CHAR(hora_encerramento, 'HH24:MI') AS hora_encerramento,
           duracao_padrao_minutos, intervalo_minutos, atualizado_em
    FROM autoagenda.configuracoes
    WHERE id = 1
  `);
  if (r.rowCount) {
    const x = r.rows[0];
    return {
      ...x,
      dias_funcionamento: (Array.isArray(x.dias_funcionamento) ? x.dias_funcionamento : []).map(Number).sort((a,b) => a-b),
      duracao_padrao_minutos: Number(x.duracao_padrao_minutos || 50),
      intervalo_minutos: Number(x.intervalo_minutos || 0)
    };
  }
  return {
    id: 1,
    dias_funcionamento: [0,1,2,3,4,5,6],
    hora_abertura: '07:00',
    hora_encerramento: '20:00',
    duracao_padrao_minutos: 50,
    intervalo_minutos: 0
  };
}


function templateWhatsAppNomeValido(valor) {
  return /^[a-z0-9_]{2,512}$/i.test(String(valor || '').trim());
}

function publicBaseUrlConfigurada() {
  const texto = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!texto) return '';
  try {
    const u = new URL(texto);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function configuracaoWhatsAppCloud() {
  const apiVersion = String(process.env.WHATSAPP_CLOUD_API_VERSION || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const templateLembrete = String(process.env.WHATSAPP_TEMPLATE_LEMBRETE || '').trim();
  const templateComunicacao = String(process.env.WHATSAPP_TEMPLATE_COMUNICACAO || '').trim();
  const templateLanguage = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR').trim() || 'pt_BR';
  const publicBaseUrl = publicBaseUrlConfigurada();

  const ausenciasBase = [];
  if (!/^v\d+\.\d+$/.test(apiVersion)) ausenciasBase.push('WHATSAPP_CLOUD_API_VERSION');
  if (!/^\d+$/.test(phoneNumberId)) ausenciasBase.push('WHATSAPP_PHONE_NUMBER_ID');
  if (accessToken.length < 20) ausenciasBase.push('WHATSAPP_ACCESS_TOKEN');

  const ausenciasLembrete = [...ausenciasBase];
  if (!templateWhatsAppNomeValido(templateLembrete)) ausenciasLembrete.push('WHATSAPP_TEMPLATE_LEMBRETE');

  const ausenciasComunicacao = [...ausenciasBase];
  if (!templateWhatsAppNomeValido(templateComunicacao)) ausenciasComunicacao.push('WHATSAPP_TEMPLATE_COMUNICACAO');

  return {
    apiVersion, phoneNumberId, accessToken, templateLembrete, templateComunicacao,
    templateLanguage, publicBaseUrl,
    baseConfigurada: ausenciasBase.length === 0,
    lembretesConfigurados: ausenciasLembrete.length === 0,
    comunicacoesConfiguradas: ausenciasComunicacao.length === 0,
    ausenciasBase,
    ausenciasLembrete,
    ausenciasComunicacao
  };
}

function resumoConfiguracaoWhatsAppCloud() {
  const cfg = configuracaoWhatsAppCloud();
  return {
    whatsapp_api_configurada: cfg.baseConfigurada,
    whatsapp_api_ausencias: cfg.ausenciasBase,
    whatsapp_lembretes_configurados: cfg.lembretesConfigurados,
    whatsapp_lembrete_ausencias: cfg.ausenciasLembrete,
    whatsapp_comunicacoes_configuradas: cfg.comunicacoesConfiguradas,
    whatsapp_comunicacao_ausencias: cfg.ausenciasComunicacao,
    whatsapp_template_language: cfg.templateLanguage
  };
}

// ========================= V3.4 — E-MAIL TRANSACIONAL =========================
// Integração via API HTTPS oficial do Resend, sem SDK/dependência adicional.
// A chave e o remetente ficam exclusivamente nas variáveis de ambiente do Render.
function emailFormatoValido(valor) {
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(valor || '').trim());
}

function emailRemetenteValido(valor) {
  const texto = String(valor || '').trim();
  if (emailFormatoValido(texto)) return true;
  const m = texto.match(/^[^<>]{1,120}<([^<>]+)>$/);
  return Boolean(m && emailFormatoValido(m[1]));
}

function configuracaoEmail() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  const replyTo = String(process.env.EMAIL_REPLY_TO || '').trim();
  const ausencias = [];
  if (apiKey.length < 12) ausencias.push('RESEND_API_KEY');
  if (!emailRemetenteValido(from)) ausencias.push('EMAIL_FROM');
  if (replyTo && !emailFormatoValido(replyTo)) ausencias.push('EMAIL_REPLY_TO');
  return {
    provider: 'RESEND',
    apiKey, from, replyTo,
    configurada: ausencias.length === 0,
    ausencias
  };
}

function resumoConfiguracaoEmail() {
  const cfg = configuracaoEmail();
  return {
    email_api_configurada: cfg.configurada,
    email_api_ausencias: cfg.ausencias,
    email_provider: cfg.provider
  };
}

async function obterConfigEmail(client) {
  const r = await client.query(`
    SELECT email_automatico_ativo
    FROM autoagenda.configuracoes
    WHERE id=1
  `);
  const resumoQ = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='PENDENTE')::int AS pendentes,
      COUNT(*) FILTER (WHERE status='ENVIADO')::int AS enviados,
      COUNT(*) FILTER (WHERE status='FALHOU')::int AS falhas
    FROM autoagenda.email_envios
    WHERE criado_em >= NOW() - INTERVAL '30 days'
  `);
  const x = r.rows[0] || {};
  return {
    email_automatico_ativo: x.email_automatico_ativo === true,
    ...resumoConfiguracaoEmail(),
    email_envios_resumo: resumoQ.rows[0] || { pendentes:0, enviados:0, falhas:0 }
  };
}

function escaparHtmlEmail(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function obterConfigLembretes(client) {
  const r = await client.query(`
    SELECT lembrete_dia_anterior_ativo,
           TO_CHAR(lembrete_dia_anterior_hora, 'HH24:MI') AS lembrete_dia_anterior_hora,
           lembrete_horas_antes_ativo, lembrete_horas_antes,
           whatsapp_automatico_ativo
    FROM autoagenda.configuracoes
    WHERE id = 1
  `);
  const resumoQ = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='PENDENTE')::int AS pendentes,
      COUNT(*) FILTER (WHERE status='ENVIADO')::int AS enviados,
      COUNT(*) FILTER (WHERE status='FALHOU')::int AS falhas
    FROM autoagenda.whatsapp_envios
    WHERE criado_em >= NOW() - INTERVAL '30 days'
  `);
  const x = r.rows[0] || {};
  return {
    lembrete_dia_anterior_ativo: x.lembrete_dia_anterior_ativo !== false,
    lembrete_dia_anterior_hora: String(x.lembrete_dia_anterior_hora || '18:00').slice(0,5),
    lembrete_horas_antes_ativo: x.lembrete_horas_antes_ativo !== false,
    lembrete_horas_antes: Math.max(1, Math.min(24, Number(x.lembrete_horas_antes || 2))),
    whatsapp_automatico_ativo: x.whatsapp_automatico_ativo === true,
    whatsapp_envios_resumo: resumoQ.rows[0] || { pendentes:0, enviados:0, falhas:0 },
    ...resumoConfiguracaoWhatsAppCloud()
  };
}

function normalizarConfiguracaoLembretes(payload = {}) {
  const horaDia = String(payload.lembrete_dia_anterior_hora || '18:00').slice(0,5);
  if (!/^\d{2}:\d{2}$/.test(horaDia) || !Number.isFinite(minutosDoHorario(horaDia))) {
    throw erroHttp(400, 'Informe um horário válido para o lembrete do dia anterior.');
  }
  const horas = Number(payload.lembrete_horas_antes ?? 2);
  if (!Number.isInteger(horas) || horas < 1 || horas > 24) {
    throw erroHttp(400, 'O lembrete antecipado deve ficar entre 1 e 24 horas antes.');
  }
  return {
    lembrete_dia_anterior_ativo: payload.lembrete_dia_anterior_ativo !== false,
    lembrete_dia_anterior_hora: horaDia,
    lembrete_horas_antes_ativo: payload.lembrete_horas_antes_ativo !== false,
    lembrete_horas_antes: horas,
    whatsapp_automatico_ativo: payload.whatsapp_automatico_ativo === true
  };
}

async function sincronizarAgendamentoLembretes(client) {
  await client.query(`
    UPDATE autoagenda.aulas a
    SET lembrete_dia_anterior_em = CASE
          WHEN c.lembrete_dia_anterior_ativo
           AND a.arquivada = FALSE
           AND a.status IN ('AGENDADA','CONFIRMADA')
          THEN (a.data_aula - 1) + c.lembrete_dia_anterior_hora
          ELSE NULL
        END,
        lembrete_horas_antes_em = CASE
          WHEN c.lembrete_horas_antes_ativo
           AND a.arquivada = FALSE
           AND a.status IN ('AGENDADA','CONFIRMADA')
          THEN (a.data_aula + a.hora_inicio) - (c.lembrete_horas_antes * INTERVAL '1 hour')
          ELSE NULL
        END
    FROM autoagenda.configuracoes c
    WHERE c.id = 1
      AND a.data_aula >= $1::date
  `, [hojeApp()]);
}

async function sincronizarFilaLembretes(client) {
  const tipos = [
    { tipo: 'DIA_ANTERIOR', em: 'lembrete_dia_anterior_em', enviado: 'lembrete_dia_anterior_enviado', enviadoEm: 'lembrete_dia_anterior_enviado_em' },
    { tipo: 'HORAS_ANTES', em: 'lembrete_horas_antes_em', enviado: 'lembrete_horas_antes_enviado', enviadoEm: 'lembrete_horas_antes_enviado_em' }
  ];

  for (const t of tipos) {
    await client.query(`
      INSERT INTO autoagenda.lembrete_envios
        (aula_id, tipo, canal, agendado_em, status, automatico, enviado_em)
      SELECT a.id, $1, 'WHATSAPP', a.${t.em},
             CASE WHEN a.${t.enviado} THEN 'ENVIADO' ELSE 'PENDENTE' END,
             TRUE, a.${t.enviadoEm}
      FROM autoagenda.aulas a
      WHERE a.${t.em} IS NOT NULL
        AND a.data_aula >= $2::date
      ON CONFLICT (aula_id, tipo, canal) DO UPDATE
      SET agendado_em = EXCLUDED.agendado_em,
          status = CASE
            WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN EXCLUDED.status
            WHEN EXCLUDED.status = 'ENVIADO' THEN 'ENVIADO'
            WHEN lembrete_envios.status = 'CANCELADO' THEN 'PENDENTE'
            ELSE lembrete_envios.status
          END,
          automatico = CASE
            WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN TRUE
            WHEN EXCLUDED.status='ENVIADO' AND lembrete_envios.status='ENVIADO' THEN lembrete_envios.automatico
            ELSE TRUE
          END,
          tentativas = CASE WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN 0 ELSE lembrete_envios.tentativas END,
          ultima_tentativa_em = CASE WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN NULL ELSE lembrete_envios.ultima_tentativa_em END,
          processando_em = CASE WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN NULL ELSE lembrete_envios.processando_em END,
          enviado_em = CASE
            WHEN EXCLUDED.status = 'ENVIADO' THEN COALESCE(EXCLUDED.enviado_em, lembrete_envios.enviado_em)
            WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN NULL
            ELSE lembrete_envios.enviado_em
          END,
          provider_message_id = CASE WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN NULL ELSE lembrete_envios.provider_message_id END,
          erro = CASE WHEN lembrete_envios.agendado_em IS DISTINCT FROM EXCLUDED.agendado_em THEN NULL ELSE lembrete_envios.erro END,
          atualizado_em = NOW()
    `, [t.tipo, hojeApp()]);
  }

  // Se a aula foi cancelada/arquivada ou a programação mudou, preserva o histórico
  // sem deixar o item antigo elegível para envio.
  await client.query(`
    UPDATE autoagenda.lembrete_envios le
    SET status='CANCELADO', processando_em=NULL, atualizado_em=NOW()
    WHERE le.status IN ('PENDENTE','FALHOU','PROCESSANDO')
      AND NOT EXISTS (
        SELECT 1
        FROM autoagenda.aulas a
        WHERE a.id=le.aula_id
          AND a.arquivada=FALSE
          AND a.status IN ('AGENDADA','CONFIRMADA')
          AND CASE le.tipo
                WHEN 'DIA_ANTERIOR' THEN a.lembrete_dia_anterior_em
                WHEN 'HORAS_ANTES' THEN a.lembrete_horas_antes_em
              END IS NOT DISTINCT FROM le.agendado_em
      )
  `);

  // Se o processo caiu durante uma chamada externa, não reenvia automaticamente:
  // marca como falha para evitar uma duplicidade silenciosa em caso de resposta ambígua.
  await client.query(`
    UPDATE autoagenda.lembrete_envios
    SET status='FALHOU',
        erro=COALESCE(erro,'Envio interrompido antes de confirmar a resposta da API.'),
        processando_em=NULL,
        atualizado_em=NOW()
    WHERE status='PROCESSANDO'
      AND processando_em IS NOT NULL
      AND processando_em < NOW() - INTERVAL '15 minutes'
  `);
}

function erroWhatsAppSeguro(valor) {
  return String(valor || 'Falha ao enviar pela API do WhatsApp.').replace(/\s+/g, ' ').slice(0, 700);
}

function parametrosTemplateLembrete(aula) {
  return [
    aula.aluno_nome || 'Aluno',
    aula.data_br || '',
    String(aula.hora_inicio || '').slice(0,5),
    aula.instrutor_nome || 'A definir',
    aula.veiculo_nome || 'A definir',
    aula.local_nome || 'A definir'
  ].map(text => ({ type: 'text', text: String(text).slice(0, 1024) }));
}

async function enviarTemplateWhatsAppCloud(aula) {
  const cfg = configuracaoWhatsAppCloud();
  if (!cfg.configurada) {
    const e = new Error(`Integração do WhatsApp não configurada: ${cfg.ausencias.join(', ')}.`);
    e.code = 'WHATSAPP_NOT_CONFIGURED';
    throw e;
  }
  const telefone = normalizarWhatsAppParaLink(aula.aluno_whatsapp);
  if (!telefone) {
    const e = new Error('Aluno sem número de WhatsApp válido com DDD.');
    e.code = 'WHATSAPP_INVALID_PHONE';
    throw e;
  }

  const url = `https://graph.facebook.com/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefone,
        type: 'template',
        template: {
          name: cfg.templateLembrete,
          language: { code: cfg.templateLanguage },
          components: [{ type: 'body', parameters: parametrosTemplateLembrete(aula) }]
        }
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  let dados = {};
  try { dados = await resposta.json(); } catch {}
  if (!resposta.ok) {
    const mensagem = dados?.error?.message || dados?.error?.error_user_msg || `HTTP ${resposta.status}`;
    const e = new Error(`WhatsApp Cloud API: ${mensagem}`);
    e.code = dados?.error?.code || `HTTP_${resposta.status}`;
    throw e;
  }
  return { messageId: String(dados?.messages?.[0]?.id || '') || null };
}

async function processarLembretesAutomaticos({ origem = 'WORKER', limite = 10 } = {}) {
  const client = await pool.connect();
  let lockObtido = false;
  const resultado = { origem, processados: 0, enviados: 0, falhas: 0, cancelados: 0, ignorado: false };
  try {
    // Lock global no PostgreSQL evita dois processos/instâncias enviando o mesmo lote.
    const lock = await client.query('SELECT pg_try_advisory_lock(33003300) AS ok');
    lockObtido = lock.rows[0]?.ok === true;
    if (!lockObtido) return { ...resultado, ignorado: true, motivo: 'OUTRO_WORKER_ATIVO' };

    const cfg = await obterConfigLembretes(client);
    if (!cfg.whatsapp_automatico_ativo) return { ...resultado, ignorado: true, motivo: 'AUTOMACAO_DESATIVADA' };
    if (!cfg.whatsapp_lembretes_configurados) {
      return { ...resultado, ignorado: true, motivo: 'LEMBRETE_NAO_CONFIGURADO', ausencias: cfg.whatsapp_lembrete_ausencias };
    }

    await sincronizarAgendamentoLembretes(client);
    await sincronizarFilaLembretes(client);
    const agora = agoraApp();
    const agoraTexto = `${agora.data} ${agora.hora}:00`;

    // Se o serviço ficou indisponível e dois lembretes da mesma aula venceram,
    // envia somente o mais próximo da aula. O mais antigo é cancelado para evitar
    // duas mensagens automáticas seguidas quando o Render voltar a executar.
    await client.query(`
      UPDATE autoagenda.lembrete_envios le
      SET status='CANCELADO',
          erro='Lembrete vencido substituído por um lembrete mais recente da mesma aula.',
          atualizado_em=NOW()
      FROM autoagenda.aulas a
      WHERE a.id=le.aula_id
        AND le.status='PENDENTE'
        AND le.agendado_em <= $1::timestamp
        AND (a.data_aula + a.hora_inicio) > $1::timestamp
        AND EXISTS (
          SELECT 1
          FROM autoagenda.lembrete_envios mais_novo
          WHERE mais_novo.aula_id=le.aula_id
            AND mais_novo.canal=le.canal
            AND mais_novo.status='PENDENTE'
            AND mais_novo.agendado_em <= $1::timestamp
            AND mais_novo.agendado_em > le.agendado_em
        )
    `, [agoraTexto]);

    const fila = await client.query(`
      SELECT le.id
      FROM autoagenda.lembrete_envios le
      JOIN autoagenda.aulas a ON a.id=le.aula_id
      WHERE le.status='PENDENTE'
        AND le.automatico=TRUE
        AND le.agendado_em <= $1::timestamp
        AND (a.data_aula + a.hora_inicio) > $1::timestamp
        AND a.arquivada=FALSE
        AND a.status IN ('AGENDADA','CONFIRMADA')
      ORDER BY le.agendado_em, le.id
      LIMIT $2
    `, [agoraTexto, Math.max(1, Math.min(50, Number(limite) || 10))]);

    for (const item of fila.rows) {
      const envioId = Number(item.id);
      const claim = await client.query(`
        UPDATE autoagenda.lembrete_envios
        SET status='PROCESSANDO', tentativas=tentativas+1,
            ultima_tentativa_em=NOW(), processando_em=NOW(), erro=NULL, atualizado_em=NOW()
        WHERE id=$1 AND status='PENDENTE'
        RETURNING id, aula_id, tipo, agendado_em
      `, [envioId]);
      if (!claim.rowCount) continue;
      resultado.processados++;

      const detalhe = await client.query(`
        SELECT le.id AS envio_id, le.tipo,
               TO_CHAR(a.data_aula,'DD/MM/YYYY') AS data_br,
               TO_CHAR(a.hora_inicio,'HH24:MI') AS hora_inicio,
               a.status, a.arquivada,
               al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp,
               i.nome AS instrutor_nome,
               v.nome AS veiculo_nome,
               l.nome AS local_nome
        FROM autoagenda.lembrete_envios le
        JOIN autoagenda.aulas a ON a.id=le.aula_id
        JOIN autoagenda.alunos al ON al.id=a.aluno_id
        LEFT JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
        LEFT JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
        LEFT JOIN autoagenda.locais l ON l.id=a.local_id
        WHERE le.id=$1
      `, [envioId]);
      const aula = detalhe.rows[0];
      if (!aula || aula.arquivada || !['AGENDADA','CONFIRMADA'].includes(String(aula.status || '').toUpperCase())) {
        await client.query(`UPDATE autoagenda.lembrete_envios SET status='CANCELADO', processando_em=NULL, atualizado_em=NOW() WHERE id=$1`, [envioId]);
        resultado.cancelados++;
        continue;
      }

      try {
        const envio = await enviarTemplateWhatsAppCloud(aula);
        await client.query('BEGIN');
        await client.query(`
          UPDATE autoagenda.lembrete_envios
          SET status='ENVIADO', processando_em=NULL, enviado_em=NOW(),
              provider_message_id=$1, erro=NULL, atualizado_em=NOW()
          WHERE id=$2 AND status='PROCESSANDO'
        `, [envio.messageId, envioId]);
        const coluna = aula.tipo === 'DIA_ANTERIOR' ? 'lembrete_dia_anterior' : 'lembrete_horas_antes';
        await client.query(`
          UPDATE autoagenda.aulas a
          SET ${coluna}_enviado=TRUE, ${coluna}_enviado_em=NOW(), atualizado_em=NOW()
          FROM autoagenda.lembrete_envios le
          WHERE le.id=$1 AND a.id=le.aula_id
        `, [envioId]);
        await client.query('COMMIT');
        resultado.enviados++;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        await client.query(`
          UPDATE autoagenda.lembrete_envios
          SET status='FALHOU', processando_em=NULL, erro=$1, atualizado_em=NOW()
          WHERE id=$2
        `, [erroWhatsAppSeguro(error?.message), envioId]);
        resultado.falhas++;
      }
    }
    return resultado;
  } finally {
    if (lockObtido) {
      try { await client.query('SELECT pg_advisory_unlock(33003300)'); } catch {}
    }
    client.release();
  }
}



// ========================= V3.7 — WHATSAPP TRANSACIONAL AUTOMÁTICO =========================
const WHATSAPP_EVENTOS_AULA = new Set(['AGENDAMENTO','REAGENDAMENTO','CANCELAMENTO']);
const WHATSAPP_EVENTOS_PLANO = new Set(['PLANO_AGENDADO','PLANO_ATUALIZADO','PLANO_CANCELADO']);

function chaveWhatsAppSeguro(valor) {
  return String(valor || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9_./:-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 256);
}

async function detalhesAulaWhatsApp(client, aulaId) {
  const r = await client.query(`
    SELECT a.id, a.plan_id, a.status, a.arquivada, a.atualizado_em,
           TO_CHAR(a.data_aula,'YYYY-MM-DD') AS data_aula,
           TO_CHAR(a.data_aula,'DD/MM/YYYY') AS data_br,
           TO_CHAR(a.hora_inicio,'HH24:MI') AS hora_inicio,
           al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome, l.endereco AS local_endereco
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id=a.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id=a.local_id
    WHERE a.id=$1
  `, [Number(aulaId)]);
  return r.rows[0] || null;
}

async function detalhesPlanoWhatsApp(client, planId) {
  const p = await client.query(`
    SELECT p.id, p.ativo, p.atualizado_em,
           al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome
    FROM autoagenda.planos_aula p
    JOIN autoagenda.alunos al ON al.id=p.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id=p.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id=p.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id=p.local_id
    WHERE p.id=$1
  `, [Number(planId)]);
  if (!p.rowCount) return null;
  const aulas = await client.query(`
    SELECT TO_CHAR(data_aula,'DD/MM/YYYY') AS data_br,
           TO_CHAR(hora_inicio,'HH24:MI') AS hora_inicio, status
    FROM autoagenda.aulas
    WHERE plan_id=$1 AND arquivada=FALSE AND data_aula >= $2::date
    ORDER BY data_aula,hora_inicio,id
    LIMIT 12
  `, [Number(planId), hojeApp()]);
  return { ...p.rows[0], aulas: aulas.rows };
}

function rotuloEventoWhatsApp(evento) {
  return ({
    AGENDAMENTO: 'Sua aula prática foi agendada',
    REAGENDAMENTO: 'Sua aula prática foi reagendada',
    CANCELAMENTO: 'Sua aula prática foi cancelada',
    PLANO_AGENDADO: 'Seu plano de aulas foi criado',
    PLANO_ATUALIZADO: 'Seu plano de aulas foi atualizado',
    PLANO_CANCELADO: 'Seu plano de aulas foi encerrado'
  })[String(evento || '').toUpperCase()] || 'Atualização da sua agenda';
}

function parametroTemplateWhatsApp(texto) {
  return { type:'text', text:String(texto || '—').slice(0,1024) };
}

function parametrosComunicacaoAula(evento, aula) {
  const veiculo = aula.veiculo_nome
    ? `${aula.veiculo_nome}${aula.veiculo_placa ? ` (${aula.veiculo_placa})` : ''}`
    : 'A definir';
  const detalhes = [
    `📅 Data: ${aula.data_br || dataBrEmail(aula.data_aula)}`,
    `🕐 Horário: ${String(aula.hora_inicio || '').slice(0,5)}`,
    `👨‍🏫 Instrutor: ${aula.instrutor_nome || 'A definir'}`,
    `🚗 Veículo: ${veiculo}`,
    `📍 Local: ${aula.local_nome || 'A definir'}`
  ].join('\n');
  let acao = 'Em caso de dúvida, entre em contato com a autoescola.';
  if (['AGENDAMENTO','REAGENDAMENTO'].includes(evento)) {
    acao = 'Para confirmar ou solicitar alteração, use o link enviado pelo WhatsApp manual ou entre em contato com a autoescola.';
  } else if (evento === 'CANCELAMENTO') {
    acao = 'Se precisar de um novo horário, entre em contato com o instrutor ou com a autoescola.';
  }
  return [
    parametroTemplateWhatsApp(String(aula.aluno_nome || 'Aluno').trim().split(/\s+/)[0] || 'Aluno'),
    parametroTemplateWhatsApp(rotuloEventoWhatsApp(evento)),
    parametroTemplateWhatsApp(detalhes),
    parametroTemplateWhatsApp(acao)
  ];
}

function parametrosComunicacaoPlano(evento, plano) {
  const cronograma = (plano.aulas || []).map(a => `${a.data_br} às ${String(a.hora_inicio || '').slice(0,5)} — ${a.status}`).join('\n') || 'Nenhuma aula futura ativa.';
  const detalhes = [
    `👨‍🏫 Instrutor: ${plano.instrutor_nome || 'A definir'}`,
    `🚗 Veículo: ${plano.veiculo_nome || 'A definir'}`,
    `📍 Local: ${plano.local_nome || 'A definir'}`,
    '',
    'Próximas aulas:',
    cronograma
  ].join('\n').slice(0,1024);
  return [
    parametroTemplateWhatsApp(String(plano.aluno_nome || 'Aluno').trim().split(/\s+/)[0] || 'Aluno'),
    parametroTemplateWhatsApp(rotuloEventoWhatsApp(evento)),
    parametroTemplateWhatsApp(detalhes),
    parametroTemplateWhatsApp('Em caso de dúvida ou necessidade de alteração, entre em contato com a autoescola.')
  ];
}

async function enviarTemplateComunicacaoWhatsAppCloud(destinatario, parametros) {
  const cfg = configuracaoWhatsAppCloud();
  if (!cfg.comunicacoesConfiguradas) {
    const e = new Error(`Comunicação automática do WhatsApp não configurada: ${cfg.ausenciasComunicacao.join(', ')}.`);
    e.code = 'WHATSAPP_COMM_NOT_CONFIGURED';
    throw e;
  }
  const telefone = normalizarWhatsAppParaLink(destinatario);
  if (!telefone) {
    const e = new Error('Aluno sem número de WhatsApp válido com DDD.');
    e.code = 'WHATSAPP_INVALID_PHONE';
    throw e;
  }
  const url = `https://graph.facebook.com/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let resposta;
  try {
    resposta = await fetch(url, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${cfg.accessToken}`, 'Content-Type':'application/json' },
      body:JSON.stringify({
        messaging_product:'whatsapp', recipient_type:'individual', to:telefone, type:'template',
        template:{
          name:cfg.templateComunicacao,
          language:{ code:cfg.templateLanguage },
          components:[{ type:'body', parameters:parametros }]
        }
      }),
      signal:controller.signal
    });
  } finally { clearTimeout(timer); }
  let dados={};
  try { dados=await resposta.json(); } catch {}
  if (!resposta.ok) {
    const mensagem = dados?.error?.message || dados?.error?.error_user_msg || `HTTP ${resposta.status}`;
    const e = new Error(`WhatsApp Cloud API: ${mensagem}`);
    e.code = dados?.error?.code || `HTTP_${resposta.status}`;
    throw e;
  }
  return { messageId:String(dados?.messages?.[0]?.id || '') || null };
}

async function inserirWhatsAppFila(client, { aulaId=null, planId=null, evento, destinatario, chave }) {
  const telefone = normalizarWhatsAppParaLink(destinatario);
  if (!telefone) return { ignorado:true, motivo:'SEM_WHATSAPP_VALIDO' };
  if (!WHATSAPP_EVENTOS_AULA.has(evento) && !WHATSAPP_EVENTOS_PLANO.has(evento)) {
    return { ignorado:true, motivo:'EVENTO_INVALIDO' };
  }
  // Se a API ficou indisponível e houve mais de uma mudança no mesmo item,
  // preserva no histórico apenas a comunicação mais nova como elegível.
  if (aulaId) {
    await client.query(`
      UPDATE autoagenda.whatsapp_envios
      SET status='CANCELADO', processando_em=NULL,
          erro=COALESCE(erro,'Substituído por uma comunicação mais recente da mesma aula.'), atualizado_em=NOW()
      WHERE aula_id=$1 AND status='PENDENTE'
    `, [Number(aulaId)]);
  }
  if (planId) {
    await client.query(`
      UPDATE autoagenda.whatsapp_envios
      SET status='CANCELADO', processando_em=NULL,
          erro=COALESCE(erro,'Substituído por uma comunicação mais recente do mesmo plano.'), atualizado_em=NOW()
      WHERE plan_id=$1 AND status='PENDENTE'
    `, [Number(planId)]);
  }
  const r = await client.query(`
    INSERT INTO autoagenda.whatsapp_envios
      (aula_id,plan_id,evento,destinatario,chave_idempotencia,agendado_em,status,automatico)
    VALUES ($1,$2,$3,$4,$5,NOW(),'PENDENTE',TRUE)
    ON CONFLICT (chave_idempotencia) DO NOTHING
    RETURNING id
  `, [aulaId ? Number(aulaId) : null, planId ? Number(planId) : null, evento, telefone, chaveWhatsAppSeguro(chave)]);
  return r.rowCount ? { id:Number(r.rows[0].id), criado:true } : { criado:false, duplicado:true };
}

async function enfileirarWhatsAppEventoAula(aulaId, evento, versao='') {
  const client = await pool.connect();
  try {
    const cfg = await obterConfigLembretes(client);
    if (!cfg.whatsapp_automatico_ativo) return { ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    const aula = await detalhesAulaWhatsApp(client, aulaId);
    if (!aula) return { ignorado:true, motivo:'AULA_INEXISTENTE' };
    const chave = `autoagenda/whatsapp/${evento.toLowerCase()}/aula/${aula.id}/${versao || String(aula.atualizado_em || '')}`;
    return await inserirWhatsAppFila(client, { aulaId:aula.id, evento, destinatario:aula.aluno_whatsapp, chave });
  } finally { client.release(); }
}

async function enfileirarWhatsAppEventoPlano(planId, evento, versao='') {
  const client = await pool.connect();
  try {
    const cfg = await obterConfigLembretes(client);
    if (!cfg.whatsapp_automatico_ativo) return { ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    const plano = await detalhesPlanoWhatsApp(client, planId);
    if (!plano) return { ignorado:true, motivo:'PLANO_INEXISTENTE' };
    const chave = `autoagenda/whatsapp/${evento.toLowerCase()}/plano/${plano.id}/${versao || String(plano.atualizado_em || '')}`;
    return await inserirWhatsAppFila(client, { planId:plano.id, evento, destinatario:plano.aluno_whatsapp, chave });
  } finally { client.release(); }
}

function dispararWhatsAppAulaSeguro(aulaId, evento, versao='') {
  setImmediate(async () => {
    try {
      const r = await enfileirarWhatsAppEventoAula(aulaId, evento, versao);
      if (r?.criado) await processarWhatsAppComunicacoesAutomaticas({ origem:`EVENTO_${evento}`, limite:10 });
    } catch (error) {
      console.error(`WhatsApp ${evento} não enviado; a operação principal foi preservada:`, erroWhatsAppSeguro(error?.message));
    }
  });
}

function dispararWhatsAppPlanoSeguro(planId, evento, versao='') {
  setImmediate(async () => {
    try {
      const r = await enfileirarWhatsAppEventoPlano(planId, evento, versao);
      if (r?.criado) await processarWhatsAppComunicacoesAutomaticas({ origem:`EVENTO_${evento}`, limite:10 });
    } catch (error) {
      console.error(`WhatsApp ${evento} do plano não enviado; a operação principal foi preservada:`, erroWhatsAppSeguro(error?.message));
    }
  });
}

async function processarWhatsAppComunicacoesAutomaticas({ origem='WORKER', limite=20 } = {}) {
  const client = await pool.connect();
  let lockObtido=false;
  const resultado={ origem, processados:0, enviados:0, falhas:0, cancelados:0, ignorado:false };
  try {
    const lock=await client.query('SELECT pg_try_advisory_lock(37003700) AS ok');
    lockObtido=lock.rows[0]?.ok===true;
    if (!lockObtido) return { ...resultado, ignorado:true, motivo:'OUTRO_WORKER_WHATSAPP_ATIVO' };
    const cfg=await obterConfigLembretes(client);
    if (!cfg.whatsapp_automatico_ativo) return { ...resultado, ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    if (!cfg.whatsapp_comunicacoes_configuradas) return { ...resultado, ignorado:true, motivo:'COMUNICACAO_NAO_CONFIGURADA', ausencias:cfg.whatsapp_comunicacao_ausencias };

    await client.query(`
      UPDATE autoagenda.whatsapp_envios
      SET status='FALHOU', erro=COALESCE(erro,'Envio interrompido antes de confirmar a resposta da API.'),
          processando_em=NULL, atualizado_em=NOW()
      WHERE status='PROCESSANDO' AND processando_em < NOW() - INTERVAL '15 minutes'
    `);

    const fila=await client.query(`
      SELECT id FROM autoagenda.whatsapp_envios
      WHERE status='PENDENTE' AND automatico=TRUE AND agendado_em<=NOW()
      ORDER BY agendado_em,id LIMIT $1
    `,[Math.max(1,Math.min(50,Number(limite)||20))]);

    for (const item of fila.rows) {
      const envioId=Number(item.id);
      const claim=await client.query(`
        UPDATE autoagenda.whatsapp_envios
        SET status='PROCESSANDO', tentativas=tentativas+1, ultima_tentativa_em=NOW(),
            processando_em=NOW(), erro=NULL, atualizado_em=NOW()
        WHERE id=$1 AND status='PENDENTE'
        RETURNING *
      `,[envioId]);
      if (!claim.rowCount) continue;
      resultado.processados++;
      const envio=claim.rows[0];
      try {
        let parametros=[];
        if (envio.aula_id) {
          const aula=await detalhesAulaWhatsApp(client, envio.aula_id);
          if (!aula) throw Object.assign(new Error('Aula não encontrada para a comunicação.'),{cancelar:true});
          const ativo=!aula.arquivada && ['AGENDADA','CONFIRMADA'].includes(String(aula.status||'').toUpperCase());
          if (['AGENDAMENTO','REAGENDAMENTO'].includes(envio.evento) && !ativo) {
            throw Object.assign(new Error('Comunicação ficou obsoleta porque a aula não está mais ativa.'),{cancelar:true});
          }
          if (envio.evento==='CANCELAMENTO' && ativo) {
            throw Object.assign(new Error('Cancelamento ficou obsoleto porque a aula está ativa.'),{cancelar:true});
          }
          parametros=parametrosComunicacaoAula(envio.evento,aula);
        } else if (envio.plan_id) {
          const plano=await detalhesPlanoWhatsApp(client, envio.plan_id);
          if (!plano) throw Object.assign(new Error('Plano não encontrado para a comunicação.'),{cancelar:true});
          if (envio.evento==='PLANO_CANCELADO' && plano.ativo) {
            throw Object.assign(new Error('Encerramento ficou obsoleto porque o plano está ativo.'),{cancelar:true});
          }
          if (['PLANO_AGENDADO','PLANO_ATUALIZADO'].includes(envio.evento) && !plano.ativo) {
            throw Object.assign(new Error('Comunicação ficou obsoleta porque o plano foi encerrado.'),{cancelar:true});
          }
          parametros=parametrosComunicacaoPlano(envio.evento,plano);
        } else {
          throw Object.assign(new Error('Comunicação sem referência operacional.'),{cancelar:true});
        }
        const api=await enviarTemplateComunicacaoWhatsAppCloud(envio.destinatario,parametros);
        await client.query(`
          UPDATE autoagenda.whatsapp_envios
          SET status='ENVIADO', processando_em=NULL, enviado_em=NOW(), provider_message_id=$1,
              erro=NULL, atualizado_em=NOW()
          WHERE id=$2 AND status='PROCESSANDO'
        `,[api.messageId,envioId]);
        resultado.enviados++;
      } catch (error) {
        if (error?.cancelar) {
          await client.query(`UPDATE autoagenda.whatsapp_envios SET status='CANCELADO',processando_em=NULL,erro=$1,atualizado_em=NOW() WHERE id=$2`,[erroWhatsAppSeguro(error.message),envioId]);
          resultado.cancelados++;
        } else {
          await client.query(`UPDATE autoagenda.whatsapp_envios SET status='FALHOU',processando_em=NULL,erro=$1,atualizado_em=NOW() WHERE id=$2`,[erroWhatsAppSeguro(error?.message),envioId]);
          resultado.falhas++;
        }
      }
    }
    return resultado;
  } finally {
    if (lockObtido) { try { await client.query('SELECT pg_advisory_unlock(37003700)'); } catch {} }
    client.release();
  }
}

function chaveEmailSeguro(valor) {
  return String(valor || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9_./:-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 256);
}

function erroEmailSeguro(valor) {
  return String(valor || 'Falha ao enviar e-mail.').replace(/\s+/g, ' ').slice(0, 700);
}

function dataBrEmail(iso) {
  const s = String(iso || '').slice(0,10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

async function detalhesAulaEmail(client, aulaId) {
  const r = await client.query(`
    SELECT a.id, a.plan_id, a.status, a.arquivada,
           TO_CHAR(a.data_aula,'YYYY-MM-DD') AS data_aula,
           TO_CHAR(a.hora_inicio,'HH24:MI') AS hora_inicio,
           a.atualizado_em,
           al.nome AS aluno_nome, al.email AS aluno_email,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome, l.endereco AS local_endereco
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id=a.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id=a.local_id
    WHERE a.id=$1
  `, [Number(aulaId)]);
  return r.rows[0] || null;
}

function corpoEmailAula(evento, aula) {
  const primeiroNome = String(aula.aluno_nome || 'Aluno').trim().split(/\s+/)[0] || 'Aluno';
  const data = dataBrEmail(aula.data_aula);
  const hora = String(aula.hora_inicio || '').slice(0,5);
  const veiculo = aula.veiculo_nome
    ? `${aula.veiculo_nome}${aula.veiculo_placa ? ` (${aula.veiculo_placa})` : ''}`
    : 'A definir';
  const local = aula.local_nome || 'A definir';
  const endereco = aula.local_endereco ? ` — ${aula.local_endereco}` : '';
  const mapa = {
    AGENDAMENTO: {
      assunto: `AutoAgenda — aula marcada para ${data} às ${hora}`,
      titulo: 'Sua aula prática foi agendada',
      intro: 'Seu horário foi registrado no AutoAgenda.'
    },
    REAGENDAMENTO: {
      assunto: `AutoAgenda — aula reagendada para ${data} às ${hora}`,
      titulo: 'Sua aula prática foi reagendada',
      intro: 'Confira abaixo os novos dados da sua aula.'
    },
    CANCELAMENTO: {
      assunto: `AutoAgenda — aula cancelada (${data} às ${hora})`,
      titulo: 'Sua aula prática foi cancelada',
      intro: 'O horário abaixo foi cancelado no AutoAgenda.'
    },
    LEMBRETE_DIA_ANTERIOR: {
      assunto: `Lembrete AutoAgenda — aula amanhã às ${hora}`,
      titulo: 'Lembrete da sua aula prática',
      intro: 'Este é um lembrete da sua aula marcada para amanhã.'
    },
    LEMBRETE_HORAS_ANTES: {
      assunto: `Lembrete AutoAgenda — sua aula é hoje às ${hora}`,
      titulo: 'Sua aula está próxima',
      intro: 'Este é um lembrete da sua aula prática de hoje.'
    }
  };
  const cfg = mapa[evento] || mapa.AGENDAMENTO;
  const aviso = evento === 'CANCELAMENTO'
    ? '<p style="margin:18px 0 0;color:#7a4d12">Se precisar de um novo horário, entre em contato com o instrutor ou com a autoescola.</p>'
    : '<p style="margin:18px 0 0;color:#65758b">Em caso de dúvida ou necessidade de alteração, entre em contato com o instrutor ou com a autoescola.</p>';

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e3e7ef;border-radius:18px;overflow:hidden">
    <div style="padding:24px 28px;background:#f7c928"><div style="font-size:13px;font-weight:700">AUTOAGENDA</div><div style="font-size:24px;font-weight:800;margin-top:4px">${escaparHtmlEmail(cfg.titulo)}</div></div>
    <div style="padding:26px 28px">
      <p style="font-size:16px;line-height:1.55">Olá, <b>${escaparHtmlEmail(primeiroNome)}</b>. ${escaparHtmlEmail(cfg.intro)}</p>
      <div style="border:1px solid #e5e9f0;border-radius:14px;padding:14px 18px;line-height:1.8;background:#fbfcfe">
        <div>📅 <b>Data:</b> ${escaparHtmlEmail(data)}</div>
        <div>🕐 <b>Horário:</b> ${escaparHtmlEmail(hora)}</div>
        <div>👨‍🏫 <b>Instrutor:</b> ${escaparHtmlEmail(aula.instrutor_nome || 'A definir')}</div>
        <div>🚗 <b>Veículo:</b> ${escaparHtmlEmail(veiculo)}</div>
        <div>📍 <b>Local:</b> ${escaparHtmlEmail(local + endereco)}</div>
      </div>
      ${aviso}
      <p style="font-size:12px;color:#8a95a6;margin-top:24px">Mensagem automática do AutoAgenda.</p>
    </div>
  </div></body></html>`;

  const texto = `Olá, ${primeiroNome}. ${cfg.intro}\n\n` +
    `Data: ${data}\nHorário: ${hora}\nInstrutor: ${aula.instrutor_nome || 'A definir'}\n` +
    `Veículo: ${veiculo}\nLocal: ${local}${endereco}\n\n` +
    (evento === 'CANCELAMENTO'
      ? 'Se precisar de um novo horário, entre em contato com o instrutor ou com a autoescola.'
      : 'Em caso de dúvida ou necessidade de alteração, entre em contato com o instrutor ou com a autoescola.');
  return { assunto: cfg.assunto, html, texto };
}

async function detalhesPlanoEmail(client, planId) {
  const p = await client.query(`
    SELECT p.id, p.atualizado_em, p.ativo,
           al.nome AS aluno_nome, al.email AS aluno_email,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome, l.endereco AS local_endereco
    FROM autoagenda.planos_aula p
    JOIN autoagenda.alunos al ON al.id=p.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id=p.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id=p.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id=p.local_id
    WHERE p.id=$1
  `, [Number(planId)]);
  if (!p.rowCount) return null;
  const aulas = await client.query(`
    SELECT TO_CHAR(data_aula,'YYYY-MM-DD') AS data_aula,
           TO_CHAR(hora_inicio,'HH24:MI') AS hora_inicio, status
    FROM autoagenda.aulas
    WHERE plan_id=$1 AND arquivada=FALSE
      AND data_aula >= $2::date
    ORDER BY data_aula,hora_inicio,id
    LIMIT 100
  `, [Number(planId), hojeApp()]);
  return { ...p.rows[0], aulas: aulas.rows };
}

function corpoEmailPlano(evento, plano) {
  const primeiroNome = String(plano.aluno_nome || 'Aluno').trim().split(/\s+/)[0] || 'Aluno';
  const titulos = {
    PLANO_AGENDADO: ['Seu plano de aulas foi criado', 'Confira o cronograma das próximas aulas.'],
    PLANO_ATUALIZADO: ['Seu plano de aulas foi atualizado', 'Confira o cronograma atualizado das próximas aulas.'],
    PLANO_CANCELADO: ['Seu plano de aulas foi encerrado', 'As aulas futuras canceladas deixaram de valer no AutoAgenda.']
  };
  const [titulo, intro] = titulos[evento] || titulos.PLANO_ATUALIZADO;
  const linhas = (plano.aulas || []).map(a =>
    `<li style="margin:6px 0">${escaparHtmlEmail(dataBrEmail(a.data_aula))} às ${escaparHtmlEmail(String(a.hora_inicio || '').slice(0,5))} — ${escaparHtmlEmail(a.status || '')}</li>`
  ).join('');
  const listaTexto = (plano.aulas || []).map(a =>
    `${dataBrEmail(a.data_aula)} às ${String(a.hora_inicio || '').slice(0,5)} — ${a.status || ''}`
  ).join('\n') || 'Nenhuma aula futura ativa.';
  const assunto = `AutoAgenda — ${titulo.toLowerCase()}`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e3e7ef;border-radius:18px;overflow:hidden">
      <div style="padding:24px 28px;background:#f7c928"><div style="font-size:13px;font-weight:700">AUTOAGENDA</div><div style="font-size:24px;font-weight:800;margin-top:4px">${escaparHtmlEmail(titulo)}</div></div>
      <div style="padding:26px 28px"><p>Olá, <b>${escaparHtmlEmail(primeiroNome)}</b>. ${escaparHtmlEmail(intro)}</p>
        <p><b>Instrutor:</b> ${escaparHtmlEmail(plano.instrutor_nome || 'A definir')}<br>
        <b>Veículo:</b> ${escaparHtmlEmail(plano.veiculo_nome || 'A definir')}<br>
        <b>Local:</b> ${escaparHtmlEmail(plano.local_nome || 'A definir')}</p>
        <ul style="padding-left:20px;line-height:1.45">${linhas || '<li>Nenhuma aula futura ativa.</li>'}</ul>
        <p style="font-size:12px;color:#8a95a6;margin-top:24px">Mensagem automática do AutoAgenda.</p>
      </div>
    </div></body></html>`;
  const texto = `Olá, ${primeiroNome}. ${intro}\n\nInstrutor: ${plano.instrutor_nome || 'A definir'}\n` +
    `Veículo: ${plano.veiculo_nome || 'A definir'}\nLocal: ${plano.local_nome || 'A definir'}\n\n${listaTexto}`;
  return { assunto, html, texto };
}

async function inserirEmailFila(client, { aulaId=null, planId=null, evento, destinatario, mensagem, chave, agendadoEm=null }) {
  if (!emailFormatoValido(destinatario)) return { ignorado:true, motivo:'SEM_EMAIL_VALIDO' };
  const r = await client.query(`
    INSERT INTO autoagenda.email_envios
      (aula_id,plan_id,evento,destinatario,assunto,corpo_html,corpo_texto,chave_idempotencia,agendado_em,status,automatico)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamp,NOW()),'PENDENTE',TRUE)
    ON CONFLICT (chave_idempotencia) DO NOTHING
    RETURNING id
  `, [
    aulaId ? Number(aulaId) : null, planId ? Number(planId) : null, evento,
    String(destinatario).trim().toLowerCase(), mensagem.assunto, mensagem.html, mensagem.texto,
    chaveEmailSeguro(chave), agendadoEm || null
  ]);
  return r.rowCount ? { id:Number(r.rows[0].id), criado:true } : { criado:false, duplicado:true };
}

async function enfileirarEmailEventoAula(aulaId, evento, versao='') {
  const client = await pool.connect();
  try {
    const cfg = await obterConfigEmail(client);
    if (!cfg.email_automatico_ativo) return { ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    const aula = await detalhesAulaEmail(client, aulaId);
    if (!aula || !emailFormatoValido(aula.aluno_email)) return { ignorado:true, motivo:'SEM_EMAIL_VALIDO' };
    const mensagem = corpoEmailAula(evento, aula);
    const chave = `autoagenda/${evento.toLowerCase()}/aula/${aula.id}/${versao || String(aula.atualizado_em || '')}`;
    return await inserirEmailFila(client, { aulaId:aula.id, evento, destinatario:aula.aluno_email, mensagem, chave });
  } finally { client.release(); }
}

async function enfileirarEmailEventoPlano(planId, evento, versao='') {
  const client = await pool.connect();
  try {
    const cfg = await obterConfigEmail(client);
    if (!cfg.email_automatico_ativo) return { ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    const plano = await detalhesPlanoEmail(client, planId);
    if (!plano || !emailFormatoValido(plano.aluno_email)) return { ignorado:true, motivo:'SEM_EMAIL_VALIDO' };
    const mensagem = corpoEmailPlano(evento, plano);
    const chave = `autoagenda/${evento.toLowerCase()}/plano/${plano.id}/${versao || String(plano.atualizado_em || '')}`;
    return await inserirEmailFila(client, { planId:plano.id, evento, destinatario:plano.aluno_email, mensagem, chave });
  } finally { client.release(); }
}

function dispararEmailAulaSeguro(aulaId, evento, versao='') {
  setImmediate(async () => {
    try {
      const r = await enfileirarEmailEventoAula(aulaId, evento, versao);
      if (r?.criado) await processarEmailsAutomaticos({ origem:`EVENTO_${evento}`, limite:10 });
    } catch (error) {
      console.error(`E-mail ${evento} não enviado; a operação principal foi preservada:`, erroEmailSeguro(error?.message));
    }
  });
}

function dispararEmailPlanoSeguro(planId, evento, versao='') {
  setImmediate(async () => {
    try {
      const r = await enfileirarEmailEventoPlano(planId, evento, versao);
      if (r?.criado) await processarEmailsAutomaticos({ origem:`EVENTO_${evento}`, limite:10 });
    } catch (error) {
      console.error(`E-mail ${evento} do plano não enviado; a operação principal foi preservada:`, erroEmailSeguro(error?.message));
    }
  });
}

async function enviarEmailResend(envio) {
  const cfg = configuracaoEmail();
  if (!cfg.configurada) {
    const e = new Error(`Integração de e-mail não configurada: ${cfg.ausencias.join(', ')}.`);
    e.code = 'EMAIL_NOT_CONFIGURED';
    throw e;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let resposta;
  try {
    const payload = {
      from: cfg.from,
      to: [envio.destinatario],
      subject: envio.assunto,
      html: envio.corpo_html,
      text: envio.corpo_texto || undefined
    };
    if (cfg.replyTo) payload.reply_to = cfg.replyTo;
    resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `AutoAgenda/${APP_VERSION}`,
        'Idempotency-Key': chaveEmailSeguro(envio.chave_idempotencia)
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  let dados = {};
  try { dados = await resposta.json(); } catch {}
  if (!resposta.ok) {
    const msg = dados?.message || dados?.error?.message || dados?.name || `HTTP ${resposta.status}`;
    const e = new Error(`API de e-mail: ${msg}`);
    e.code = dados?.name || `HTTP_${resposta.status}`;
    throw e;
  }
  return { messageId: String(dados?.id || '') || null };
}

async function sincronizarEmailsLembretes(client) {
  const cfg = await obterConfigEmail(client);
  if (!cfg.email_automatico_ativo) return;

  const agora = agoraApp();
  const agoraTexto = `${agora.data} ${agora.hora}:00`;
  const r = await client.query(`
    SELECT a.id AS aula_id,
           TO_CHAR(a.data_aula,'YYYY-MM-DD') AS data_aula,
           TO_CHAR(a.hora_inicio,'HH24:MI') AS hora_inicio,
           a.status, a.arquivada,
           TO_CHAR(a.lembrete_dia_anterior_em,'YYYY-MM-DD HH24:MI:SS') AS lembrete_dia,
           TO_CHAR(a.lembrete_horas_antes_em,'YYYY-MM-DD HH24:MI:SS') AS lembrete_horas,
           al.nome AS aluno_nome, al.email AS aluno_email,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome, l.endereco AS local_endereco
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id=a.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id=a.local_id
    WHERE a.arquivada=FALSE
      AND a.status IN ('AGENDADA','CONFIRMADA')
      AND (a.data_aula + a.hora_inicio) > $1::timestamp
      AND (
        (a.lembrete_dia_anterior_em IS NOT NULL AND a.lembrete_dia_anterior_em <= $1::timestamp)
        OR (a.lembrete_horas_antes_em IS NOT NULL AND a.lembrete_horas_antes_em <= $1::timestamp)
      )
    ORDER BY a.data_aula,a.hora_inicio,a.id
    LIMIT 100
  `, [agoraTexto]);

  for (const aula of r.rows) {
    if (!emailFormatoValido(aula.aluno_email)) continue;
    const tipos = [
      ['LEMBRETE_DIA_ANTERIOR', aula.lembrete_dia],
      ['LEMBRETE_HORAS_ANTES', aula.lembrete_horas]
    ];
    for (const [evento, agendado] of tipos) {
      if (!agendado || String(agendado) > agoraTexto) continue;
      const mensagem = corpoEmailAula(evento, aula);
      const chave = `autoagenda/${evento.toLowerCase()}/aula/${aula.aula_id}/${agendado}`;
      await inserirEmailFila(client, {
        aulaId:aula.aula_id, evento, destinatario:aula.aluno_email, mensagem, chave, agendadoEm:agendado
      });
    }
  }

  // Lembretes antigos deixam de ser elegíveis quando a aula é cancelada/arquivada ou o horário muda.
  await client.query(`
    UPDATE autoagenda.email_envios e
    SET status='CANCELADO', processando_em=NULL,
        erro=COALESCE(erro,'Lembrete de e-mail substituído ou aula não mais elegível.'),
        atualizado_em=NOW()
    WHERE e.status='PENDENTE'
      AND e.evento IN ('LEMBRETE_DIA_ANTERIOR','LEMBRETE_HORAS_ANTES')
      AND NOT EXISTS (
        SELECT 1 FROM autoagenda.aulas a
        WHERE a.id=e.aula_id
          AND a.arquivada=FALSE
          AND a.status IN ('AGENDADA','CONFIRMADA')
          AND CASE e.evento
                WHEN 'LEMBRETE_DIA_ANTERIOR' THEN a.lembrete_dia_anterior_em
                WHEN 'LEMBRETE_HORAS_ANTES' THEN a.lembrete_horas_antes_em
              END IS NOT DISTINCT FROM e.agendado_em
      )
  `);
}

async function processarEmailsAutomaticos({ origem='WORKER', limite=20 } = {}) {
  const client = await pool.connect();
  let lockObtido = false;
  const resultado = { origem, processados:0, enviados:0, falhas:0, cancelados:0, ignorado:false };
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(34003400) AS ok');
    lockObtido = lock.rows[0]?.ok === true;
    if (!lockObtido) return { ...resultado, ignorado:true, motivo:'OUTRO_WORKER_EMAIL_ATIVO' };

    const cfg = await obterConfigEmail(client);
    if (!cfg.email_automatico_ativo) return { ...resultado, ignorado:true, motivo:'AUTOMACAO_DESATIVADA' };
    if (!cfg.email_api_configurada) return { ...resultado, ignorado:true, motivo:'API_NAO_CONFIGURADA', ausencias:cfg.email_api_ausencias };

    await sincronizarAgendamentoLembretes(client);
    await sincronizarEmailsLembretes(client);

    await client.query(`
      UPDATE autoagenda.email_envios
      SET status='FALHOU',
          erro=COALESCE(erro,'Envio interrompido antes de confirmar a resposta da API.'),
          processando_em=NULL, atualizado_em=NOW()
      WHERE status='PROCESSANDO'
        AND processando_em < NOW() - INTERVAL '15 minutes'
    `);

    const fila = await client.query(`
      SELECT id
      FROM autoagenda.email_envios
      WHERE automatico=TRUE AND agendado_em <= NOW()
        AND (
          status='PENDENTE'
          OR (
            status='FALHOU'
            AND tentativas < 3
            AND ultima_tentativa_em IS NOT NULL
            AND ultima_tentativa_em <= NOW() - ((GREATEST(tentativas,1) * 5)::text || ' minutes')::interval
          )
        )
      ORDER BY agendado_em,id
      LIMIT $1
    `, [Math.max(1, Math.min(50, Number(limite) || 20))]);

    for (const item of fila.rows) {
      const envioId = Number(item.id);
      const claim = await client.query(`
        UPDATE autoagenda.email_envios
        SET status='PROCESSANDO', tentativas=tentativas+1,
            ultima_tentativa_em=NOW(), processando_em=NOW(), erro=NULL, atualizado_em=NOW()
        WHERE id=$1 AND status IN ('PENDENTE','FALHOU') AND tentativas < 3
        RETURNING *
      `, [envioId]);
      if (!claim.rowCount) continue;
      resultado.processados++;
      const envio = claim.rows[0];
      try {
        const api = await enviarEmailResend(envio);
        await client.query(`
          UPDATE autoagenda.email_envios
          SET status='ENVIADO', processando_em=NULL, enviado_em=NOW(),
              provider_message_id=$1, erro=NULL, atualizado_em=NOW()
          WHERE id=$2 AND status='PROCESSANDO'
        `, [api.messageId, envioId]);
        resultado.enviados++;
      } catch (error) {
        await client.query(`
          UPDATE autoagenda.email_envios
          SET status='FALHOU', processando_em=NULL, erro=$1, atualizado_em=NOW()
          WHERE id=$2
        `, [erroEmailSeguro(error?.message), envioId]);
        resultado.falhas++;
      }
    }
    return resultado;
  } finally {
    if (lockObtido) {
      try { await client.query('SELECT pg_advisory_unlock(34003400)'); } catch {}
    }
    client.release();
  }
}

let lembreteWorkerTimer = null;
function iniciarWorkerLembretesAutomaticos() {
  const bruto = Number(process.env.AUTOAGENDA_COMM_WORKER_INTERVAL_MINUTES || process.env.WHATSAPP_WORKER_INTERVAL_MINUTES || 1);
  const minutos = Number.isFinite(bruto) ? Math.max(1, Math.min(60, Math.floor(bruto))) : 1;
  const executar = async () => {
    try {
      const r = await processarLembretesAutomaticos({ origem: 'WORKER' });
      if (r.enviados || r.falhas || r.cancelados) {
        console.log(`Lembretes WhatsApp: ${r.enviados} enviado(s), ${r.falhas} falha(s), ${r.cancelados} cancelado(s).`);
      }
      const w = await processarWhatsAppComunicacoesAutomaticas({ origem:'WORKER', limite:20 });
      if (w.enviados || w.falhas || w.cancelados) {
        console.log(`WhatsApp transacional: ${w.enviados} enviado(s), ${w.falhas} falha(s), ${w.cancelados} cancelado(s).`);
      }
      const e = await processarEmailsAutomaticos({ origem: 'WORKER', limite: 20 });
      if (e.enviados || e.falhas || e.cancelados) {
        console.log(`E-mails AutoAgenda: ${e.enviados} enviado(s), ${e.falhas} falha(s), ${e.cancelados} cancelado(s).`);
      }
    } catch (error) {
      console.error('Worker de comunicações automáticas falhou:', erroEmailSeguro(error?.message || erroWhatsAppSeguro(error?.message)));
    }
  };
  const primeiraExecucao = setTimeout(executar, 15000);
  if (typeof primeiraExecucao.unref === 'function') primeiraExecucao.unref();
  lembreteWorkerTimer = setInterval(executar, minutos * 60 * 1000);
  if (typeof lembreteWorkerTimer.unref === 'function') lembreteWorkerTimer.unref();
  console.log(`Comunicações automáticas: worker preparado a cada ${minutos} minuto(s); WhatsApp e e-mail enviam automaticamente quando as respectivas integrações estiverem configuradas.`);
}

function avaliarHorarioFuncionamento(config, dados) {
  const data = String(dados.data_aula || dados.data_inicio || '').slice(0, 10);
  const horaInicio = String(dados.hora_inicio || '').slice(0, 5);
  const duracao = Number(dados.duracao_minutos || dados.duracao_base_minutos || config.duracao_padrao_minutos || 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, motivo: 'Data inválida.' };

  const dia = diaSemanaDaData(data);
  const dias = Array.isArray(config.dias_funcionamento) ? config.dias_funcionamento.map(Number) : [];
  if (!dias.includes(dia)) {
    return { ok: false, motivo: `A autoescola está fechada no ${NOMES_DIAS[dia]}.` };
  }

  const inicio = minutosDoHorario(horaInicio);
  const abertura = minutosDoHorario(config.hora_abertura);
  const encerramento = minutosDoHorario(config.hora_encerramento);
  if (!Number.isFinite(inicio)) return { ok: false, motivo: 'Horário inválido.' };
  if (!Number.isFinite(duracao) || duracao < 1) return { ok: false, motivo: 'Duração inválida.' };

  if (inicio < abertura) {
    return { ok: false, motivo: `O horário deve começar a partir das ${config.hora_abertura}.` };
  }
  if (inicio + duracao > encerramento) {
    return { ok: false, motivo: `A aula deve terminar até ${config.hora_encerramento}.` };
  }
  return { ok: true, dia, inicio, fim: inicio + duracao };
}

async function validarHorarioFuncionamento(client, dados, config = null) {
  const cfg = config || await obterConfigFuncionamento(client);
  const r = avaliarHorarioFuncionamento(cfg, dados);
  if (!r.ok) {
    const data = String(dados.data_aula || dados.data_inicio || '').slice(0, 10);
    const h = String(dados.hora_inicio || '').slice(0, 5);
    throw erroHttp(400, `Horário fora do funcionamento em ${data || 'data não informada'}${h ? ` às ${h}` : ''}: ${r.motivo}`);
  }
  return cfg;
}

async function validarOcorrenciasFuncionamento(client, ocorrencias, config = null) {
  const cfg = config || await obterConfigFuncionamento(client);
  for (const o of ocorrencias) {
    await validarHorarioFuncionamento(client, o, cfg);
  }
  return cfg;
}

function normalizarConfiguracaoFuncionamento(payload) {
  const dias = Array.from(new Set(
    (Array.isArray(payload?.dias_funcionamento) ? payload.dias_funcionamento : [])
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
  )).sort((a,b) => a-b);
  if (!dias.length) throw erroHttp(400, 'Selecione pelo menos um dia de funcionamento.');

  const horaAbertura = String(payload?.hora_abertura || '').slice(0,5);
  const horaEncerramento = String(payload?.hora_encerramento || '').slice(0,5);
  const abertura = minutosDoHorario(horaAbertura);
  const encerramento = minutosDoHorario(horaEncerramento);
  if (!Number.isFinite(abertura) || !Number.isFinite(encerramento)) {
    throw erroHttp(400, 'Informe horários válidos de abertura e encerramento.');
  }
  if (encerramento <= abertura) throw erroHttp(400, 'O horário de encerramento deve ser depois do horário de abertura.');

  const duracao = Number(payload?.duracao_padrao_minutos);
  const intervalo = Number(payload?.intervalo_minutos ?? 0);
  if (!Number.isInteger(duracao) || duracao < 10 || duracao > 240) {
    throw erroHttp(400, 'A duração padrão deve estar entre 10 e 240 minutos.');
  }
  if (!Number.isInteger(intervalo) || intervalo < 0 || intervalo > 120) {
    throw erroHttp(400, 'O intervalo deve estar entre 0 e 120 minutos.');
  }
  if (duracao > (encerramento - abertura)) {
    throw erroHttp(400, 'A duração padrão é maior que o período diário de funcionamento.');
  }

  return {
    dias_funcionamento: dias,
    hora_abertura: horaAbertura,
    hora_encerramento: horaEncerramento,
    duracao_padrao_minutos: duracao,
    intervalo_minutos: intervalo
  };
}


function normalizarDisponibilidadeInstrutor(payload, configFuncionamento) {
  const personalizada = payload?.disponibilidade_personalizada === true ||
    String(payload?.disponibilidade_personalizada || '').toLowerCase() === 'true';

  if (!personalizada) {
    return {
      disponibilidade_personalizada: false,
      dias_trabalho: null,
      hora_inicio: null,
      hora_fim: null,
      intervalo_inicio: null,
      intervalo_fim: null
    };
  }

  const dias = Array.from(new Set(
    (Array.isArray(payload?.dias_trabalho) ? payload.dias_trabalho : [])
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
  )).sort((a,b) => a-b);

  if (!dias.length) throw erroHttp(400, 'Selecione pelo menos um dia de trabalho para o instrutor.');

  const diasEscola = Array.isArray(configFuncionamento?.dias_funcionamento)
    ? configFuncionamento.dias_funcionamento.map(Number)
    : [0,1,2,3,4,5,6];
  const diasFora = dias.filter(d => !diasEscola.includes(d));
  if (diasFora.length) {
    throw erroHttp(400, 'O instrutor não pode trabalhar em dias em que a autoescola está fechada.');
  }

  const horaInicio = String(payload?.hora_inicio || '').slice(0,5);
  const horaFim = String(payload?.hora_fim || '').slice(0,5);
  const inicio = minutosDoHorario(horaInicio);
  const fim = minutosDoHorario(horaFim);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) {
    throw erroHttp(400, 'Informe um horário válido de início e fim para o instrutor.');
  }

  const abertura = minutosDoHorario(configFuncionamento?.hora_abertura || '07:00');
  const encerramento = minutosDoHorario(configFuncionamento?.hora_encerramento || '20:00');
  if (inicio < abertura || fim > encerramento) {
    throw erroHttp(
      400,
      `A disponibilidade do instrutor deve ficar dentro do funcionamento da autoescola (${configFuncionamento.hora_abertura}–${configFuncionamento.hora_encerramento}).`
    );
  }

  const intervaloInicioTxt = String(payload?.intervalo_inicio || '').slice(0,5);
  const intervaloFimTxt = String(payload?.intervalo_fim || '').slice(0,5);
  const temIntervalo = Boolean(intervaloInicioTxt || intervaloFimTxt);
  let intervaloInicio = null;
  let intervaloFim = null;

  if (temIntervalo) {
    const ii = minutosDoHorario(intervaloInicioTxt);
    const ifim = minutosDoHorario(intervaloFimTxt);
    if (!Number.isFinite(ii) || !Number.isFinite(ifim) || ifim <= ii) {
      throw erroHttp(400, 'Informe corretamente o início e o fim do intervalo do instrutor.');
    }
    if (ii < inicio || ifim > fim) {
      throw erroHttp(400, 'O intervalo do instrutor deve ficar dentro do seu horário de trabalho.');
    }
    intervaloInicio = intervaloInicioTxt;
    intervaloFim = intervaloFimTxt;
  }

  return {
    disponibilidade_personalizada: true,
    dias_trabalho: dias,
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    intervalo_inicio: intervaloInicio,
    intervalo_fim: intervaloFim
  };
}

function normalizarInstrutorDisponibilidadeRow(row) {
  return {
    ...row,
    disponibilidade_personalizada: row?.disponibilidade_personalizada === true,
    dias_trabalho: Array.isArray(row?.dias_trabalho) ? row.dias_trabalho.map(Number).sort((a,b)=>a-b) : null,
    hora_inicio: row?.hora_inicio ? String(row.hora_inicio).slice(0,5) : null,
    hora_fim: row?.hora_fim ? String(row.hora_fim).slice(0,5) : null,
    intervalo_inicio: row?.intervalo_inicio ? String(row.intervalo_inicio).slice(0,5) : null,
    intervalo_fim: row?.intervalo_fim ? String(row.intervalo_fim).slice(0,5) : null
  };
}

function avaliarDisponibilidadeInstrutorBase(instrutor, dados, configFuncionamento) {
  if (!instrutor?.disponibilidade_personalizada) return { ok: true };

  const data = String(dados.data_aula || dados.data_inicio || '').slice(0,10);
  const horaInicio = String(dados.hora_inicio || '').slice(0,5);
  const duracao = Number(dados.duracao_minutos || dados.duracao_base_minutos || configFuncionamento?.duracao_padrao_minutos || 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok:false, motivo:'Data inválida.' };

  const dia = diaSemanaDaData(data);
  const dias = Array.isArray(instrutor.dias_trabalho) ? instrutor.dias_trabalho.map(Number) : [];
  if (!dias.includes(dia)) {
    return { ok:false, motivo:`O instrutor não trabalha no ${NOMES_DIAS[dia]}.` };
  }

  const inicio = minutosDoHorario(horaInicio);
  const fim = inicio + duracao;
  const dispInicio = minutosDoHorario(instrutor.hora_inicio);
  const dispFim = minutosDoHorario(instrutor.hora_fim);
  if (inicio < dispInicio || fim > dispFim) {
    return { ok:false, motivo:`O instrutor está disponível somente das ${instrutor.hora_inicio} às ${instrutor.hora_fim}.` };
  }

  if (instrutor.intervalo_inicio && instrutor.intervalo_fim) {
    const intIni = minutosDoHorario(instrutor.intervalo_inicio);
    const intFim = minutosDoHorario(instrutor.intervalo_fim);
    if (inicio < intFim && fim > intIni) {
      return { ok:false, motivo:`O instrutor está em intervalo das ${instrutor.intervalo_inicio} às ${instrutor.intervalo_fim}.` };
    }
  }

  return { ok:true };
}

async function obterInstrutorDisponibilidade(client, instrutorId) {
  const r = await client.query(`
    SELECT id, nome, ativo, disponibilidade_personalizada, dias_trabalho,
           TO_CHAR(hora_inicio, 'HH24:MI') AS hora_inicio,
           TO_CHAR(hora_fim, 'HH24:MI') AS hora_fim,
           TO_CHAR(intervalo_inicio, 'HH24:MI') AS intervalo_inicio,
           TO_CHAR(intervalo_fim, 'HH24:MI') AS intervalo_fim
    FROM autoagenda.instrutores
    WHERE id = $1
  `, [Number(instrutorId)]);
  if (!r.rowCount) throw erroHttp(404, 'Instrutor não encontrado.');
  return normalizarInstrutorDisponibilidadeRow(r.rows[0]);
}

async function validarDisponibilidadeInstrutor(client, instrutorId, dados, configFuncionamento = null) {
  const cfg = configFuncionamento || await obterConfigFuncionamento(client);
  const instrutor = await obterInstrutorDisponibilidade(client, instrutorId);
  const base = avaliarDisponibilidadeInstrutorBase(instrutor, dados, cfg);
  if (!base.ok) {
    const data = String(dados.data_aula || dados.data_inicio || '').slice(0,10);
    const h = String(dados.hora_inicio || '').slice(0,5);
    throw erroHttp(400, `Instrutor indisponível em ${data}${h ? ` às ${h}` : ''}: ${base.motivo}`);
  }

  const data = String(dados.data_aula || dados.data_inicio || '').slice(0,10);
  const bloqueio = await client.query(`
    SELECT id, data_inicio, data_fim, motivo
    FROM autoagenda.instrutor_indisponibilidades
    WHERE instrutor_id = $1
      AND $2::date BETWEEN data_inicio AND data_fim
    ORDER BY data_inicio, id
    LIMIT 1
  `, [Number(instrutorId), data]);

  if (bloqueio.rowCount) {
    const b = bloqueio.rows[0];
    const motivo = b.motivo ? ` Motivo: ${b.motivo}.` : '';
    throw erroHttp(400, `Instrutor indisponível em ${data}: existe uma folga/indisponibilidade cadastrada.${motivo}`);
  }

  return instrutor;
}

async function validarOcorrenciasInstrutor(client, instrutorId, ocorrencias, configFuncionamento = null) {
  const cfg = configFuncionamento || await obterConfigFuncionamento(client);
  const instrutor = await obterInstrutorDisponibilidade(client, instrutorId);

  const bloqueiosQ = await client.query(`
    SELECT data_inicio, data_fim, motivo
    FROM autoagenda.instrutor_indisponibilidades
    WHERE instrutor_id = $1
      AND data_fim >= $2::date
      AND data_inicio <= $3::date
    ORDER BY data_inicio
  `, [
    Number(instrutorId),
    ocorrencias.length ? ocorrencias[0].data_aula : hojeApp(),
    ocorrencias.length ? ocorrencias[ocorrencias.length - 1].data_aula : hojeApp()
  ]);
  const bloqueios = bloqueiosQ.rows;

  for (const o of ocorrencias) {
    const base = avaliarDisponibilidadeInstrutorBase(instrutor, o, cfg);
    if (!base.ok) {
      throw erroHttp(400, `Instrutor indisponível em ${o.data_aula} às ${o.hora_inicio}: ${base.motivo}`);
    }
    const bloqueio = bloqueios.find(b => o.data_aula >= String(b.data_inicio).slice(0,10) && o.data_aula <= String(b.data_fim).slice(0,10));
    if (bloqueio) {
      const motivo = bloqueio.motivo ? ` Motivo: ${bloqueio.motivo}.` : '';
      throw erroHttp(400, `Instrutor indisponível em ${o.data_aula}: existe uma folga/indisponibilidade cadastrada.${motivo}`);
    }
  }
  return instrutor;
}

async function contarAulasFuturasForaDisponibilidade(client, instrutorId, instrutorConfig, configFuncionamento) {
  if (!instrutorConfig?.disponibilidade_personalizada) return 0;
  const r = await client.query(`
    SELECT data_aula, hora_inicio, duracao_minutos
    FROM autoagenda.aulas
    WHERE instrutor_id = $1
      AND data_aula >= $2::date
      AND status IN ('AGENDADA','CONFIRMADA')
  `, [Number(instrutorId), hojeApp()]);
  return r.rows.filter(a => !avaliarDisponibilidadeInstrutorBase(instrutorConfig, a, configFuncionamento).ok).length;
}


const SITUACOES_VEICULO = ['DISPONIVEL','MANUTENCAO','INDISPONIVEL','INATIVO'];
const TIPOS_INDISPONIBILIDADE_VEICULO = ['MANUTENCAO','INDISPONIVEL'];

function normalizarSituacaoVeiculo(valor, padrao = 'DISPONIVEL') {
  const s = String(valor || padrao).trim().toUpperCase();
  if (!SITUACOES_VEICULO.includes(s)) throw erroHttp(400, 'Situação do veículo inválida.');
  return s;
}

function normalizarTipoIndisponibilidadeVeiculo(valor) {
  const s = String(valor || 'INDISPONIVEL').trim().toUpperCase();
  if (!TIPOS_INDISPONIBILIDADE_VEICULO.includes(s)) throw erroHttp(400, 'Tipo de indisponibilidade do veículo inválido.');
  return s;
}

async function obterVeiculoDisponibilidade(client, veiculoId) {
  const r = await client.query(`
    SELECT id, nome, placa, categoria, ativo,
           UPPER(COALESCE(situacao,'DISPONIVEL')) AS situacao
    FROM autoagenda.veiculos
    WHERE id=$1
  `, [Number(veiculoId)]);
  if (!r.rowCount) throw erroHttp(404, 'Veículo não encontrado.');
  return r.rows[0];
}

async function validarDisponibilidadeVeiculo(client, veiculoId, dados) {
  const veiculo = await obterVeiculoDisponibilidade(client, veiculoId);
  const situacao = veiculo.ativo === false ? 'INATIVO' : normalizarSituacaoVeiculo(veiculo.situacao);

  if (situacao === 'INATIVO') throw erroHttp(400, 'O veículo selecionado está inativo.');
  if (situacao === 'MANUTENCAO') throw erroHttp(400, 'O veículo selecionado está em manutenção e não pode receber novas aulas.');
  if (situacao === 'INDISPONIVEL') throw erroHttp(400, 'O veículo selecionado está indisponível e não pode receber novas aulas.');

  const data = String(dados.data_aula || dados.data_inicio || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw erroHttp(400, 'Data inválida para verificar o veículo.');

  const bloqueio = await client.query(`
    SELECT id, data_inicio, data_fim, tipo, motivo
    FROM autoagenda.veiculo_indisponibilidades
    WHERE veiculo_id=$1
      AND $2::date BETWEEN data_inicio AND data_fim
    ORDER BY data_inicio, id
    LIMIT 1
  `, [Number(veiculoId), data]);

  if (bloqueio.rowCount) {
    const b = bloqueio.rows[0];
    const tipo = String(b.tipo || '').toUpperCase() === 'MANUTENCAO' ? 'manutenção' : 'indisponibilidade';
    const motivo = b.motivo ? ` Motivo: ${b.motivo}.` : '';
    throw erroHttp(400, `Veículo indisponível em ${data}: existe um período de ${tipo} cadastrado.${motivo}`);
  }
  return veiculo;
}

async function validarOcorrenciasVeiculo(client, veiculoId, ocorrencias) {
  const veiculo = await obterVeiculoDisponibilidade(client, veiculoId);
  const situacao = veiculo.ativo === false ? 'INATIVO' : normalizarSituacaoVeiculo(veiculo.situacao);
  if (situacao !== 'DISPONIVEL') {
    const nomes = { INATIVO:'inativo', MANUTENCAO:'em manutenção', INDISPONIVEL:'indisponível' };
    throw erroHttp(400, `O veículo selecionado está ${nomes[situacao] || 'indisponível'} e não pode ser usado no plano.`);
  }
  if (!ocorrencias.length) return veiculo;

  const de = ocorrencias[0].data_aula;
  const ate = ocorrencias[ocorrencias.length - 1].data_aula;
  const bloqueiosQ = await client.query(`
    SELECT data_inicio, data_fim, tipo, motivo
    FROM autoagenda.veiculo_indisponibilidades
    WHERE veiculo_id=$1
      AND data_fim >= $2::date
      AND data_inicio <= $3::date
    ORDER BY data_inicio
  `, [Number(veiculoId), de, ate]);

  for (const o of ocorrencias) {
    const bloqueio = bloqueiosQ.rows.find(b =>
      o.data_aula >= String(b.data_inicio).slice(0,10) &&
      o.data_aula <= String(b.data_fim).slice(0,10)
    );
    if (bloqueio) {
      const tipo = String(bloqueio.tipo || '').toUpperCase() === 'MANUTENCAO' ? 'manutenção' : 'indisponibilidade';
      const motivo = bloqueio.motivo ? ` Motivo: ${bloqueio.motivo}.` : '';
      throw erroHttp(400, `Veículo indisponível em ${o.data_aula}: existe um período de ${tipo} cadastrado.${motivo}`);
    }
  }
  return veiculo;
}

function gerarOcorrencias({ data_inicio, hora_inicio, duracao_base_minutos, aulas_por_encontro, total_aulas, dias_semana }) {
  const dias = normalizarDias(dias_semana, data_inicio);
  const base = Math.max(1, Number(duracao_base_minutos) || 50);
  const porEncontro = Math.min(4, Math.max(1, Number(aulas_por_encontro) || 1));
  const total = Math.max(1, Number(total_aulas) || 1);
  const inicio = dateOnlyUTC(data_inicio);
  const ocorrencias = [];
  let unidadesGeradas = 0;
  let cursor = new Date(inicio.getTime());
  let seguranca = 0;

  while (unidadesGeradas < total && seguranca < 730) {
    if (dias.includes(cursor.getUTCDay())) {
      const unidades = Math.min(porEncontro, total - unidadesGeradas);
      ocorrencias.push({
        data_aula: isoDateUTC(cursor),
        hora_inicio: String(hora_inicio).slice(0, 5),
        aulas_unidades: unidades,
        duracao_minutos: base * unidades,
        numero_plano: ocorrencias.length + 1
      });
      unidadesGeradas += unidades;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    seguranca += 1;
  }

  if (unidadesGeradas < total) throw new Error('Não foi possível gerar todas as aulas dentro do limite de datas.');
  return ocorrencias;
}

async function bloquearChavesTransacao(client, chaves) {
  const unicas = Array.from(new Set((chaves || []).filter(Boolean).map(String))).sort();
  for (const chave of unicas) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [chave]);
  }
}

function chavesAgenda(dados) {
  const data = String(dados.data_aula || '').slice(0,10);
  return [
    `saldo:aluno:${Number(dados.aluno_id)}`,
    `agenda:aluno:${Number(dados.aluno_id)}:${data}`,
    `agenda:instrutor:${Number(dados.instrutor_id)}:${data}`,
    `agenda:veiculo:${Number(dados.veiculo_id)}:${data}`
  ];
}

async function verificarConflito(client, dados, excluirIds = [], intervaloMinutos = null) {
  const inicio = `${dados.data_aula} ${String(dados.hora_inicio).slice(0, 5)}:00`;
  const ids = (Array.isArray(excluirIds) ? excluirIds : [excluirIds]).map(Number).filter(Boolean);
  const intervalo = intervaloMinutos === null
    ? Number((await obterConfigFuncionamento(client)).intervalo_minutos || 0)
    : Math.max(0, Number(intervaloMinutos) || 0);

  return client.query(`
    SELECT a.id, a.data_aula, a.hora_inicio, a.duracao_minutos,
           al.nome AS aluno_nome, i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id = a.aluno_id
    JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
    JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
    WHERE a.data_aula = $1
      AND a.status IN ('AGENDADA', 'CONFIRMADA')
      AND (cardinality($7::int[]) = 0 OR NOT (a.id = ANY($7::int[])))
      AND (a.aluno_id = $2 OR a.instrutor_id = $3 OR a.veiculo_id = $4)
      AND ((a.data_aula + a.hora_inicio) < ($5::timestamp + (($6::int + $8::int) * INTERVAL '1 minute')))
      AND ($5::timestamp < (a.data_aula + a.hora_inicio + ((a.duracao_minutos + $8::int) * INTERVAL '1 minute')))
    ORDER BY a.hora_inicio
    LIMIT 1
  `, [
    dados.data_aula,
    Number(dados.aluno_id),
    Number(dados.instrutor_id),
    Number(dados.veiculo_id),
    inicio,
    Number(dados.duracao_minutos),
    ids,
    intervalo
  ]);
}

async function sugerirHorario(client, dados, excluirIds = [], config = null) {
  const cfg = config || await obterConfigFuncionamento(client);
  const avaliacaoDia = avaliarHorarioFuncionamento(cfg, {
    data_aula: dados.data_aula,
    hora_inicio: cfg.hora_abertura,
    duracao_minutos: Math.min(Number(dados.duracao_minutos || cfg.duracao_padrao_minutos), Number(cfg.duracao_padrao_minutos))
  });
  if (!avaliacaoDia.ok && !String(avaliacaoDia.motivo).includes('terminar')) return null;

  const inicioBase = minutosDoHorario(cfg.hora_abertura);
  const fim = minutosDoHorario(cfg.hora_encerramento);
  const passo = Math.max(5, Number(cfg.duracao_padrao_minutos || 50) + Number(cfg.intervalo_minutos || 0));
  for (let min = inicioBase; min + Number(dados.duracao_minutos) <= fim; min += passo) {
    const teste = { ...dados, hora_inicio: horarioDeMinutos(min) };
    const permitido = avaliarHorarioFuncionamento(cfg, teste);
    if (!permitido.ok) continue;
    try {
      await validarDisponibilidadeInstrutor(client, teste.instrutor_id, teste, cfg);
      await validarDisponibilidadeVeiculo(client, teste.veiculo_id, teste);
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 404) continue;
      throw error;
    }
    const conflito = await verificarConflito(client, teste, excluirIds, cfg.intervalo_minutos);
    if (!conflito.rowCount) return teste.hora_inicio;
  }
  return null;
}

async function listarConflitosPlano(client, base, ocorrencias, config = null) {
  const cfg = config || await obterConfigFuncionamento(client);
  const conflitos = [];
  for (const o of ocorrencias) {
    const dados = {
      aluno_id: base.aluno_id,
      instrutor_id: base.instrutor_id,
      veiculo_id: base.veiculo_id,
      data_aula: o.data_aula,
      hora_inicio: o.hora_inicio,
      duracao_minutos: o.duracao_minutos
    };
    const c = await verificarConflito(client, dados, [], cfg.intervalo_minutos);
    if (c.rowCount) {
      const sugestao = await sugerirHorario(client, dados, [], cfg);
      conflitos.push({ ...o, conflito: c.rows[0], sugestao_horario: sugestao });
    }
  }
  return conflitos;
}

// ========================= ALUNOS =========================
function cpfMascaradoServidor(cpf) {
  const x = normalizarCpf(cpf);
  return x.length === 11 ? `***.***.***-${x.slice(-2)}` : null;
}

async function desativarAlunoComHistorico(client, id) {
  const result = await client.query(`
    UPDATE autoagenda.alunos
    SET ativo = FALSE, atualizado_em = NOW()
    WHERE id = $1 AND ativo = TRUE
    RETURNING id
  `, [id]);
  if (!result.rowCount) throw erroHttp(404, 'Aluno não encontrado ou já está inativo.');

  const planosEncerrados = await client.query(`
    UPDATE autoagenda.planos_aula
    SET ativo = FALSE, atualizado_em = NOW()
    WHERE aluno_id = $1 AND ativo = TRUE
    RETURNING id
  `, [id]);

  const futurasCanceladas = await client.query(`
    UPDATE autoagenda.aulas
    SET status = 'CANCELADA', atualizado_em = NOW()
    WHERE aluno_id = $1
      AND data_aula >= $2::date
      AND status IN ('AGENDADA','CONFIRMADA')
      AND arquivada = FALSE
    RETURNING id
  `, [id, hojeApp()]);

  return {
    ok: true,
    planos_encerrados: planosEncerrados.rowCount,
    aulas_futuras_canceladas: futurasCanceladas.rowCount
  };
}

app.get('/api/alunos', async (req, res) => {
  try {
    const instrutorEscopo = instrutorIdDaSessao(req);
    const mostrarTodos = usuarioEhAdmin(req) ? incluirInativos(req) : false;
    const result = await query(`
      SELECT a.id, a.nome, a.whatsapp, a.email, TO_CHAR(a.data_nascimento, 'YYYY-MM-DD') AS data_nascimento, a.categoria,
             a.aulas_contratadas, a.aulas_realizadas,
             a.aulas_realizadas_anteriores,
             a.ativo, a.criado_em,
             (SELECT av.resultado FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_resultado,
             (SELECT av.avaliador_nome FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_avaliador_nome,
             (SELECT av.criado_em FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_criado_em,
             CASE WHEN LENGTH(COALESCE(a.cpf,'')) = 11
                  THEN '***.***.***-' || RIGHT(a.cpf, 2)
                  ELSE NULL END AS cpf_mascarado,
             COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id AND au.status = 'REALIZADA' AND au.arquivada = FALSE
             ), 0)::int AS realizadas_sistema,
             COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id AND au.status = 'FALTOU' AND au.arquivada = FALSE
             ), 0)::int AS faltas_unidades,
             COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id
                 AND au.data_aula >= $1::date
                 AND au.status IN ('AGENDADA','CONFIRMADA')
                 AND au.arquivada = FALSE
             ), 0)::int AS aulas_agendadas
      FROM autoagenda.alunos a
      WHERE ($2::boolean = TRUE OR a.ativo = TRUE)
        AND ($3::int = 0 OR EXISTS (
          SELECT 1
          FROM autoagenda.aulas rel
          WHERE rel.aluno_id = a.id
            AND rel.instrutor_id = $3
        ))
      ORDER BY a.ativo DESC, a.nome
    `, [hojeApp(), mostrarTodos, instrutorEscopo]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar alunos.' });
  }
});

// O CPF completo só é enviado ao ADMIN; o perfil INSTRUTOR recebe apenas a versão mascarada.
app.get('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    const result = await query(`
      SELECT a.id, a.nome,
             CASE WHEN $3::boolean THEN a.cpf ELSE NULL END AS cpf,
             CASE WHEN LENGTH(COALESCE(a.cpf,'')) = 11
                  THEN '***.***.***-' || RIGHT(a.cpf, 2)
                  ELSE NULL END AS cpf_mascarado,
             a.whatsapp, a.email, TO_CHAR(a.data_nascimento, 'YYYY-MM-DD') AS data_nascimento, a.categoria,
             a.aulas_contratadas, a.aulas_realizadas, a.aulas_realizadas_anteriores,
             a.observacoes, a.ativo, a.criado_em, a.atualizado_em,
             (SELECT av.resultado FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_resultado,
             (SELECT av.avaliador_nome FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_avaliador_nome,
             (SELECT av.criado_em FROM autoagenda.avaliacoes_aluno av WHERE av.aluno_id=a.id ORDER BY av.criado_em DESC, av.id DESC LIMIT 1) AS avaliacao_criado_em
      FROM autoagenda.alunos a
      WHERE a.id = $1
        AND ($2::int = 0 OR EXISTS (
          SELECT 1 FROM autoagenda.aulas rel
          WHERE rel.aluno_id = a.id AND rel.instrutor_id = $2
        ))
    `, [id, instrutorEscopo, usuarioEhAdmin(req)]);
    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar aluno.' });
  }
});


// ========================= V2.2 — HISTÓRICO COMPLETO DO ALUNO =========================
// Consulta somente leitura. Não altera o cálculo de saldo já utilizado pelo AutoAgenda.
app.get('/api/alunos/:id/historico', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Aluno inválido.' });

    const alunoQ = await query(`
      SELECT id, nome, whatsapp, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento, categoria, aulas_contratadas,
             aulas_realizadas, aulas_realizadas_anteriores, observacoes,
             ativo, criado_em, atualizado_em,
             CASE WHEN LENGTH(COALESCE(cpf,'')) = 11
                  THEN '***.***.***-' || RIGHT(cpf, 2)
                  ELSE NULL END AS cpf_mascarado
      FROM autoagenda.alunos al
      WHERE al.id = $1
        AND ($2::int = 0 OR EXISTS (
          SELECT 1 FROM autoagenda.aulas rel
          WHERE rel.aluno_id = al.id AND rel.instrutor_id = $2
        ))
    `, [id, instrutorEscopo]);
    if (!alunoQ.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const hoje = hojeApp();
    const [metricasQ, aulasQ, planosQ, avaliacoesQ] = await Promise.all([
      query(`
        SELECT
          COALESCE(SUM(CASE
            WHEN status='REALIZADA' AND arquivada=FALSE THEN aulas_unidades ELSE 0 END),0)::int AS realizadas_sistema,
          COALESCE(SUM(CASE
            WHEN data_aula >= $2::date
             AND status IN ('AGENDADA','CONFIRMADA')
             AND arquivada=FALSE THEN aulas_unidades ELSE 0 END),0)::int AS futuras_unidades,
          COUNT(*) FILTER (WHERE status='FALTOU')::int AS faltas,
          COALESCE(SUM(CASE WHEN status='FALTOU' AND arquivada=FALSE THEN aulas_unidades ELSE 0 END),0)::int AS faltas_unidades,
          COUNT(*) FILTER (WHERE status='CANCELADA')::int AS cancelamentos,
          COUNT(*) FILTER (WHERE reposicao_de_id IS NOT NULL)::int AS reposicoes,
          COUNT(*)::int AS total_registros,
          MIN(data_aula) AS primeira_aula,
          MAX(data_aula) AS ultima_aula,
          MAX(data_aula) FILTER (WHERE status='REALIZADA') AS ultima_realizada
        FROM autoagenda.aulas
        WHERE aluno_id=$1
          AND ($3::int = 0 OR instrutor_id=$3)
      `, [id, hoje, instrutorEscopo]),
      query(`
        SELECT a.id, a.data_aula, a.hora_inicio, a.duracao_minutos,
               a.status, a.confirmacao_status, a.confirmacao_origem, a.confirmacao_atualizada_em,
               a.observacoes, a.aulas_unidades,
               a.plan_id, a.numero_plano, a.excecao_plano,
               a.arquivada, a.arquivada_em, a.reposicao_de_id,
               i.nome AS instrutor_nome,
               v.nome AS veiculo_nome, v.placa AS veiculo_placa,
               l.nome AS local_nome,
               origem.data_aula AS reposicao_data_original,
               origem.hora_inicio AS reposicao_hora_original,
               COALESCE((
                 SELECT COUNT(*) FROM autoagenda.aulas r
                 WHERE r.reposicao_de_id=a.id
               ),0)::int AS reposicoes_geradas
        FROM autoagenda.aulas a
        JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
        JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
        JOIN autoagenda.locais l ON l.id=a.local_id
        LEFT JOIN autoagenda.aulas origem ON origem.id=a.reposicao_de_id
        WHERE a.aluno_id=$1
          AND ($2::int = 0 OR a.instrutor_id=$2)
        ORDER BY a.data_aula DESC, a.hora_inicio DESC, a.id DESC
      `, [id, instrutorEscopo]),
      query(`
        SELECT p.id, p.data_inicio, p.hora_inicio, p.duracao_base_minutos,
               p.aulas_por_encontro, p.total_aulas, p.dias_semana,
               p.observacoes, p.ativo, p.criado_em, p.atualizado_em,
               i.nome AS instrutor_nome,
               v.nome AS veiculo_nome, v.placa AS veiculo_placa,
               l.nome AS local_nome,
               COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.plan_id=p.id),0)::int AS encontros_gerados,
               COALESCE((SELECT SUM(a.aulas_unidades) FROM autoagenda.aulas a WHERE a.plan_id=p.id),0)::int AS aulas_geradas
        FROM autoagenda.planos_aula p
        JOIN autoagenda.instrutores i ON i.id=p.instrutor_id
        JOIN autoagenda.veiculos v ON v.id=p.veiculo_id
        JOIN autoagenda.locais l ON l.id=p.local_id
        WHERE p.aluno_id=$1
          AND ($2::int = 0 OR p.instrutor_id=$2)
        ORDER BY p.criado_em DESC, p.id DESC
      `, [id, instrutorEscopo])
,
      query(`
        SELECT av.id, av.resultado, av.observacoes, av.avaliador_nome, av.avaliador_perfil,
               av.instrutor_id, i.nome AS instrutor_nome, av.criado_em
        FROM autoagenda.avaliacoes_aluno av
        LEFT JOIN autoagenda.instrutores i ON i.id=av.instrutor_id
        WHERE av.aluno_id=$1
        ORDER BY av.criado_em DESC, av.id DESC
      `, [id])
    ]);

    const aluno = alunoQ.rows[0];
    const m = metricasQ.rows[0] || {};
    const contratadas = Number(aluno.aulas_contratadas || 0);
    const anteriores = Number(aluno.aulas_realizadas_anteriores ?? aluno.aulas_realizadas ?? 0);
    const realizadasSistema = Number(m.realizadas_sistema || 0);
    const realizadas = Math.max(0, anteriores) + Math.max(0, realizadasSistema);
    const faltasUnidades = Math.max(0, Number(m.faltas_unidades || 0));
    const consumidas = realizadas + faltasUnidades;
    const futuras = Math.max(0, Number(m.futuras_unidades || 0));

    // FALTOU = falta sem justificativa: a aula continua aparecendo como falta no histórico,
    // mas é descontada do pacote como aula consumida.
    const resumo = {
      contratadas,
      realizadas_anteriores: anteriores,
      realizadas_sistema: realizadasSistema,
      realizadas,
      faltas_unidades: faltasUnidades,
      consumidas,
      futuras,
      restantes: Math.max(0, contratadas - consumidas),
      a_programar: Math.max(0, contratadas - consumidas - futuras),
      faltas: Number(m.faltas || 0),
      cancelamentos: Number(m.cancelamentos || 0),
      reposicoes: Number(m.reposicoes || 0),
      planos_total: planosQ.rowCount,
      planos_ativos: planosQ.rows.filter(p => p.ativo).length,
      total_registros: Number(m.total_registros || 0),
      primeira_aula: m.primeira_aula || null,
      ultima_aula: m.ultima_aula || null,
      ultima_realizada: m.ultima_realizada || null
    };

    res.json({ aluno, resumo, planos: planosQ.rows, aulas: aulasQ.rows, avaliacoes: avaliacoesQ.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar histórico do aluno.' });
  }
});


// ========================= V3.8 — AVALIAÇÃO DO ALUNO PARA PROVA =========================
const RESULTADOS_AVALIACAO_ALUNO = ['EM_AVALIACAO','APTO','NAO_APTO'];

app.post('/api/alunos/:id/avaliacoes', async (req, res) => {
  const client = await pool.connect();
  try {
    const alunoId = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    const resultado = String(req.body?.resultado || '').trim().toUpperCase();
    const observacoes = String(req.body?.observacoes || '').trim().slice(0, 2000);

    if (!Number.isInteger(alunoId) || alunoId < 1) return res.status(400).json({ error: 'Aluno inválido.' });
    if (!RESULTADOS_AVALIACAO_ALUNO.includes(resultado)) {
      return res.status(400).json({ error: 'Resultado da avaliação inválido.' });
    }
    if (resultado === 'NAO_APTO' && observacoes.length < 3) {
      return res.status(400).json({ error: 'Ao marcar “Ainda não apto”, informe nas observações o que o aluno precisa melhorar.' });
    }

    await client.query('BEGIN');
    const alunoQ = await client.query(`
      SELECT a.id, a.nome, a.ativo
      FROM autoagenda.alunos a
      WHERE a.id=$1
        AND a.ativo=TRUE
        AND ($2::int = 0 OR EXISTS (
          SELECT 1 FROM autoagenda.aulas rel
          WHERE rel.aluno_id=a.id AND rel.instrutor_id=$2
        ))
      FOR UPDATE
    `, [alunoId, instrutorEscopo]);
    if (!alunoQ.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno não encontrado, inativo ou fora do vínculo deste instrutor.' });
    }

    const avaliadorNome = String(req.usuario?.nome || (usuarioEhAdmin(req) ? 'Administrador' : 'Instrutor')).trim().slice(0,150) || 'Usuário';
    const avaliadorPerfil = usuarioEhAdmin(req) ? 'ADMIN' : 'INSTRUTOR';
    const instrutorId = avaliadorPerfil === 'INSTRUTOR' ? instrutorEscopo : null;

    const r = await client.query(`
      INSERT INTO autoagenda.avaliacoes_aluno
        (aluno_id, instrutor_id, avaliador_nome, avaliador_perfil, resultado, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, aluno_id, instrutor_id, avaliador_nome, avaliador_perfil, resultado, observacoes, criado_em
    `, [alunoId, instrutorId, avaliadorNome, avaliadorPerfil, resultado, observacoes || null]);

    await client.query('COMMIT');
    res.status(201).json({ ok:true, avaliacao:r.rows[0], aluno_nome:alunoQ.rows[0].nome });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erro ao registrar avaliação do aluno:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao registrar avaliação do aluno.' });
  } finally {
    client.release();
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const {
      nome, cpf, whatsapp, email, data_nascimento, categoria = 'B', aulas_contratadas = 20,
      aulas_realizadas_anteriores = 0, observacoes = ''
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const cpfLimpo = normalizarCpf(cpf);
    const dataNascimento = validarDataNascimento(data_nascimento);
    if (!cpfValido(cpfLimpo)) return res.status(400).json({ error: 'Informe um CPF válido com 11 dígitos.' });

    const existente = await query('SELECT id, nome, ativo FROM autoagenda.alunos WHERE cpf=$1 LIMIT 1', [cpfLimpo]);
    if (existente.rowCount) {
      const a = existente.rows[0];
      return res.status(409).json({
        error: a.ativo
          ? 'Este CPF já está cadastrado em outro aluno.'
          : `Este CPF pertence ao aluno inativo ${a.nome}. Use “Mostrar inativos” e reative o cadastro.`,
        aluno_inativo_id: a.ativo ? null : a.id
      });
    }

    const contratadasFinal = validarInteiroPositivo(aulas_contratadas, 20, 500);
    const anterioresFinal = validarInteiroNaoNegativo(aulas_realizadas_anteriores, 0, 500);
    if (anterioresFinal > contratadasFinal) {
      return res.status(400).json({ error: 'As aulas realizadas anteriormente não podem ser maiores que as aulas contratadas.' });
    }

    const result = await query(`
      INSERT INTO autoagenda.alunos
        (nome, cpf, whatsapp, email, data_nascimento, categoria, aulas_contratadas,
         aulas_realizadas, aulas_realizadas_anteriores, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
      RETURNING id, nome, whatsapp, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
                categoria, aulas_contratadas, aulas_realizadas, aulas_realizadas_anteriores, observacoes, ativo
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, dataNascimento, categoria,
      contratadasFinal, anterioresFinal, observacoes || ''
    ]);

    res.status(201).json({ ...result.rows[0], cpf_mascarado: cpfMascaradoServidor(cpfLimpo) });
  } catch (error) {
    console.error(error);
    if (error.code === '23505' && String(error.constraint || '').includes('alunos_cpf')) {
      return res.status(409).json({ error: 'Este CPF já está cadastrado em outro aluno.' });
    }
    res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});

app.put('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nome, cpf, whatsapp, email, data_nascimento, categoria, aulas_contratadas,
      aulas_realizadas_anteriores = 0, observacoes
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const cpfLimpo = normalizarCpf(cpf);
    const dataNascimento = validarDataNascimento(data_nascimento);
    if (!cpfValido(cpfLimpo)) return res.status(400).json({ error: 'Informe um CPF válido com 11 dígitos.' });

    const duplicado = await query('SELECT id FROM autoagenda.alunos WHERE cpf=$1 AND id<>$2 LIMIT 1', [cpfLimpo, id]);
    if (duplicado.rowCount) return res.status(409).json({ error: 'Este CPF já está cadastrado em outro aluno.' });

    const contratadasFinal = validarInteiroPositivo(aulas_contratadas, 20, 500);
    const anterioresFinal = validarInteiroNaoNegativo(aulas_realizadas_anteriores, 0, 500);
    const consumoQ = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('REALIZADA','FALTOU') AND arquivada=FALSE THEN aulas_unidades ELSE 0 END),0)::int AS aulas_consumidas_sistema,
        COALESCE(SUM(CASE WHEN data_aula >= $2::date AND status IN ('AGENDADA','CONFIRMADA') AND arquivada=FALSE THEN aulas_unidades ELSE 0 END),0)::int AS agendadas
      FROM autoagenda.aulas
      WHERE aluno_id=$1
    `, [id, hojeApp()]);
    const comprometidas = anterioresFinal + Number(consumoQ.rows[0]?.aulas_consumidas_sistema || 0) + Number(consumoQ.rows[0]?.agendadas || 0);
    if (contratadasFinal < comprometidas) {
      return res.status(409).json({ error: `O aluno já possui ${comprometidas} aula(s) realizadas/agendadas. O total contratado não pode ser reduzido para ${contratadasFinal}.` });
    }

    const result = await query(`
      UPDATE autoagenda.alunos
      SET nome = $1, cpf = $2, whatsapp = $3, email = $4, data_nascimento = $5, categoria = $6,
          aulas_contratadas = $7,
          aulas_realizadas = $8,
          aulas_realizadas_anteriores = $8,
          observacoes = $9,
          atualizado_em = NOW()
      WHERE id = $10 AND ativo = TRUE
      RETURNING id, nome, whatsapp, email, TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
                categoria, aulas_contratadas, aulas_realizadas, aulas_realizadas_anteriores, observacoes, ativo
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, dataNascimento, categoria || 'B',
      contratadasFinal, anterioresFinal, observacoes || '', id
    ]);

    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado ou inativo.' });
    res.json({ ...result.rows[0], cpf_mascarado: cpfMascaradoServidor(cpfLimpo) });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar aluno.' });
  }
});

app.patch('/api/alunos/:id/ativo', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const ativo = req.body?.ativo === true;
    await client.query('BEGIN');
    const atual = await client.query('SELECT id, ativo FROM autoagenda.alunos WHERE id=$1 FOR UPDATE', [id]);
    if (!atual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno não encontrado.' });
    }

    if (ativo) {
      const r = await client.query('UPDATE autoagenda.alunos SET ativo=TRUE, atualizado_em=NOW() WHERE id=$1 RETURNING id, nome, ativo', [id]);
      await client.query('COMMIT');
      return res.json({ ok:true, aluno:r.rows[0] });
    }

    const info = await desativarAlunoComHistorico(client, id);
    await client.query('COMMIT');
    res.json(info);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao alterar situação do aluno.' });
  } finally { client.release(); }
});

// Compatibilidade: DELETE agora significa desativar, nunca apagar o histórico.
app.delete('/api/alunos/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Aluno inválido.' });
    await client.query('BEGIN');
    const info = await desativarAlunoComHistorico(client, id);
    await client.query('COMMIT');
    res.json(info);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao desativar aluno.' });
  } finally { client.release(); }
});

// ========================= CONFIGURAÇÕES / APOIO =========================
function textoObrigatorio(v, nomeCampo, max = 150) {
  const x = String(v || '').trim();
  if (!x) {
    const err = new Error(`${nomeCampo} é obrigatório.`);
    err.statusCode = 400;
    throw err;
  }
  return x.slice(0, max);
}

function textoOpcional(v, max = 300) {
  const x = String(v || '').trim();
  return x ? x.slice(0, max) : null;
}

function erroHttp(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function incluirInativos(req) {
  return ['1', 'true', 'sim', 'todos'].includes(String(req.query?.incluir_inativos || '').toLowerCase());
}

async function validarRecursosAtivos(client, dados, permitir = {}) {
  const instrutorId = Number(dados.instrutor_id);
  const veiculoId = Number(dados.veiculo_id);
  const localId = Number(dados.local_id);

  const r = await client.query(`
    SELECT
      EXISTS(SELECT 1 FROM autoagenda.instrutores WHERE id=$1 AND ativo=TRUE) AS instrutor_ativo,
      EXISTS(SELECT 1 FROM autoagenda.veiculos WHERE id=$2 AND ativo=TRUE) AS veiculo_ativo,
      EXISTS(SELECT 1 FROM autoagenda.locais WHERE id=$3 AND ativo=TRUE) AS local_ativo
  `, [instrutorId, veiculoId, localId]);

  const x = r.rows[0] || {};
  if (!x.instrutor_ativo && Number(permitir.instrutor_id || 0) !== instrutorId) {
    throw erroHttp(400, 'O instrutor selecionado está inativo ou não existe. Escolha um instrutor ativo.');
  }
  if (!x.veiculo_ativo && Number(permitir.veiculo_id || 0) !== veiculoId) {
    throw erroHttp(400, 'O veículo selecionado está inativo ou não existe. Escolha um veículo ativo.');
  }
  if (!x.local_ativo && Number(permitir.local_id || 0) !== localId) {
    throw erroHttp(400, 'O local selecionado está inativo ou não existe. Escolha um local ativo.');
  }
}

async function recursoEmUso(client, tipo, id) {
  const mapa = {
    instrutor: { coluna: 'instrutor_id', nome: 'instrutor' },
    veiculo: { coluna: 'veiculo_id', nome: 'veículo' },
    local: { coluna: 'local_id', nome: 'local' }
  };
  const cfg = mapa[tipo];
  if (!cfg) return null;

  const planos = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM autoagenda.planos_aula
    WHERE ${cfg.coluna} = $1 AND ativo = TRUE
  `, [id]);

  const futuras = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM autoagenda.aulas
    WHERE ${cfg.coluna} = $1
      AND data_aula >= $2::date
      AND status IN ('AGENDADA','CONFIRMADA')
  `, [id, hojeApp()]);

  const p = Number(planos.rows[0]?.total || 0);
  const a = Number(futuras.rows[0]?.total || 0);
  return p || a ? { planos: p, aulas_futuras: a, nome: cfg.nome } : null;
}

async function recursoHistorico(client, tipo, id) {
  const mapa = {
    instrutor: { coluna: 'instrutor_id', nome: 'instrutor' },
    veiculo: { coluna: 'veiculo_id', nome: 'veículo' },
    local: { coluna: 'local_id', nome: 'local' }
  };
  const cfg = mapa[tipo];
  if (!cfg) return { planos_total: 0, aulas_total: 0 };

  const [planos, aulas] = await Promise.all([
    client.query(`SELECT COUNT(*)::int AS total FROM autoagenda.planos_aula WHERE ${cfg.coluna} = $1`, [id]),
    client.query(`SELECT COUNT(*)::int AS total FROM autoagenda.aulas WHERE ${cfg.coluna} = $1`, [id])
  ]);
  return {
    planos_total: Number(planos.rows[0]?.total || 0),
    aulas_total: Number(aulas.rows[0]?.total || 0)
  };
}

async function garantirInstrutorSemDuplicidade(client, dados, ignorarId = 0, somenteAtivos = false) {
  const nome = String(dados.nome || '').trim();
  const whatsapp = textoOpcional(dados.whatsapp, 30);
  const email = textoOpcional(dados.email, 180);
  const filtroAtivo = somenteAtivos ? 'AND ativo = TRUE' : '';
  const r = await client.query(`
    SELECT id, nome, ativo
    FROM autoagenda.instrutores
    WHERE id <> $4
      ${filtroAtivo}
      AND (
        ($3::text IS NOT NULL AND email IS NOT NULL AND LOWER(BTRIM(email)) = LOWER(BTRIM($3)))
        OR (
          $2::text IS NOT NULL
          AND LENGTH(REGEXP_REPLACE($2, '[^0-9]', '', 'g')) >= 8
          AND REGEXP_REPLACE(COALESCE(whatsapp,''), '[^0-9]', '', 'g') = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
        )
        OR (
          $2::text IS NULL
          AND $3::text IS NULL
          AND LOWER(BTRIM(nome)) = LOWER(BTRIM($1))
        )
      )
    LIMIT 1
  `, [nome, whatsapp, email, Number(ignorarId || 0)]);
  if (r.rowCount) {
    const outro = r.rows[0];
    const detalhe = outro.ativo ? '' : ' Esse cadastro está inativo; use "Mostrar inativos" para reativá-lo.';
    throw erroHttp(409, `Já existe um instrutor com os mesmos dados.${detalhe}`);
  }
}

async function garantirVeiculoSemDuplicidade(client, dados, ignorarId = 0, somenteAtivos = false) {
  const nome = String(dados.nome || '').trim();
  const placa = textoOpcional(dados.placa, 15)?.toUpperCase() || null;
  const categoria = String(dados.categoria || 'B').trim().toUpperCase().slice(0, 10) || 'B';
  const filtroAtivo = somenteAtivos ? 'AND ativo = TRUE' : '';
  const r = await client.query(`
    SELECT id, nome, ativo
    FROM autoagenda.veiculos
    WHERE id <> $4
      ${filtroAtivo}
      AND (
        (
          $2::text IS NOT NULL
          AND REGEXP_REPLACE(UPPER(COALESCE(placa,'')), '[^A-Z0-9]', '', 'g')
              = REGEXP_REPLACE(UPPER($2), '[^A-Z0-9]', '', 'g')
        )
        OR (
          $2::text IS NULL
          AND placa IS NULL
          AND LOWER(BTRIM(nome)) = LOWER(BTRIM($1))
          AND UPPER(BTRIM(COALESCE(categoria,''))) = UPPER(BTRIM($3))
        )
      )
    LIMIT 1
  `, [nome, placa, categoria, Number(ignorarId || 0)]);
  if (r.rowCount) {
    const outro = r.rows[0];
    const detalhe = outro.ativo ? '' : ' Esse cadastro está inativo; use "Mostrar inativos" para reativá-lo.';
    throw erroHttp(409, `Já existe um veículo com os mesmos dados.${detalhe}`);
  }
}

async function garantirLocalSemDuplicidade(client, dados, ignorarId = 0, somenteAtivos = false) {
  const nome = String(dados.nome || '').trim();
  const endereco = textoOpcional(dados.endereco, 300);
  const filtroAtivo = somenteAtivos ? 'AND ativo = TRUE' : '';
  const r = await client.query(`
    SELECT id, nome, ativo
    FROM autoagenda.locais
    WHERE id <> $3
      ${filtroAtivo}
      AND LOWER(BTRIM(nome)) = LOWER(BTRIM($1))
      AND (
        ($2::text IS NULL AND (endereco IS NULL OR BTRIM(endereco) = ''))
        OR ($2::text IS NOT NULL AND LOWER(BTRIM(COALESCE(endereco,''))) = LOWER(BTRIM($2)))
      )
    LIMIT 1
  `, [nome, endereco, Number(ignorarId || 0)]);
  if (r.rowCount) {
    const outro = r.rows[0];
    const detalhe = outro.ativo ? '' : ' Esse cadastro está inativo; use "Mostrar inativos" para reativá-lo.';
    throw erroHttp(409, `Já existe um local com os mesmos dados.${detalhe}`);
  }
}

async function desativarRecurso(client, tipo, tabela, id) {
  const atual = await client.query(`SELECT * FROM autoagenda.${tabela} WHERE id = $1`, [id]);
  if (!atual.rowCount) throw erroHttp(404, 'Cadastro não encontrado.');
  if (!atual.rows[0].ativo) return atual.rows[0];

  const uso = await recursoEmUso(client, tipo, id);
  if (uso) {
    throw erroHttp(
      409,
      `Não é possível desativar este ${uso.nome}: existem ${uso.planos} plano(s) ativo(s) e ${uso.aulas_futuras} aula(s) futura(s) vinculada(s). Realoque ou encerre esses agendamentos primeiro.`
    );
  }

  const r = await client.query(
    `UPDATE autoagenda.${tabela} SET ativo = FALSE, atualizado_em = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return r.rows[0];
}

async function excluirRecursoPermanente(client, tipo, tabela, id) {
  const atual = await client.query(`SELECT * FROM autoagenda.${tabela} WHERE id = $1`, [id]);
  if (!atual.rowCount) throw erroHttp(404, 'Cadastro não encontrado.');
  if (atual.rows[0].ativo) {
    throw erroHttp(409, 'Desative o cadastro antes de excluí-lo definitivamente.');
  }
  const historico = await recursoHistorico(client, tipo, id);
  if (historico.planos_total || historico.aulas_total) {
    throw erroHttp(
      409,
      `Este cadastro possui histórico (${historico.planos_total} plano(s) e ${historico.aulas_total} aula(s)) e não pode ser excluído definitivamente. Mantenha-o inativo para preservar os dados.`
    );
  }
  await client.query(`DELETE FROM autoagenda.${tabela} WHERE id = $1`, [id]);
  return historico;
}

// ---------- Horário de funcionamento ----------
app.get('/api/configuracoes/funcionamento', async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await obterConfigFuncionamento(client));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar horário de funcionamento.' });
  } finally {
    client.release();
  }
});

app.put('/api/configuracoes/funcionamento', async (req, res) => {
  const client = await pool.connect();
  try {
    const cfg = normalizarConfiguracaoFuncionamento(req.body || {});
    await client.query('BEGIN');
    const r = await client.query(`
      INSERT INTO autoagenda.configuracoes
        (id, dias_funcionamento, hora_abertura, hora_encerramento, duracao_padrao_minutos, intervalo_minutos, atualizado_em)
      VALUES (1, $1::int[], $2::time, $3::time, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE
      SET dias_funcionamento = EXCLUDED.dias_funcionamento,
          hora_abertura = EXCLUDED.hora_abertura,
          hora_encerramento = EXCLUDED.hora_encerramento,
          duracao_padrao_minutos = EXCLUDED.duracao_padrao_minutos,
          intervalo_minutos = EXCLUDED.intervalo_minutos,
          atualizado_em = NOW()
      RETURNING id, dias_funcionamento,
                TO_CHAR(hora_abertura, 'HH24:MI') AS hora_abertura,
                TO_CHAR(hora_encerramento, 'HH24:MI') AS hora_encerramento,
                duracao_padrao_minutos, intervalo_minutos, atualizado_em
    `, [
      cfg.dias_funcionamento, cfg.hora_abertura, cfg.hora_encerramento,
      cfg.duracao_padrao_minutos, cfg.intervalo_minutos
    ]);

    // Compatibilidade: aulas existentes nunca são apagadas ou remarcadas ao mudar o funcionamento.
    // Apenas informamos quantas futuras já existentes ficaram fora da nova regra.
    const futuras = await client.query(`
      SELECT data_aula, hora_inicio, duracao_minutos
      FROM autoagenda.aulas
      WHERE data_aula >= $1::date
        AND status IN ('AGENDADA','CONFIRMADA')
    `, [hojeApp()]);
    const configSalva = {
      ...r.rows[0],
      dias_funcionamento: r.rows[0].dias_funcionamento.map(Number),
      duracao_padrao_minutos: Number(r.rows[0].duracao_padrao_minutos),
      intervalo_minutos: Number(r.rows[0].intervalo_minutos)
    };
    const fora = futuras.rows.filter(a => !avaliarHorarioFuncionamento(configSalva, a).ok).length;

    await client.query('COMMIT');
    res.json({ ...configSalva, aulas_futuras_fora_do_horario: fora });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Erro ao salvar horário de funcionamento.'
    });
  } finally {
    client.release();
  }
});


// ---------- V2.5 — Lembretes ----------
app.get('/api/configuracoes/lembretes', async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await obterConfigLembretes(client));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar configuração de lembretes.' });
  } finally { client.release(); }
});

app.put('/api/configuracoes/lembretes', async (req, res) => {
  const client = await pool.connect();
  try {
    const cfg = normalizarConfiguracaoLembretes(req.body || {});
    const apiStatus = resumoConfiguracaoWhatsAppCloud();
    // O ADMIN pode deixar a automação ligada antes de configurar a Meta.
    // Nesse estado os itens ficam pendentes e o worker começa a enviar sozinho
    // assim que as variáveis do Render e os templates aprovados estiverem disponíveis.
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE autoagenda.configuracoes
      SET lembrete_dia_anterior_ativo=$1,
          lembrete_dia_anterior_hora=$2::time,
          lembrete_horas_antes_ativo=$3,
          lembrete_horas_antes=$4,
          whatsapp_automatico_ativo=$5,
          atualizado_em=NOW()
      WHERE id=1
      RETURNING lembrete_dia_anterior_ativo,
                TO_CHAR(lembrete_dia_anterior_hora,'HH24:MI') AS lembrete_dia_anterior_hora,
                lembrete_horas_antes_ativo, lembrete_horas_antes,
                whatsapp_automatico_ativo
    `,[cfg.lembrete_dia_anterior_ativo,cfg.lembrete_dia_anterior_hora,cfg.lembrete_horas_antes_ativo,cfg.lembrete_horas_antes,cfg.whatsapp_automatico_ativo]);
    await sincronizarAgendamentoLembretes(client);
    await sincronizarFilaLembretes(client);
    await client.query('COMMIT');
    res.json({ ...(r.rows[0] || cfg), ...apiStatus });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao salvar lembretes.' });
  } finally { client.release(); }
});

// ---------- V3.4 — Configuração de e-mail ----------
app.get('/api/configuracoes/email', async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await obterConfigEmail(client));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar configuração de e-mail.' });
  } finally { client.release(); }
});

app.put('/api/configuracoes/email', async (req, res) => {
  const client = await pool.connect();
  try {
    const ativo = req.body?.email_automatico_ativo === true;
    const apiStatus = resumoConfiguracaoEmail();
    // Pode permanecer ativo mesmo antes de configurar o provedor. Os envios ficam
    // pendentes e começam automaticamente assim que as variáveis do Render existirem.
    const r = await client.query(`
      UPDATE autoagenda.configuracoes
      SET email_automatico_ativo=$1, atualizado_em=NOW()
      WHERE id=1
      RETURNING email_automatico_ativo
    `, [ativo]);
    res.json({ ...(r.rows[0] || {email_automatico_ativo:ativo}), ...apiStatus });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao salvar configuração de e-mail.' });
  } finally { client.release(); }
});

app.get('/api/lembretes', async (req, res) => {
  const client = await pool.connect();
  try {
    await sincronizarAgendamentoLembretes(client);
    await sincronizarFilaLembretes(client);
    const agora = agoraApp();
    const agoraTexto = `${agora.data}T${agora.hora}`;
    const r = await client.query(`
      WITH itens AS (
        SELECT a.id AS aula_id, 'DIA_ANTERIOR'::text AS tipo,
               TO_CHAR(a.lembrete_dia_anterior_em,'YYYY-MM-DD\"T\"HH24:MI') AS lembrete_em,
               a.lembrete_dia_anterior_enviado AS enviado,
               TO_CHAR(a.lembrete_dia_anterior_enviado_em,'YYYY-MM-DD\"T\"HH24:MI') AS enviado_em,
               TO_CHAR(a.data_aula,'YYYY-MM-DD') AS data_aula,
               TO_CHAR(a.hora_inicio,'HH24:MI') AS hora_inicio,
               a.status, a.confirmacao_status,
               al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp,
               i.nome AS instrutor_nome, v.nome AS veiculo_nome, l.nome AS local_nome
        FROM autoagenda.aulas a
        JOIN autoagenda.alunos al ON al.id=a.aluno_id
        JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
        JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
        JOIN autoagenda.locais l ON l.id=a.local_id
        WHERE a.lembrete_dia_anterior_em IS NOT NULL
          AND a.lembrete_dia_anterior_enviado=FALSE
          AND a.data_aula >= $1::date
          AND a.arquivada=FALSE
          AND a.status IN ('AGENDADA','CONFIRMADA')
        UNION ALL
        SELECT a.id, 'HORAS_ANTES'::text,
               TO_CHAR(a.lembrete_horas_antes_em,'YYYY-MM-DD\"T\"HH24:MI'),
               a.lembrete_horas_antes_enviado,
               TO_CHAR(a.lembrete_horas_antes_enviado_em,'YYYY-MM-DD\"T\"HH24:MI'),
               TO_CHAR(a.data_aula,'YYYY-MM-DD'),
               TO_CHAR(a.hora_inicio,'HH24:MI'),
               a.status, a.confirmacao_status,
               al.nome, al.whatsapp, i.nome, v.nome, l.nome
        FROM autoagenda.aulas a
        JOIN autoagenda.alunos al ON al.id=a.aluno_id
        JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
        JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
        JOIN autoagenda.locais l ON l.id=a.local_id
        WHERE a.lembrete_horas_antes_em IS NOT NULL
          AND a.lembrete_horas_antes_enviado=FALSE
          AND a.data_aula >= $1::date
          AND a.arquivada=FALSE
          AND a.status IN ('AGENDADA','CONFIRMADA')
      )
      SELECT itens.*,
             le.id AS envio_id,
             COALESCE(le.status,'PENDENTE') AS envio_status,
             COALESCE(le.tentativas,0)::int AS envio_tentativas,
             TO_CHAR(le.ultima_tentativa_em,'YYYY-MM-DD"T"HH24:MI') AS envio_ultima_tentativa_em,
             TO_CHAR(le.enviado_em,'YYYY-MM-DD"T"HH24:MI') AS envio_api_em,
             le.provider_message_id,
             le.erro AS envio_erro
      FROM itens
      LEFT JOIN autoagenda.lembrete_envios le
        ON le.aula_id=itens.aula_id AND le.tipo=itens.tipo AND le.canal='WHATSAPP'
      ORDER BY lembrete_em, aula_id, tipo LIMIT 200
    `,[hojeApp()]);
    const itens = r.rows.map(x => ({...x, atrasado: String(x.lembrete_em) < agoraTexto}));
    const limite = new Date(`${agora.data}T${agora.hora}:00`);
    limite.setDate(limite.getDate()+7);
    const limite7 = `${limite.getFullYear()}-${String(limite.getMonth()+1).padStart(2,'0')}-${String(limite.getDate()).padStart(2,'0')}T${String(limite.getHours()).padStart(2,'0')}:${String(limite.getMinutes()).padStart(2,'0')}`;
    res.json({
      agora: agoraTexto,
      itens,
      resumo: {
        pendentes: itens.length,
        atrasados: itens.filter(x => x.atrasado).length,
        falhas: itens.filter(x => String(x.envio_status || '').toUpperCase() === 'FALHOU').length,
        proximos_7_dias: itens.filter(x => String(x.lembrete_em) >= agoraTexto && String(x.lembrete_em) <= limite7).length,
        whatsapp_automatico_ativo: (await obterConfigLembretes(client)).whatsapp_automatico_ativo,
        whatsapp_api_configurada: resumoConfiguracaoWhatsAppCloud().whatsapp_api_configurada
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error:'Erro ao consultar lembretes.' });
  } finally { client.release(); }
});

app.post('/api/lembretes/processar-agora', async (req, res) => {
  try {
    const cfg = await obterConfigLembretes(pool);
    if (!cfg.whatsapp_automatico_ativo) {
      return res.status(409).json({ error: 'O envio automático pelo WhatsApp está desativado nas configurações.' });
    }
    const lembretes = await processarLembretesAutomaticos({ origem: 'ADMIN', limite: 20 });
    const comunicacoes = await processarWhatsAppComunicacoesAutomaticas({ origem:'ADMIN', limite:30 });
    res.json({
      lembretes, comunicacoes,
      enviados:Number(lembretes.enviados||0)+Number(comunicacoes.enviados||0),
      falhas:Number(lembretes.falhas||0)+Number(comunicacoes.falhas||0),
      cancelados:Number(lembretes.cancelados||0)+Number(comunicacoes.cancelados||0)
    });
  } catch (error) {
    console.error('Erro ao processar WhatsApp manualmente:', error);
    res.status(500).json({ error: 'Erro ao executar a automação do WhatsApp.' });
  }
});

app.post('/api/email/processar-agora', async (req, res) => {
  try {
    const cfg = await obterConfigEmail(pool);
    if (!cfg.email_automatico_ativo) {
      return res.status(409).json({ error:'O envio automático de e-mail está desativado nas configurações.' });
    }
    const resultado = await processarEmailsAutomaticos({ origem:'ADMIN', limite:30 });
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao processar e-mails manualmente:', error);
    res.status(500).json({ error:'Erro ao executar a automação de e-mail.' });
  }
});

app.patch('/api/aulas/:id/lembretes/:tipo', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const tipo = String(req.params.tipo || '').toUpperCase();
    const enviado = req.body?.enviado !== false;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error:'Aula inválida.' });
    if (!['DIA_ANTERIOR','HORAS_ANTES'].includes(tipo)) return res.status(400).json({ error:'Tipo de lembrete inválido.' });
    const coluna = tipo === 'DIA_ANTERIOR' ? 'lembrete_dia_anterior' : 'lembrete_horas_antes';
    const r = await client.query(`
      UPDATE autoagenda.aulas
      SET ${coluna}_enviado=$1,
          ${coluna}_enviado_em=CASE WHEN $1 THEN NOW() ELSE NULL END,
          atualizado_em=NOW()
      WHERE id=$2
      RETURNING id, ${coluna}_enviado AS enviado, ${coluna}_enviado_em AS enviado_em
    `,[enviado,id]);
    if (!r.rowCount) return res.status(404).json({ error:'Aula não encontrada.' });
    const agendamento = await client.query(`
      SELECT id,
             CASE WHEN $1='DIA_ANTERIOR' THEN lembrete_dia_anterior_em ELSE lembrete_horas_antes_em END AS agendado_em
      FROM autoagenda.aulas WHERE id=$2
    `, [tipo,id]);
    if (agendamento.rows[0]?.agendado_em) {
      await client.query(`
        INSERT INTO autoagenda.lembrete_envios
          (aula_id,tipo,canal,agendado_em,status,automatico,enviado_em,erro,atualizado_em)
        VALUES ($1,$2,'WHATSAPP',$3,$4,$5,CASE WHEN $6 THEN NOW() ELSE NULL END,NULL,NOW())
        ON CONFLICT (aula_id,tipo,canal) DO UPDATE
        SET agendado_em=EXCLUDED.agendado_em,
            status=EXCLUDED.status,
            automatico=EXCLUDED.automatico,
            enviado_em=EXCLUDED.enviado_em,
            processando_em=NULL,
            provider_message_id=CASE WHEN $6 THEN lembrete_envios.provider_message_id ELSE NULL END,
            erro=NULL,
            atualizado_em=NOW()
      `,[id,tipo,agendamento.rows[0].agendado_em,enviado?'ENVIADO':'PENDENTE',!enviado,enviado]);
    }
    res.json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error:'Erro ao atualizar lembrete.' });
  } finally { client.release(); }
});

// ---------- Instrutores ----------
app.get('/api/instrutores', async (req, res) => {
  try {
    const instrutorEscopo = instrutorIdDaSessao(req);
    const mostrarTodos = usuarioEhAdmin(req) ? incluirInativos(req) : false;
    const result = await query(`
      SELECT i.id, i.nome, i.whatsapp, i.email, i.categorias, i.ativo,
             i.disponibilidade_personalizada,
             i.dias_trabalho,
             TO_CHAR(i.hora_inicio, 'HH24:MI') AS hora_inicio,
             TO_CHAR(i.hora_fim, 'HH24:MI') AS hora_fim,
             TO_CHAR(i.intervalo_inicio, 'HH24:MI') AS intervalo_inicio,
             TO_CHAR(i.intervalo_fim, 'HH24:MI') AS intervalo_fim,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.instrutor_id=i.id AND p.ativo=TRUE),0)::int AS planos_ativos,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.instrutor_id=i.id AND a.data_aula >= $1::date AND a.status IN ('AGENDADA','CONFIRMADA')),0)::int AS aulas_futuras,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.instrutor_id=i.id),0)::int AS planos_total,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.instrutor_id=i.id),0)::int AS aulas_total,
             COALESCE((
               SELECT COUNT(*)
               FROM autoagenda.instrutor_indisponibilidades d
               WHERE d.instrutor_id=i.id AND d.data_fim >= $1::date
             ),0)::int AS indisponibilidades_futuras
      FROM autoagenda.instrutores i
      WHERE ($2::boolean = TRUE OR i.ativo = TRUE)
        AND ($3::int = 0 OR i.id = $3)
      ORDER BY i.ativo DESC, i.nome
    `, [hojeApp(), mostrarTodos, instrutorEscopo]);
    res.json(result.rows.map(normalizarInstrutorDisponibilidadeRow));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar instrutores.' });
  }
});

app.post('/api/instrutores', async (req, res) => {
  const client = await pool.connect();
  try {
    const nome = textoObrigatorio(req.body?.nome, 'Nome');
    const whatsapp = textoOpcional(req.body?.whatsapp, 30);
    const email = textoOpcional(req.body?.email, 180);
    const categorias = String(req.body?.categorias || 'AB').trim().toUpperCase().slice(0, 20) || 'AB';
    const configFuncionamento = await obterConfigFuncionamento(client);
    const disp = normalizarDisponibilidadeInstrutor(req.body || {}, configFuncionamento);
    await garantirInstrutorSemDuplicidade(client, { nome, whatsapp, email });
    const r = await client.query(`
      INSERT INTO autoagenda.instrutores
        (nome, whatsapp, email, categorias, disponibilidade_personalizada,
         dias_trabalho, hora_inicio, hora_fim, intervalo_inicio, intervalo_fim)
      VALUES ($1,$2,$3,$4,$5,$6::int[],$7::time,$8::time,$9::time,$10::time)
      RETURNING *
    `, [
      nome, whatsapp, email, categorias, disp.disponibilidade_personalizada,
      disp.dias_trabalho, disp.hora_inicio, disp.hora_fim, disp.intervalo_inicio, disp.intervalo_fim
    ]);
    res.status(201).json(normalizarInstrutorDisponibilidadeRow(r.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar instrutor.' });
  } finally { client.release(); }
});

app.put('/api/instrutores/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const nome = textoObrigatorio(req.body?.nome, 'Nome');
    const whatsapp = textoOpcional(req.body?.whatsapp, 30);
    const email = textoOpcional(req.body?.email, 180);
    const categorias = String(req.body?.categorias || 'AB').trim().toUpperCase().slice(0, 20) || 'AB';
    const configFuncionamento = await obterConfigFuncionamento(client);
    const disp = normalizarDisponibilidadeInstrutor(req.body || {}, configFuncionamento);
    await garantirInstrutorSemDuplicidade(client, { nome, whatsapp, email }, id);
    const r = await client.query(`
      UPDATE autoagenda.instrutores
      SET nome=$1, whatsapp=$2, email=$3, categorias=$4,
          disponibilidade_personalizada=$5,
          dias_trabalho=$6::int[], hora_inicio=$7::time, hora_fim=$8::time,
          intervalo_inicio=$9::time, intervalo_fim=$10::time,
          atualizado_em=NOW()
      WHERE id=$11
      RETURNING *
    `, [
      nome, whatsapp, email, categorias, disp.disponibilidade_personalizada,
      disp.dias_trabalho, disp.hora_inicio, disp.hora_fim, disp.intervalo_inicio, disp.intervalo_fim, id
    ]);
    if (!r.rowCount) return res.status(404).json({ error: 'Instrutor não encontrado.' });

    const instrutor = normalizarInstrutorDisponibilidadeRow(r.rows[0]);
    const fora = await contarAulasFuturasForaDisponibilidade(client, id, instrutor, configFuncionamento);
    res.json({ ...instrutor, aulas_futuras_fora_disponibilidade: fora });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar instrutor.' });
  } finally { client.release(); }
});

// Folgas e dias específicos indisponíveis do instrutor.
app.get('/api/instrutores/:id/indisponibilidades', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.de || '')) ? String(req.query.de) : hojeApp();
    const r = await query(`
      SELECT id, instrutor_id, data_inicio, data_fim, motivo, criado_em
      FROM autoagenda.instrutor_indisponibilidades
      WHERE instrutor_id = $1
        AND data_fim >= $2::date
      ORDER BY data_inicio, data_fim, id
    `, [id, de]);
    res.json(r.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar indisponibilidades do instrutor.' });
  }
});

app.post('/api/instrutores/:id/indisponibilidades', async (req, res) => {
  const client = await pool.connect();
  try {
    const instrutorId = Number(req.params.id);
    const dataInicio = String(req.body?.data_inicio || '').slice(0,10);
    const dataFim = String(req.body?.data_fim || req.body?.data_inicio || '').slice(0,10);
    const motivo = textoOpcional(req.body?.motivo, 250);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      throw erroHttp(400, 'Informe uma data válida para a indisponibilidade.');
    }
    if (dataFim < dataInicio) throw erroHttp(400, 'A data final não pode ser anterior à data inicial.');

    const instrutorQ = await client.query('SELECT id FROM autoagenda.instrutores WHERE id=$1', [instrutorId]);
    if (!instrutorQ.rowCount) return res.status(404).json({ error: 'Instrutor não encontrado.' });

    const sobreposta = await client.query(`
      SELECT id
      FROM autoagenda.instrutor_indisponibilidades
      WHERE instrutor_id=$1
        AND data_inicio <= $3::date
        AND data_fim >= $2::date
      LIMIT 1
    `, [instrutorId, dataInicio, dataFim]);
    if (sobreposta.rowCount) throw erroHttp(409, 'Já existe uma folga/indisponibilidade cadastrada nesse período.');

    const r = await client.query(`
      INSERT INTO autoagenda.instrutor_indisponibilidades
        (instrutor_id, data_inicio, data_fim, motivo)
      VALUES ($1,$2,$3,$4)
      RETURNING *
    `, [instrutorId, dataInicio, dataFim, motivo]);

    const afetadas = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM autoagenda.aulas
      WHERE instrutor_id=$1
        AND data_aula BETWEEN $2::date AND $3::date
        AND data_aula >= $4::date
        AND status IN ('AGENDADA','CONFIRMADA')
    `, [instrutorId, dataInicio, dataFim, hojeApp()]);

    res.status(201).json({
      ...r.rows[0],
      aulas_futuras_no_periodo: Number(afetadas.rows[0]?.total || 0)
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar indisponibilidade.' });
  } finally { client.release(); }
});

app.delete('/api/instrutores/:id/indisponibilidades/:indispId', async (req, res) => {
  try {
    const r = await query(`
      DELETE FROM autoagenda.instrutor_indisponibilidades
      WHERE id=$1 AND instrutor_id=$2
      RETURNING id
    `, [Number(req.params.indispId), Number(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Indisponibilidade não encontrada.' });
    res.json({ ok:true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir indisponibilidade.' });
  }
});

app.patch('/api/instrutores/:id/ativo', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const ativo = req.body?.ativo === true;
    const atualQ = await client.query('SELECT * FROM autoagenda.instrutores WHERE id=$1', [id]);
    if (!atualQ.rowCount) return res.status(404).json({ error: 'Instrutor não encontrado.' });
    const atual = atualQ.rows[0];

    if (ativo) {
      await garantirInstrutorSemDuplicidade(client, atual, id, true);
      const r = await client.query('UPDATE autoagenda.instrutores SET ativo=TRUE, atualizado_em=NOW() WHERE id=$1 RETURNING *', [id]);
      return res.json(r.rows[0]);
    }

    const atualizado = await desativarRecurso(client, 'instrutor', 'instrutores', id);
    res.json(atualizado);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao alterar situação do instrutor.' });
  } finally { client.release(); }
});

// Compatibilidade com a V1.5: DELETE continua significando desativar.
app.delete('/api/instrutores/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await desativarRecurso(client, 'instrutor', 'instrutores', id);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao desativar instrutor.' });
  } finally { client.release(); }
});

app.delete('/api/instrutores/:id/permanente', async (req, res) => {
  const client = await pool.connect();
  try {
    await excluirRecursoPermanente(client, 'instrutor', 'instrutores', Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao excluir instrutor.' });
  } finally { client.release(); }
});

// ---------- Veículos ----------
app.get('/api/veiculos', async (req, res) => {
  try {
    const mostrarTodos = usuarioEhAdmin(req) ? incluirInativos(req) : false;
    const result = await query(`
      SELECT v.id, v.nome, v.placa, v.categoria, v.ativo,
             UPPER(COALESCE(v.situacao,'DISPONIVEL')) AS situacao,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.veiculo_id=v.id AND p.ativo=TRUE),0)::int AS planos_ativos,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.veiculo_id=v.id AND a.data_aula >= $1::date AND a.status IN ('AGENDADA','CONFIRMADA')),0)::int AS aulas_futuras,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.veiculo_id=v.id),0)::int AS planos_total,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.veiculo_id=v.id),0)::int AS aulas_total,
             COALESCE((SELECT COUNT(*) FROM autoagenda.veiculo_indisponibilidades d WHERE d.veiculo_id=v.id AND d.data_fim >= $1::date),0)::int AS indisponibilidades_futuras
      FROM autoagenda.veiculos v
      WHERE ($2::boolean = TRUE OR (v.ativo=TRUE AND UPPER(COALESCE(v.situacao,'DISPONIVEL'))='DISPONIVEL'))
      ORDER BY v.ativo DESC,
               CASE UPPER(COALESCE(v.situacao,'DISPONIVEL')) WHEN 'DISPONIVEL' THEN 1 WHEN 'MANUTENCAO' THEN 2 WHEN 'INDISPONIVEL' THEN 3 ELSE 4 END,
               v.nome
    `, [hojeApp(), mostrarTodos]);
    res.json(result.rows.map(v => ({ ...v, situacao: v.ativo === false ? 'INATIVO' : normalizarSituacaoVeiculo(v.situacao) })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar veículos.' });
  }
});

app.post('/api/veiculos', async (req, res) => {
  const client = await pool.connect();
  try {
    const nome = textoObrigatorio(req.body?.nome, 'Nome do veículo', 100);
    const placa = textoOpcional(req.body?.placa, 15)?.toUpperCase() || null;
    const categoria = String(req.body?.categoria || 'B').trim().toUpperCase().slice(0, 10) || 'B';
    const situacao = normalizarSituacaoVeiculo(req.body?.situacao);
    const ativo = situacao !== 'INATIVO';
    await garantirVeiculoSemDuplicidade(client, { nome, placa, categoria });
    const r = await client.query(
      `INSERT INTO autoagenda.veiculos (nome, placa, categoria, situacao, ativo) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nome, placa, categoria, situacao, ativo]
    );
    res.status(201).json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar veículo.' });
  } finally { client.release(); }
});

app.put('/api/veiculos/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const nome = textoObrigatorio(req.body?.nome, 'Nome do veículo', 100);
    const placa = textoOpcional(req.body?.placa, 15)?.toUpperCase() || null;
    const categoria = String(req.body?.categoria || 'B').trim().toUpperCase().slice(0, 10) || 'B';
    const situacao = normalizarSituacaoVeiculo(req.body?.situacao);
    await garantirVeiculoSemDuplicidade(client, { nome, placa, categoria }, id);

    const atualQ = await client.query('SELECT * FROM autoagenda.veiculos WHERE id=$1', [id]);
    if (!atualQ.rowCount) return res.status(404).json({ error: 'Veículo não encontrado.' });

    if (situacao === 'INATIVO' && atualQ.rows[0].ativo !== false) {
      await desativarRecurso(client, 'veiculo', 'veiculos', id);
    }

    const ativo = situacao !== 'INATIVO';
    const r = await client.query(`
      UPDATE autoagenda.veiculos
      SET nome=$1, placa=$2, categoria=$3, situacao=$4, ativo=$5, atualizado_em=NOW()
      WHERE id=$6 RETURNING *
    `, [nome, placa, categoria, situacao, ativo, id]);

    const afetadas = situacao === 'DISPONIVEL' ? 0 : Number((await client.query(`
      SELECT COUNT(*)::int AS total
      FROM autoagenda.aulas
      WHERE veiculo_id=$1 AND data_aula >= $2::date AND status IN ('AGENDADA','CONFIRMADA')
    `, [id, hojeApp()])).rows[0]?.total || 0);

    res.json({ ...r.rows[0], aulas_futuras_afetadas: afetadas });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar veículo.' });
  } finally { client.release(); }
});

app.get('/api/veiculos/:id/indisponibilidades', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.de || '')) ? String(req.query.de) : hojeApp();
    const r = await query(`
      SELECT id, veiculo_id, data_inicio, data_fim, tipo, motivo, criado_em
      FROM autoagenda.veiculo_indisponibilidades
      WHERE veiculo_id=$1 AND data_fim >= $2::date
      ORDER BY data_inicio, data_fim, id
    `, [id, de]);
    res.json(r.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar indisponibilidades do veículo.' });
  }
});

app.post('/api/veiculos/:id/indisponibilidades', async (req, res) => {
  const client = await pool.connect();
  try {
    const veiculoId = Number(req.params.id);
    const dataInicio = String(req.body?.data_inicio || '').slice(0,10);
    const dataFim = String(req.body?.data_fim || dataInicio).slice(0,10);
    const tipo = normalizarTipoIndisponibilidadeVeiculo(req.body?.tipo);
    const motivo = textoOpcional(req.body?.motivo, 250);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      throw erroHttp(400, 'Informe uma data válida para a indisponibilidade do veículo.');
    }
    if (dataFim < dataInicio) throw erroHttp(400, 'A data final não pode ser anterior à data inicial.');

    const veiculoQ = await client.query('SELECT id FROM autoagenda.veiculos WHERE id=$1', [veiculoId]);
    if (!veiculoQ.rowCount) return res.status(404).json({ error: 'Veículo não encontrado.' });

    const sobreposta = await client.query(`
      SELECT id FROM autoagenda.veiculo_indisponibilidades
      WHERE veiculo_id=$1 AND data_inicio <= $3::date AND data_fim >= $2::date
      LIMIT 1
    `, [veiculoId, dataInicio, dataFim]);
    if (sobreposta.rowCount) throw erroHttp(409, 'Já existe manutenção/indisponibilidade cadastrada nesse período.');

    const r = await client.query(`
      INSERT INTO autoagenda.veiculo_indisponibilidades (veiculo_id, data_inicio, data_fim, tipo, motivo)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [veiculoId, dataInicio, dataFim, tipo, motivo]);

    const afetadas = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM autoagenda.aulas
      WHERE veiculo_id=$1
        AND data_aula BETWEEN $2::date AND $3::date
        AND data_aula >= $4::date
        AND status IN ('AGENDADA','CONFIRMADA')
    `, [veiculoId, dataInicio, dataFim, hojeApp()]);

    res.status(201).json({ ...r.rows[0], aulas_futuras_no_periodo: Number(afetadas.rows[0]?.total || 0) });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar indisponibilidade do veículo.' });
  } finally { client.release(); }
});

app.delete('/api/veiculos/:id/indisponibilidades/:indispId', async (req, res) => {
  try {
    const r = await query(`
      DELETE FROM autoagenda.veiculo_indisponibilidades
      WHERE id=$1 AND veiculo_id=$2 RETURNING id
    `, [Number(req.params.indispId), Number(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Indisponibilidade não encontrada.' });
    res.json({ ok:true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir indisponibilidade do veículo.' });
  }
});

app.patch('/api/veiculos/:id/ativo', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const ativo = req.body?.ativo === true;
    const atualQ = await client.query('SELECT * FROM autoagenda.veiculos WHERE id=$1', [id]);
    if (!atualQ.rowCount) return res.status(404).json({ error: 'Veículo não encontrado.' });
    const atual = atualQ.rows[0];

    if (ativo) {
      await garantirVeiculoSemDuplicidade(client, atual, id, true);
      const r = await client.query(`
        UPDATE autoagenda.veiculos SET ativo=TRUE, situacao='DISPONIVEL', atualizado_em=NOW()
        WHERE id=$1 RETURNING *
      `, [id]);
      return res.json(r.rows[0]);
    }

    const atualizado = await desativarRecurso(client, 'veiculo', 'veiculos', id);
    const r = await client.query(`
      UPDATE autoagenda.veiculos SET situacao='INATIVO', atualizado_em=NOW()
      WHERE id=$1 RETURNING *
    `, [id]);
    res.json(r.rows[0] || atualizado);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao alterar situação do veículo.' });
  } finally { client.release(); }
});

app.delete('/api/veiculos/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await desativarRecurso(client, 'veiculo', 'veiculos', id);
    await client.query(`UPDATE autoagenda.veiculos SET situacao='INATIVO', atualizado_em=NOW() WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao desativar veículo.' });
  } finally { client.release(); }
});

app.delete('/api/veiculos/:id/permanente', async (req, res) => {
  const client = await pool.connect();
  try {
    await excluirRecursoPermanente(client, 'veiculo', 'veiculos', Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao excluir veículo.' });
  } finally { client.release(); }
});

// ---------- Locais ----------
app.get('/api/locais', async (req, res) => {
  try {
    const mostrarTodos = usuarioEhAdmin(req) ? incluirInativos(req) : false;
    const result = await query(`
      SELECT l.id, l.nome, l.endereco, l.ativo,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.local_id=l.id AND p.ativo=TRUE),0)::int AS planos_ativos,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.local_id=l.id AND a.data_aula >= $1::date AND a.status IN ('AGENDADA','CONFIRMADA')),0)::int AS aulas_futuras,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.local_id=l.id),0)::int AS planos_total,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.local_id=l.id),0)::int AS aulas_total
      FROM autoagenda.locais l
      WHERE ($2::boolean = TRUE OR l.ativo = TRUE)
      ORDER BY l.ativo DESC, l.nome
    `, [hojeApp(), mostrarTodos]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar locais.' });
  }
});

app.post('/api/locais', async (req, res) => {
  const client = await pool.connect();
  try {
    const nome = textoObrigatorio(req.body?.nome, 'Nome do local');
    const endereco = textoOpcional(req.body?.endereco, 300);
    await garantirLocalSemDuplicidade(client, { nome, endereco });
    const r = await client.query(
      `INSERT INTO autoagenda.locais (nome, endereco) VALUES ($1,$2) RETURNING *`,
      [nome, endereco]
    );
    res.status(201).json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar local.' });
  } finally { client.release(); }
});

app.put('/api/locais/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const nome = textoObrigatorio(req.body?.nome, 'Nome do local');
    const endereco = textoOpcional(req.body?.endereco, 300);
    await garantirLocalSemDuplicidade(client, { nome, endereco }, id);
    const r = await client.query(
      `UPDATE autoagenda.locais SET nome=$1, endereco=$2, atualizado_em=NOW() WHERE id=$3 RETURNING *`,
      [nome, endereco, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Local não encontrado.' });
    res.json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar local.' });
  } finally { client.release(); }
});

app.patch('/api/locais/:id/ativo', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const ativo = req.body?.ativo === true;
    const atualQ = await client.query('SELECT * FROM autoagenda.locais WHERE id=$1', [id]);
    if (!atualQ.rowCount) return res.status(404).json({ error: 'Local não encontrado.' });
    const atual = atualQ.rows[0];

    if (ativo) {
      await garantirLocalSemDuplicidade(client, atual, id, true);
      const r = await client.query('UPDATE autoagenda.locais SET ativo=TRUE, atualizado_em=NOW() WHERE id=$1 RETURNING *', [id]);
      return res.json(r.rows[0]);
    }

    const atualizado = await desativarRecurso(client, 'local', 'locais', id);
    res.json(atualizado);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao alterar situação do local.' });
  } finally { client.release(); }
});

app.delete('/api/locais/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await desativarRecurso(client, 'local', 'locais', Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao desativar local.' });
  } finally { client.release(); }
});

app.delete('/api/locais/:id/permanente', async (req, res) => {
  const client = await pool.connect();
  try {
    await excluirRecursoPermanente(client, 'local', 'locais', Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao excluir local.' });
  } finally { client.release(); }
});


// ========================= V2.0 — ENCONTRAR HORÁRIO LIVRE =========================
app.get('/api/horarios-livres', async (req, res) => {
  const client = await pool.connect();
  try {
    const alunoId = Number(req.query.aluno_id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    const instrutorId = instrutorEscopo || Number(req.query.instrutor_id);
    const veiculoId = Number(req.query.veiculo_id);
    const localId = Number(req.query.local_id);
    const dataInicioSolicitada = String(req.query.data_inicio || hojeApp()).slice(0, 10);
    const limite = Math.min(10, Math.max(1, Number(req.query.limite || 5)));
    const diasBusca = Math.min(60, Math.max(1, Number(req.query.dias_busca || 30)));
    const config = await obterConfigFuncionamento(client);
    const duracao = validarInteiroPositivo(req.query.duracao_minutos, Number(config.duracao_padrao_minutos || 50), 240);
    const unidades = Math.min(4, validarInteiroPositivo(req.query.aulas_unidades, 1, 4));

    if (!alunoId || !instrutorId || !veiculoId || !localId) {
      throw erroHttp(400, 'Informe aluno, instrutor, veículo e local para procurar horários livres.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicioSolicitada)) throw erroHttp(400, 'Data inicial inválida.');

    if (instrutorEscopo) {
      const rel = await client.query(`
        SELECT 1
        FROM autoagenda.aulas
        WHERE aluno_id=$1 AND instrutor_id=$2
        LIMIT 1
      `, [alunoId, instrutorEscopo]);
      if (!rel.rowCount) throw erroHttp(403, 'Este aluno não está relacionado às suas aulas.');
    }

    await validarRecursosAtivos(client, { aluno_id: alunoId, instrutor_id: instrutorId, veiculo_id: veiculoId, local_id: localId });
    const saldo = await saldoAluno(client, alunoId);
    if (!saldo) throw erroHttp(404, 'Aluno não encontrado ou inativo.');
    if (unidades > Number(saldo.disponiveis || 0)) {
      throw erroHttp(409, `O aluno possui somente ${saldo.disponiveis} aula(s) disponível(is).`);
    }

    // Falha cedo se o veículo estiver globalmente em manutenção/indisponível/inativo.
    const veiculo = await obterVeiculoDisponibilidade(client, veiculoId);
    const situacao = veiculo.ativo === false ? 'INATIVO' : normalizarSituacaoVeiculo(veiculo.situacao);
    if (situacao !== 'DISPONIVEL') {
      const nomes = { INATIVO:'inativo', MANUTENCAO:'em manutenção', INDISPONIVEL:'indisponível' };
      throw erroHttp(400, `O veículo selecionado está ${nomes[situacao] || 'indisponível'}.`);
    }

    const hoje = hojeApp();
    let dataInicio = dataInicioSolicitada < hoje ? hoje : dataInicioSolicitada;
    const agora = agoraApp();
    const resultados = [];
    const abertura = minutosDoHorario(config.hora_abertura);
    const encerramento = minutosDoHorario(config.hora_encerramento);
    const passo = Math.max(5, Number(config.duracao_padrao_minutos || 50) + Number(config.intervalo_minutos || 0));

    for (let d = 0; d < diasBusca && resultados.length < limite; d++) {
      const dt = dateOnlyUTC(dataInicio);
      dt.setUTCDate(dt.getUTCDate() + d);
      const data = isoDateUTC(dt);
      if (!(config.dias_funcionamento || []).map(Number).includes(diaSemanaDaData(data))) continue;

      for (let min = abertura; min + duracao <= encerramento && resultados.length < limite; min += passo) {
        const horaInicio = horarioDeMinutos(min);
        if (data === agora.data && min <= minutosDoHorario(agora.hora)) continue;

        const candidato = {
          aluno_id: alunoId,
          instrutor_id: instrutorId,
          veiculo_id: veiculoId,
          data_aula: data,
          hora_inicio: horaInicio,
          duracao_minutos: duracao,
          aulas_unidades: unidades
        };

        if (!avaliarHorarioFuncionamento(config, candidato).ok) continue;
        try {
          await validarDisponibilidadeInstrutor(client, instrutorId, candidato, config);
          await validarDisponibilidadeVeiculo(client, veiculoId, candidato);
        } catch (error) {
          if ([400,404].includes(error.statusCode)) continue;
          throw error;
        }

        const conflito = await verificarConflito(client, candidato, [], config.intervalo_minutos);
        if (conflito.rowCount) continue;

        resultados.push({
          data_aula: data,
          hora_inicio: horaInicio,
          duracao_minutos: duracao,
          aulas_unidades: unidades
        });
      }
    }

    res.json({
      resultados,
      encontrados: resultados.length,
      limite,
      dias_busca: diasBusca,
      data_inicio: dataInicio,
      saldo,
      configuracao: {
        hora_abertura: config.hora_abertura,
        hora_encerramento: config.hora_encerramento,
        duracao_padrao_minutos: config.duracao_padrao_minutos,
        intervalo_minutos: config.intervalo_minutos
      }
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao procurar horários livres.' });
  } finally {
    client.release();
  }
});

// ========================= PLANOS AUTOMÁTICOS =========================
app.get('/api/planos', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
             al.nome AS aluno_nome,
             i.nome AS instrutor_nome,
             v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             l.nome AS local_nome,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.plan_id = p.id),0)::int AS encontros_gerados,
             COALESCE((SELECT SUM(a.aulas_unidades) FROM autoagenda.aulas a WHERE a.plan_id = p.id),0)::int AS aulas_geradas
      FROM autoagenda.planos_aula p
      JOIN autoagenda.alunos al ON al.id = p.aluno_id
      JOIN autoagenda.instrutores i ON i.id = p.instrutor_id
      JOIN autoagenda.veiculos v ON v.id = p.veiculo_id
      JOIN autoagenda.locais l ON l.id = p.local_id
      WHERE al.ativo = TRUE OR p.ativo = TRUE
      ORDER BY p.ativo DESC, p.criado_em DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar planos de aula.' });
  }
});

app.post('/api/planos/preview', async (req, res) => {
  const client = await pool.connect();
  try {
    const base = req.body || {};
    if (!base.aluno_id || !base.instrutor_id || !base.veiculo_id || !base.local_id || !base.data_inicio || !base.hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }
    if (String(base.data_inicio).slice(0, 10) < hojeApp()) {
      return res.status(400).json({ error: 'A data de início do plano não pode estar no passado.' });
    }

    await validarRecursosAtivos(client, base);
    const configFuncionamento = await obterConfigFuncionamento(client);
    base.duracao_base_minutos = validarInteiroPositivo(
      base.duracao_base_minutos,
      configFuncionamento.duracao_padrao_minutos,
      480
    );
    const saldo = await saldoAluno(client, base.aluno_id);
    if (!saldo) return res.status(404).json({ error: 'Aluno não encontrado ou inativo.' });

    const totalSolicitado = validarInteiroPositivo(base.total_aulas, 1, 500);
    if (totalSolicitado > saldo.disponiveis) {
      return res.status(400).json({
        error: `O aluno possui somente ${saldo.disponiveis} aula(s) disponível(is) para programar.`,
        saldo
      });
    }

    const ocorrencias = gerarOcorrencias({ ...base, total_aulas: totalSolicitado });
    await validarOcorrenciasFuncionamento(client, ocorrencias, configFuncionamento);
    await validarOcorrenciasInstrutor(client, base.instrutor_id, ocorrencias, configFuncionamento);
    await validarOcorrenciasVeiculo(client, base.veiculo_id, ocorrencias);
    const conflitos = await listarConflitosPlano(client, base, ocorrencias, configFuncionamento);
    const conflitoMap = new Map(conflitos.map(c => [`${c.data_aula}|${c.hora_inicio}`, c]));
    const preview = ocorrencias.map(o => {
      const c = conflitoMap.get(`${o.data_aula}|${o.hora_inicio}`);
      return c ? { ...o, conflito: c.conflito, sugestao_horario: c.sugestao_horario } : { ...o, conflito: null, sugestao_horario: null };
    });

    res.json({
      ok: conflitos.length === 0,
      ocorrencias: preview,
      conflitos: conflitos.length,
      total_encontros: ocorrencias.length,
      total_aulas: ocorrencias.reduce((s, o) => s + o.aulas_unidades, 0),
      dias_semana: normalizarDias(base.dias_semana, base.data_inicio)
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao gerar prévia.' });
  } finally {
    client.release();
  }
});

app.post('/api/planos', async (req, res) => {
  const client = await pool.connect();
  try {
    const base = req.body || {};
    if (!base.aluno_id || !base.instrutor_id || !base.veiculo_id || !base.local_id || !base.data_inicio || !base.hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }
    if (String(base.data_inicio).slice(0, 10) < hojeApp()) {
      return res.status(400).json({ error: 'A data de início do plano não pode estar no passado.' });
    }

    await validarRecursosAtivos(client, base);
    const configFuncionamento = await obterConfigFuncionamento(client);
    base.duracao_base_minutos = validarInteiroPositivo(
      base.duracao_base_minutos,
      configFuncionamento.duracao_padrao_minutos,
      480
    );
    const saldo = await saldoAluno(client, base.aluno_id);
    if (!saldo) return res.status(404).json({ error: 'Aluno não encontrado ou inativo.' });

    const totalSolicitado = validarInteiroPositivo(base.total_aulas, 1, 500);
    if (totalSolicitado > saldo.disponiveis) {
      return res.status(400).json({
        error: `O aluno possui somente ${saldo.disponiveis} aula(s) disponível(is) para programar.`,
        saldo
      });
    }

    const dias = normalizarDias(base.dias_semana, base.data_inicio);
    const ocorrencias = gerarOcorrencias({ ...base, total_aulas: totalSolicitado, dias_semana: dias });
    await validarOcorrenciasFuncionamento(client, ocorrencias, configFuncionamento);
    await validarOcorrenciasInstrutor(client, base.instrutor_id, ocorrencias, configFuncionamento);
    await validarOcorrenciasVeiculo(client, base.veiculo_id, ocorrencias);

    await client.query('BEGIN');

    const chavesPlano = [`saldo:aluno:${Number(base.aluno_id)}`];
    for (const o of ocorrencias) {
      chavesPlano.push(...chavesAgenda({
        aluno_id: base.aluno_id,
        instrutor_id: base.instrutor_id,
        veiculo_id: base.veiculo_id,
        data_aula: o.data_aula
      }));
    }
    await bloquearChavesTransacao(client, chavesPlano);

    // Evita que dois salvamentos simultâneos ultrapassem o saldo do mesmo aluno.
    const lockAluno = await client.query(
      'SELECT id FROM autoagenda.alunos WHERE id = $1 AND ativo = TRUE FOR UPDATE',
      [Number(base.aluno_id)]
    );
    if (!lockAluno.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno não encontrado ou inativo.' });
    }

    const saldoAtual = await saldoAluno(client, base.aluno_id);
    if (!saldoAtual || totalSolicitado > saldoAtual.disponiveis) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'O saldo de aulas do aluno mudou. Gere a prévia novamente antes de confirmar.',
        saldo: saldoAtual
      });
    }

    const conflitos = await listarConflitosPlano(client, base, ocorrencias, configFuncionamento);
    if (conflitos.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Existem conflitos na agenda. Revise a prévia.', conflitos });
    }

    const plano = await client.query(`
      INSERT INTO autoagenda.planos_aula
        (aluno_id, instrutor_id, veiculo_id, local_id, data_inicio, hora_inicio,
         duracao_base_minutos, aulas_por_encontro, total_aulas, dias_semana, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int[],$11)
      RETURNING *
    `, [
      Number(base.aluno_id), Number(base.instrutor_id), Number(base.veiculo_id), Number(base.local_id),
      base.data_inicio, String(base.hora_inicio).slice(0, 5),
      validarInteiroPositivo(base.duracao_base_minutos, configFuncionamento.duracao_padrao_minutos, 480),
      Math.min(4, Math.max(1, Number(base.aulas_por_encontro) || 1)),
      totalSolicitado, dias, base.observacoes || ''
    ]);

    const planId = plano.rows[0].id;
    const criadas = [];
    for (const o of ocorrencias) {
      const r = await client.query(`
        INSERT INTO autoagenda.aulas
          (aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
           duracao_minutos, status, observacoes, plan_id, numero_plano, aulas_unidades)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'AGENDADA',$8,$9,$10,$11)
        RETURNING *
      `, [
        Number(base.aluno_id), Number(base.instrutor_id), Number(base.veiculo_id), Number(base.local_id),
        o.data_aula, o.hora_inicio, o.duracao_minutos, base.observacoes || '', planId,
        o.numero_plano, o.aulas_unidades
      ]);
      criadas.push(r.rows[0]);
    }

    await client.query('COMMIT');
    dispararEmailPlanoSeguro(planId, 'PLANO_AGENDADO', String(plano.rows[0].criado_em || ''));
    dispararWhatsAppPlanoSeguro(planId, 'PLANO_AGENDADO', String(plano.rows[0].criado_em || ''));
    res.status(201).json({ plano: plano.rows[0], aulas: criadas });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao criar agenda automática.' });
  } finally {
    client.release();
  }
});

app.patch('/api/planos/:id/encerrar', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const cancelarFuturas = Boolean(req.body?.cancelar_futuras);
    await client.query('BEGIN');
    const p = await client.query(`
      UPDATE autoagenda.planos_aula SET ativo = FALSE, atualizado_em = NOW()
      WHERE id = $1 RETURNING *
    `, [id]);
    if (!p.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plano não encontrado.' });
    }
    if (cancelarFuturas) {
      await client.query(`
        UPDATE autoagenda.aulas
        SET status = 'CANCELADA', atualizado_em = NOW()
        WHERE plan_id = $1
          AND data_aula >= $2::date
          AND status IN ('AGENDADA','CONFIRMADA')
      `, [id, hojeApp()]);
    }
    await client.query('COMMIT');
    if (cancelarFuturas) {
      dispararEmailPlanoSeguro(id, 'PLANO_CANCELADO', String(p.rows[0].atualizado_em || ''));
      dispararWhatsAppPlanoSeguro(id, 'PLANO_CANCELADO', String(p.rows[0].atualizado_em || ''));
    }
    res.json({ ok: true });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error: 'Erro ao encerrar plano.' });
  } finally {
    client.release();
  }
});

// ========================= V2.6 — DASHBOARD =========================
// Mantém o painel leve: todos os indicadores são calculados no PostgreSQL em poucas consultas
// agregadas. A taxa de ocupação e os horários livres são estimativas baseadas no horário de
// funcionamento e na quantidade global de instrutores/veículos disponíveis. As validações
// individuais de disponibilidade continuam sendo feitas normalmente ao criar/reagendar aulas.
app.get('/api/dashboard/resumo', async (req, res) => {
  const client = await pool.connect();
  try {
    const hoje = hojeApp();
    const agora = agoraApp();
    const config = await obterConfigFuncionamento(client);

    const [resumoQ, serieQ, recursosQ, proximosQ] = await Promise.all([
      client.query(`
        WITH datas AS (
          SELECT $1::date AS hoje,
                 date_trunc('week', $1::date)::date AS inicio_semana,
                 (date_trunc('week', $1::date) + INTERVAL '6 day')::date AS fim_semana,
                 date_trunc('month', $1::date)::date AS inicio_mes,
                 (date_trunc('month', $1::date) + INTERVAL '1 month' - INTERVAL '1 day')::date AS fim_mes
        )
        SELECT
          TO_CHAR(d.inicio_semana, 'YYYY-MM-DD') AS inicio_semana,
          TO_CHAR(d.fim_semana, 'YYYY-MM-DD') AS fim_semana,
          TO_CHAR(d.inicio_mes, 'YYYY-MM-DD') AS inicio_mes,
          TO_CHAR(d.fim_mes, 'YYYY-MM-DD') AS fim_mes,
          (SELECT COUNT(*)::int FROM autoagenda.alunos WHERE ativo=TRUE) AS alunos_ativos,
          (SELECT COUNT(*)::int FROM autoagenda.planos_aula WHERE ativo=TRUE) AS planos_ativos,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula=d.hoje
               AND status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU')
               AND arquivada=FALSE) AS aulas_hoje,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_semana AND d.fim_semana
               AND status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU')
               AND arquivada=FALSE) AS aulas_semana,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula >= d.hoje
               AND status IN ('AGENDADA','CONFIRMADA')
               AND arquivada=FALSE) AS aulas_agendadas,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_mes AND d.fim_mes
               AND status='REALIZADA' AND arquivada=FALSE) AS realizadas_mes,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_mes AND d.fim_mes
               AND status='FALTOU' AND arquivada=FALSE) AS faltas_mes,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_mes AND d.fim_mes
               AND status='CANCELADA' AND arquivada=FALSE) AS cancelamentos_mes,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_mes AND d.fim_mes
               AND reposicao_de_id IS NOT NULL AND arquivada=FALSE) AS reposicoes_mes,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.inicio_semana AND d.fim_semana
               AND status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU')
               AND arquivada=FALSE) AS ocupadas_semana,
          (SELECT COALESCE(SUM(aulas_unidades),0)::int FROM autoagenda.aulas
             WHERE data_aula BETWEEN d.hoje AND d.fim_semana
               AND (data_aula > d.hoje OR hora_inicio >= $2::time)
               AND status IN ('AGENDADA','CONFIRMADA')
               AND arquivada=FALSE) AS ocupadas_restantes_semana
        FROM datas d
      `, [hoje, agora.hora]),

      client.query(`
        WITH datas AS (
          SELECT date_trunc('week', $1::date)::date AS inicio_semana,
                 (date_trunc('week', $1::date) + INTERVAL '6 day')::date AS fim_semana
        ), dias AS (
          SELECT generate_series(d.inicio_semana, d.fim_semana, INTERVAL '1 day')::date AS data
          FROM datas d
        )
        SELECT TO_CHAR(di.data, 'YYYY-MM-DD') AS data,
               COALESCE(SUM(CASE
                 WHEN a.status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU') AND a.arquivada=FALSE
                 THEN a.aulas_unidades ELSE 0 END),0)::int AS total,
               COALESCE(SUM(CASE WHEN a.status='REALIZADA' AND a.arquivada=FALSE THEN a.aulas_unidades ELSE 0 END),0)::int AS realizadas,
               COALESCE(SUM(CASE WHEN a.status='FALTOU' AND a.arquivada=FALSE THEN a.aulas_unidades ELSE 0 END),0)::int AS faltas,
               COALESCE(SUM(CASE WHEN a.status='CANCELADA' AND a.arquivada=FALSE THEN a.aulas_unidades ELSE 0 END),0)::int AS canceladas
        FROM dias di
        LEFT JOIN autoagenda.aulas a ON a.data_aula=di.data
        GROUP BY di.data
        ORDER BY di.data
      `, [hoje]),

      client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM autoagenda.instrutores WHERE ativo=TRUE) AS instrutores_ativos,
          (SELECT COUNT(*)::int FROM autoagenda.veiculos
             WHERE ativo=TRUE AND COALESCE(situacao,'DISPONIVEL')='DISPONIVEL') AS veiculos_disponiveis
      `),

      client.query(`
        WITH consumo AS (
          SELECT al.id, al.nome, al.aulas_contratadas,
                 (
                   COALESCE(al.aulas_realizadas_anteriores,0)
                   + COALESCE(SUM(CASE
                       WHEN au.status IN ('REALIZADA','FALTOU') AND au.arquivada=FALSE
                       THEN au.aulas_unidades ELSE 0 END),0)
                 )::int AS realizadas,
                 COALESCE(SUM(CASE
                   WHEN au.data_aula >= $1::date
                    AND au.status IN ('AGENDADA','CONFIRMADA')
                    AND au.arquivada=FALSE
                   THEN au.aulas_unidades ELSE 0 END),0)::int AS agendadas
          FROM autoagenda.alunos al
          LEFT JOIN autoagenda.aulas au ON au.aluno_id=al.id
          WHERE al.ativo=TRUE
          GROUP BY al.id, al.nome, al.aulas_contratadas, al.aulas_realizadas_anteriores
        )
        SELECT id, nome, aulas_contratadas, realizadas, agendadas,
               GREATEST(aulas_contratadas-realizadas,0)::int AS faltam_realizar
        FROM consumo
        WHERE GREATEST(aulas_contratadas-realizadas,0) BETWEEN 1 AND 5
        ORDER BY faltam_realizar ASC, nome ASC
        LIMIT 6
      `, [hoje])
    ]);

    const resumo = resumoQ.rows[0] || {};
    const recursos = recursosQ.rows[0] || {};
    const instrutoresAtivos = Number(recursos.instrutores_ativos || 0);
    const veiculosDisponiveis = Number(recursos.veiculos_disponiveis || 0);
    const recursosSimultaneos = Math.min(instrutoresAtivos, veiculosDisponiveis);

    const abertura = minutosDoHorario(config.hora_abertura);
    const encerramento = minutosDoHorario(config.hora_encerramento);
    const duracao = Math.max(1, Number(config.duracao_padrao_minutos || 50));
    const intervalo = Math.max(0, Number(config.intervalo_minutos || 0));
    const passo = duracao + intervalo;
    const janela = Math.max(0, encerramento - abertura);
    const slotsDiaPorRecurso = passo > 0 ? Math.max(0, Math.floor((janela + intervalo) / passo)) : 0;
    const diasFuncionamento = new Set((config.dias_funcionamento || []).map(Number));

    let diasSemanaAbertos = 0;
    let slotsRestantesSemanaPorRecurso = 0;
    const inicioSemana = String(resumo.inicio_semana || hoje).slice(0,10);
    for (let i = 0; i < 7; i += 1) {
      const dt = dateOnlyUTC(inicioSemana);
      dt.setUTCDate(dt.getUTCDate() + i);
      const data = isoDateUTC(dt);
      const dia = dt.getUTCDay();
      if (!diasFuncionamento.has(dia)) continue;
      diasSemanaAbertos += 1;
      if (data < hoje) continue;
      if (data > hoje) {
        slotsRestantesSemanaPorRecurso += slotsDiaPorRecurso;
        continue;
      }
      const agoraMin = minutosDoHorario(agora.hora);
      for (let min = abertura; min + duracao <= encerramento; min += passo) {
        if (min >= agoraMin) slotsRestantesSemanaPorRecurso += 1;
      }
    }

    const capacidadeSemana = slotsDiaPorRecurso * diasSemanaAbertos * recursosSimultaneos;
    const ocupadasSemana = Number(resumo.ocupadas_semana || 0);
    const taxaOcupacao = capacidadeSemana > 0
      ? Math.max(0, Math.min(100, Math.round((ocupadasSemana / capacidadeSemana) * 100)))
      : 0;

    const capacidadeRestante = slotsRestantesSemanaPorRecurso * recursosSimultaneos;
    const ocupadasRestantes = Number(resumo.ocupadas_restantes_semana || 0);
    const horariosLivres = Math.max(0, capacidadeRestante - ocupadasRestantes);

    res.json({
      ...resumo,
      taxa_ocupacao_semana: taxaOcupacao,
      horarios_livres_semana: horariosLivres,
      capacidade_semana: capacidadeSemana,
      ocupadas_semana: ocupadasSemana,
      recursos_simultaneos: recursosSimultaneos,
      instrutores_ativos: instrutoresAtivos,
      veiculos_disponiveis: veiculosDisponiveis,
      slots_dia_por_recurso: slotsDiaPorRecurso,
      serie_semana: serieQ.rows,
      proximos_concluir: proximosQ.rows,
      estimativa_ocupacao: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar dashboard.' });
  } finally {
    client.release();
  }
});


// ========================= V2.7 — RELATÓRIOS =========================
// Relatórios sob demanda: o navegador informa o período e recebe apenas dados agregados.
// A estrutura já separa resumo, instrutores, veículos e horários para facilitar futura exportação.
app.get('/api/relatorios/resumo', async (req, res) => {
  const client = await pool.connect();
  try {
    const hoje = hojeApp();
    const inicioMesAtual = `${hoje.slice(0, 7)}-01`;
    const dataInicio = String(req.query.data_inicio || inicioMesAtual).slice(0, 10);
    const dataFim = String(req.query.data_fim || hoje).slice(0, 10);
    const reData = /^\d{4}-\d{2}-\d{2}$/;

    if (!reData.test(dataInicio) || !reData.test(dataFim)) {
      return res.status(400).json({ error: 'Informe um período válido para o relatório.' });
    }

    let inicio;
    let fim;
    try {
      inicio = dateOnlyUTC(dataInicio);
      fim = dateOnlyUTC(dataFim);
      if (isoDateUTC(inicio) !== dataInicio || isoDateUTC(fim) !== dataFim) {
        return res.status(400).json({ error: 'Informe um período válido para o relatório.' });
      }
    } catch (_) {
      return res.status(400).json({ error: 'Informe um período válido para o relatório.' });
    }

    if (fim < inicio) {
      return res.status(400).json({ error: 'A data final não pode ser anterior à data inicial.' });
    }

    const diasPeriodo = Math.round((fim.getTime() - inicio.getTime()) / 86400000) + 1;
    if (diasPeriodo > 366) {
      return res.status(400).json({ error: 'Selecione um período de até 366 dias por relatório.' });
    }

    const config = await obterConfigFuncionamento(client);

    const [resumoQ, instrutoresQ, veiculosQ, horariosQ, recursosQ] = await Promise.all([
      client.query(`
        SELECT
          COALESCE(SUM(a.aulas_unidades),0)::int AS total_unidades,
          COUNT(a.id)::int AS total_registros,
          COALESCE(SUM(CASE WHEN a.status='REALIZADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS realizadas,
          COALESCE(SUM(CASE WHEN a.status='CANCELADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS cancelamentos,
          COALESCE(SUM(CASE WHEN a.status='FALTOU' THEN a.aulas_unidades ELSE 0 END),0)::int AS faltas,
          COALESCE(SUM(CASE WHEN a.reposicao_de_id IS NOT NULL THEN a.aulas_unidades ELSE 0 END),0)::int AS reposicoes,
          COALESCE(SUM(CASE WHEN a.status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU') THEN a.aulas_unidades ELSE 0 END),0)::int AS ocupadas,
          COUNT(DISTINCT a.aluno_id)::int AS alunos_movimentados,
          (SELECT COUNT(*)::int FROM autoagenda.alunos WHERE ativo=TRUE) AS alunos_ativos
        FROM autoagenda.aulas a
        WHERE a.data_aula BETWEEN $1::date AND $2::date
          AND a.arquivada=FALSE
      `, [dataInicio, dataFim]),

      client.query(`
        SELECT i.id, i.nome,
          COALESCE(SUM(a.aulas_unidades),0)::int AS total_unidades,
          COALESCE(SUM(CASE WHEN a.status='REALIZADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS realizadas,
          COALESCE(SUM(CASE WHEN a.status='FALTOU' THEN a.aulas_unidades ELSE 0 END),0)::int AS faltas,
          COALESCE(SUM(CASE WHEN a.status='CANCELADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS cancelamentos,
          COALESCE(SUM(CASE WHEN a.reposicao_de_id IS NOT NULL THEN a.aulas_unidades ELSE 0 END),0)::int AS reposicoes
        FROM autoagenda.aulas a
        JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
        WHERE a.data_aula BETWEEN $1::date AND $2::date
          AND a.arquivada=FALSE
        GROUP BY i.id, i.nome
        ORDER BY total_unidades DESC, i.nome ASC
      `, [dataInicio, dataFim]),

      client.query(`
        SELECT v.id, v.nome, v.placa,
          COALESCE(SUM(a.aulas_unidades),0)::int AS total_unidades,
          COALESCE(SUM(CASE WHEN a.status='REALIZADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS realizadas,
          COALESCE(SUM(CASE WHEN a.status='FALTOU' THEN a.aulas_unidades ELSE 0 END),0)::int AS faltas,
          COALESCE(SUM(CASE WHEN a.status='CANCELADA' THEN a.aulas_unidades ELSE 0 END),0)::int AS cancelamentos,
          COALESCE(SUM(CASE WHEN a.reposicao_de_id IS NOT NULL THEN a.aulas_unidades ELSE 0 END),0)::int AS reposicoes
        FROM autoagenda.aulas a
        JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
        WHERE a.data_aula BETWEEN $1::date AND $2::date
          AND a.arquivada=FALSE
        GROUP BY v.id, v.nome, v.placa
        ORDER BY total_unidades DESC, v.nome ASC
      `, [dataInicio, dataFim]),

      client.query(`
        SELECT TO_CHAR(a.hora_inicio, 'HH24:MI') AS horario,
          COALESCE(SUM(a.aulas_unidades),0)::int AS total_unidades,
          COUNT(a.id)::int AS encontros
        FROM autoagenda.aulas a
        WHERE a.data_aula BETWEEN $1::date AND $2::date
          AND a.arquivada=FALSE
          AND a.status IN ('AGENDADA','CONFIRMADA','REALIZADA','FALTOU')
        GROUP BY TO_CHAR(a.hora_inicio, 'HH24:MI')
        ORDER BY total_unidades DESC, horario ASC
        LIMIT 12
      `, [dataInicio, dataFim]),

      client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM autoagenda.instrutores WHERE ativo=TRUE) AS instrutores_ativos,
          (SELECT COUNT(*)::int FROM autoagenda.veiculos
             WHERE ativo=TRUE AND COALESCE(situacao,'DISPONIVEL')='DISPONIVEL') AS veiculos_disponiveis
      `)
    ]);

    const resumo = resumoQ.rows[0] || {};
    const recursos = recursosQ.rows[0] || {};
    const instrutoresAtivos = Number(recursos.instrutores_ativos || 0);
    const veiculosDisponiveis = Number(recursos.veiculos_disponiveis || 0);
    const recursosSimultaneos = Math.min(instrutoresAtivos, veiculosDisponiveis);

    const abertura = minutosDoHorario(config.hora_abertura);
    const encerramento = minutosDoHorario(config.hora_encerramento);
    const duracao = Math.max(1, Number(config.duracao_padrao_minutos || 50));
    const intervalo = Math.max(0, Number(config.intervalo_minutos || 0));
    const passo = duracao + intervalo;
    const janela = Math.max(0, encerramento - abertura);
    const slotsDiaPorRecurso = passo > 0 ? Math.max(0, Math.floor((janela + intervalo) / passo)) : 0;
    const diasFuncionamento = new Set((config.dias_funcionamento || []).map(Number));

    let diasAbertos = 0;
    for (let cursor = new Date(inicio.getTime()); cursor <= fim; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (diasFuncionamento.has(cursor.getUTCDay())) diasAbertos += 1;
    }

    const capacidadePeriodo = slotsDiaPorRecurso * diasAbertos * recursosSimultaneos;
    const ocupadas = Number(resumo.ocupadas || 0);
    const taxaOcupacao = capacidadePeriodo > 0
      ? Math.max(0, Math.min(100, Math.round((ocupadas / capacidadePeriodo) * 100)))
      : 0;

    res.json({
      periodo: { data_inicio: dataInicio, data_fim: dataFim, dias: diasPeriodo },
      resumo: {
        ...resumo,
        taxa_ocupacao: taxaOcupacao,
        capacidade_estimada: capacidadePeriodo,
        dias_funcionamento_periodo: diasAbertos,
        recursos_simultaneos: recursosSimultaneos,
        instrutores_ativos: instrutoresAtivos,
        veiculos_disponiveis: veiculosDisponiveis,
        estimativa_ocupacao: true
      },
      aulas_por_instrutor: instrutoresQ.rows,
      aulas_por_veiculo: veiculosQ.rows,
      horarios_mais_utilizados: horariosQ.rows
    });
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório.' });
  } finally {
    client.release();
  }
});


// ========================= V2.8 — FINANCEIRO SIMPLES =========================
// O financeiro fica isolado da agenda: registrar/editar um pacote financeiro não altera
// aulas contratadas, planos, saldo de aulas nem horários do aluno.
const FORMAS_PAGAMENTO = ['DINHEIRO','PIX','CARTAO','TRANSFERENCIA','BOLETO','OUTRO'];

function normalizarFormaPagamento(valor) {
  const v = String(valor || '').trim().toUpperCase();
  return FORMAS_PAGAMENTO.includes(v) ? v : '';
}

function validarLancamentoFinanceiro(body = {}) {
  const alunoId = Number(body.aluno_id);
  if (!Number.isInteger(alunoId) || alunoId < 1) throw erroHttp(400, 'Selecione um aluno válido.');

  const pacote = String(body.pacote || '').trim().slice(0, 150);
  if (!pacote) throw erroHttp(400, 'Informe o nome do pacote.');

  const quantidadeAulas = validarInteiroPositivo(body.quantidade_aulas, 0, 500);
  if (!quantidadeAulas) throw erroHttp(400, 'Informe uma quantidade de aulas válida.');

  const valorPacote = validarValorMonetario(body.valor_pacote, 'Valor do pacote');
  if (valorPacote <= 0) throw erroHttp(400, 'O valor do pacote deve ser maior que zero.');
  const valorPago = validarValorMonetario(body.valor_pago ?? 0, 'Valor pago');
  if (valorPago > valorPacote) throw erroHttp(400, 'O valor pago não pode ser maior que o valor do pacote.');

  const dataPagamento = validarDataOpcional(body.data_pagamento, 'Data do pagamento');
  const vencimento = validarDataOpcional(body.vencimento, 'Data de vencimento');
  let formaPagamento = normalizarFormaPagamento(body.forma_pagamento);

  if (valorPago > 0 && !dataPagamento) throw erroHttp(400, 'Informe a data do pagamento quando houver valor pago.');
  if (valorPago > 0 && !formaPagamento) throw erroHttp(400, 'Informe a forma de pagamento quando houver valor pago.');
  if (valorPago === 0) formaPagamento = '';

  return {
    aluno_id: alunoId,
    pacote,
    valor_pacote: valorPacote,
    quantidade_aulas: quantidadeAulas,
    valor_pago: valorPago,
    data_pagamento: valorPago > 0 ? dataPagamento : null,
    vencimento,
    forma_pagamento: valorPago > 0 ? formaPagamento : null,
    observacoes: String(body.observacoes || '').trim().slice(0, 2000) || null
  };
}

app.get('/api/financeiro', async (req, res) => {
  try {
    const alunoId = req.query.aluno_id ? Number(req.query.aluno_id) : null;
    const incluirArquivados = ['1','true','sim'].includes(String(req.query.incluir_arquivados || '').toLowerCase());
    if (alunoId !== null && (!Number.isInteger(alunoId) || alunoId < 1)) {
      return res.status(400).json({ error: 'Filtro de aluno inválido.' });
    }

    const hoje = hojeApp();
    const params = [alunoId, incluirArquivados, hoje];
    const where = `($1::int IS NULL OR f.aluno_id=$1) AND ($2::boolean=TRUE OR f.ativo=TRUE)`;

    const [itensQ, resumoQ] = await Promise.all([
      query(`
        SELECT f.id, f.aluno_id, al.nome AS aluno_nome, al.ativo AS aluno_ativo,
               f.pacote, f.valor_pacote, f.quantidade_aulas, f.valor_pago,
               GREATEST(f.valor_pacote - f.valor_pago, 0)::numeric(12,2) AS saldo_financeiro,
               TO_CHAR(f.data_pagamento, 'YYYY-MM-DD') AS data_pagamento,
               TO_CHAR(f.vencimento, 'YYYY-MM-DD') AS vencimento,
               f.forma_pagamento, f.observacoes, f.ativo, f.criado_em, f.atualizado_em,
               CASE
                 WHEN f.valor_pago >= f.valor_pacote THEN 'QUITADO'
                 WHEN f.vencimento IS NOT NULL AND f.vencimento < $3::date THEN 'VENCIDO'
                 WHEN f.valor_pago > 0 THEN 'PARCIAL'
                 ELSE 'PENDENTE'
               END AS status_financeiro
        FROM autoagenda.financeiro f
        JOIN autoagenda.alunos al ON al.id=f.aluno_id
        WHERE ${where}
        ORDER BY f.ativo DESC,
                 CASE WHEN f.vencimento IS NULL THEN 1 ELSE 0 END,
                 f.vencimento ASC NULLS LAST,
                 f.criado_em DESC
      `, params),
      query(`
        SELECT COUNT(*)::int AS lancamentos,
               COALESCE(SUM(f.valor_pacote),0)::numeric(12,2) AS total_pacotes,
               COALESCE(SUM(f.valor_pago),0)::numeric(12,2) AS total_pago,
               COALESCE(SUM(GREATEST(f.valor_pacote - f.valor_pago,0)),0)::numeric(12,2) AS total_a_receber,
               COALESCE(SUM(CASE WHEN f.vencimento IS NOT NULL AND f.vencimento < $3::date
                                      AND f.valor_pago < f.valor_pacote
                                 THEN GREATEST(f.valor_pacote - f.valor_pago,0) ELSE 0 END),0)::numeric(12,2) AS total_vencido
        FROM autoagenda.financeiro f
        WHERE ${where}
      `, params)
    ]);

    res.json({ itens: itensQ.rows, resumo: resumoQ.rows[0] || {}, filtro_aluno_id: alunoId, incluir_arquivados: incluirArquivados });
  } catch (error) {
    console.error('Erro ao consultar financeiro:', error);
    res.status(500).json({ error: 'Erro ao consultar financeiro.' });
  }
});

app.post('/api/financeiro', async (req, res) => {
  const client = await pool.connect();
  try {
    const d = validarLancamentoFinanceiro(req.body || {});
    const alunoQ = await client.query('SELECT id FROM autoagenda.alunos WHERE id=$1 AND ativo=TRUE', [d.aluno_id]);
    if (!alunoQ.rowCount) return res.status(404).json({ error: 'Aluno não encontrado ou inativo.' });

    const result = await client.query(`
      INSERT INTO autoagenda.financeiro
        (aluno_id, pacote, valor_pacote, quantidade_aulas, valor_pago, data_pagamento, vencimento, forma_pagamento, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `, [d.aluno_id, d.pacote, d.valor_pacote, d.quantidade_aulas, d.valor_pago, d.data_pagamento, d.vencimento, d.forma_pagamento, d.observacoes]);
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Erro ao cadastrar lançamento financeiro:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao cadastrar lançamento financeiro.' });
  } finally {
    client.release();
  }
});

app.put('/api/financeiro/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Lançamento inválido.' });
    const d = validarLancamentoFinanceiro(req.body || {});

    const existe = await client.query('SELECT id FROM autoagenda.financeiro WHERE id=$1', [id]);
    if (!existe.rowCount) return res.status(404).json({ error: 'Lançamento financeiro não encontrado.' });
    const alunoQ = await client.query('SELECT id FROM autoagenda.alunos WHERE id=$1', [d.aluno_id]);
    if (!alunoQ.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });

    await client.query(`
      UPDATE autoagenda.financeiro
      SET aluno_id=$1, pacote=$2, valor_pacote=$3, quantidade_aulas=$4,
          valor_pago=$5, data_pagamento=$6, vencimento=$7, forma_pagamento=$8,
          observacoes=$9, atualizado_em=NOW()
      WHERE id=$10
    `, [d.aluno_id, d.pacote, d.valor_pacote, d.quantidade_aulas, d.valor_pago, d.data_pagamento, d.vencimento, d.forma_pagamento, d.observacoes, id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao atualizar lançamento financeiro:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar lançamento financeiro.' });
  } finally {
    client.release();
  }
});

app.patch('/api/financeiro/:id/situacao', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Lançamento inválido.' });
    const ativo = req.body?.ativo === true;
    const result = await query(`
      UPDATE autoagenda.financeiro
      SET ativo=$1, atualizado_em=NOW()
      WHERE id=$2
      RETURNING id, ativo
    `, [ativo, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Lançamento financeiro não encontrado.' });
    res.json({ ok: true, ...result.rows[0] });
  } catch (error) {
    console.error('Erro ao alterar situação financeira:', error);
    res.status(500).json({ error: 'Erro ao alterar situação financeira.' });
  }
});


// ========================= V2.9 — BACKUP / EXPORTAÇÃO =========================
// As exportações usam somente tabelas do schema autoagenda. Variáveis de ambiente,
// usuários/senhas do Render, DATABASE_URL, tokens e credenciais nunca entram nos arquivos.
const EXPORTACOES = {
  alunos: { tabela: 'alunos', nome: 'Alunos', aba: 'Alunos' },
  instrutores: { tabela: 'instrutores', nome: 'Instrutores', aba: 'Instrutores' },
  veiculos: { tabela: 'veiculos', nome: 'Veículos', aba: 'Veiculos' },
  locais: { tabela: 'locais', nome: 'Locais', aba: 'Locais' },
  aulas: { tabela: 'aulas', nome: 'Aulas', aba: 'Aulas' },
  planos: { tabela: 'planos_aula', nome: 'Planos', aba: 'Planos' },
  financeiro: { tabela: 'financeiro', nome: 'Financeiro', aba: 'Financeiro' },
  configuracoes: { tabela: 'configuracoes', nome: 'Configurações', aba: 'Configuracoes' }
};

const EXPORTACOES_SUPORTE = {
  instrutor_indisponibilidades: { tabela: 'instrutor_indisponibilidades', nome: 'Indisponibilidades de instrutores', aba: 'Indisp_Instrutores' },
  veiculo_indisponibilidades: { tabela: 'veiculo_indisponibilidades', nome: 'Indisponibilidades de veículos', aba: 'Indisp_Veiculos' },
  avaliacoes_aluno: { tabela: 'avaliacoes_aluno', nome: 'Avaliações dos alunos', aba: 'Avaliacoes' },
  lembrete_envios: { tabela: 'lembrete_envios', nome: 'Histórico de lembretes', aba: 'Lembretes' },
  whatsapp_envios: { tabela: 'whatsapp_envios', nome: 'Histórico WhatsApp automático', aba: 'WhatsApp' },
  email_envios: { tabela: 'email_envios', nome: 'Histórico de e-mails', aba: 'Emails' }
};

const EXPORTACOES_COMPLETAS = { ...EXPORTACOES, ...EXPORTACOES_SUPORTE };
// V2.9.1 — XLSX gerado sem dependência externa.
// O arquivo Excel é montado no padrão Office Open XML (.xlsx) e compactado
// usando apenas o módulo nativo zlib do Node. Isso elimina falhas do ExcelJS
// no ambiente do Render e reduz memória/dependências no caminho de exportação.

function valorSeguroPlanilha(valor) {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor) || (typeof valor === 'object' && !(valor instanceof Date))) {
    return JSON.stringify(valor);
  }
  return valor;
}

function textoSeguroCsv(valor) {
  let texto = valorSeguroPlanilha(valor);
  if (texto instanceof Date) texto = texto.toISOString();
  texto = String(texto ?? '');
  // Evita que campos textuais sejam interpretados como fórmulas ao abrir o CSV em planilhas.
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

async function carregarTabelaBackup(client, chave, definicao) {
  const colunasExcluidas = definicao.tabela === 'aulas'
    ? ['confirmacao_token_hash','confirmacao_token_expira_em','confirmacao_token_usado_em']
    : [];

  const colunasQ = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='autoagenda' AND table_name=$1
      AND NOT (column_name = ANY($2::text[]))
    ORDER BY ordinal_position
  `, [definicao.tabela, colunasExcluidas]);

  // to_jsonb preserva DATE/TIME/TIMESTAMP como texto de PostgreSQL e permite
  // excluir metadados de segurança antes de gerar qualquer formato de backup.
  const dadosQ = await client.query(`
    SELECT (to_jsonb(x) - $1::text[]) AS registro
    FROM (SELECT * FROM autoagenda.${definicao.tabela} ORDER BY id) x
  `, [colunasExcluidas]);

  return {
    chave,
    tabela: definicao.tabela,
    nome: definicao.nome,
    aba: definicao.aba,
    colunas: colunasQ.rows.map(x => x.column_name),
    registros: dadosQ.rows.map(x => x.registro)
  };
}

async function coletarBackup(entidade = 'completo') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const selecionadas = entidade === 'completo'
      ? EXPORTACOES_COMPLETAS
      : { [entidade]: EXPORTACOES[entidade] };

    const conjuntos = {};
    for (const [chave, definicao] of Object.entries(selecionadas)) {
      conjuntos[chave] = await carregarTabelaBackup(client, chave, definicao);
    }
    await client.query('COMMIT');
    return conjuntos;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function metadadosBackup(entidade) {
  return {
    tipo: entidade === 'completo' ? 'AUTOAGENDA_BACKUP_COMPLETO' : 'AUTOAGENDA_EXPORTACAO',
    versao_backup: 1,
    app_version: APP_VERSION,
    schema: 'autoagenda',
    entidade,
    gerado_em: new Date().toISOString(),
    timezone_aplicacao: APP_TIMEZONE,
    credenciais_incluidas: false
  };
}

function payloadJsonBackup(entidade, conjuntos) {
  const estrutura = {};
  const dados = {};
  for (const [chave, conjunto] of Object.entries(conjuntos)) {
    estrutura[chave] = { tabela: conjunto.tabela, colunas: conjunto.colunas };
    dados[chave] = conjunto.registros;
  }
  return { ...metadadosBackup(entidade), estrutura, dados };
}

function csvDeConjunto(conjunto) {
  const colunas = conjunto.colunas.length
    ? conjunto.colunas
    : [...new Set(conjunto.registros.flatMap(r => Object.keys(r || {})))];
  const linhas = [colunas.map(textoSeguroCsv).join(';')];
  for (const registro of conjunto.registros) {
    linhas.push(colunas.map(c => textoSeguroCsv(registro?.[c])).join(';'));
  }
  return `sep=;\r\n${linhas.join('\r\n')}\r\n`;
}

function csvCompleto(conjuntos) {
  const linhas = ['sep=;', '"entidade";"registro_json"'];
  for (const [chave, conjunto] of Object.entries(conjuntos)) {
    for (const registro of conjunto.registros) {
      linhas.push(`${textoSeguroCsv(chave)};${textoSeguroCsv(JSON.stringify(registro))}`);
    }
    if (!conjunto.registros.length) linhas.push(`${textoSeguroCsv(chave)};${textoSeguroCsv('{}')}`);
  }
  return `${linhas.join('\r\n')}\r\n`;
}

function limparTextoXml(valor) {
  return String(valor ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, 32767);
}

function escaparXml(valor) {
  return limparTextoXml(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colunaExcel(numero) {
  let n = Number(numero);
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras || 'A';
}

function celulaXlsx(ref, valor, estilo = 0) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (valor === null || valor === undefined || valor === '') {
    return `<c r="${ref}"${s} t="inlineStr"><is><t></t></is></c>`;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  if (typeof valor === 'boolean') {
    return `<c r="${ref}"${s} t="b"><v>${valor ? 1 : 0}</v></c>`;
  }
  if (valor instanceof Date) valor = valor.toISOString();
  if (Array.isArray(valor) || (typeof valor === 'object' && valor !== null)) {
    valor = JSON.stringify(valor);
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

function xmlPlanilha(conjunto) {
  const colunas = conjunto.colunas.length
    ? conjunto.colunas
    : [...new Set(conjunto.registros.flatMap(r => Object.keys(r || {})))];
  const cols = colunas.map((coluna, i) => {
    let maior = String(coluna).length;
    for (const registro of conjunto.registros.slice(0, 250)) {
      maior = Math.max(maior, String(valorSeguroPlanilha(registro?.[coluna]) ?? '').length);
    }
    const largura = Math.min(40, Math.max(12, maior + 2));
    return `<col min="${i + 1}" max="${i + 1}" width="${largura}" customWidth="1"/>`;
  }).join('');

  const linhas = [];
  if (!colunas.length) {
    linhas.push('<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Sem colunas disponíveis</t></is></c></row>');
  } else {
    const cabecalho = colunas.map((coluna, i) => celulaXlsx(`${colunaExcel(i + 1)}1`, coluna, 1)).join('');
    linhas.push(`<row r="1" ht="22" customHeight="1">${cabecalho}</row>`);
    conjunto.registros.forEach((registro, idx) => {
      const rowNumber = idx + 2;
      const cells = colunas.map((coluna, i) => celulaXlsx(`${colunaExcel(i + 1)}${rowNumber}`, valorSeguroPlanilha(registro?.[coluna]))).join('');
      linhas.push(`<row r="${rowNumber}">${cells}</row>`);
    });
  }

  const ultimaColuna = colunaExcel(Math.max(1, colunas.length));
  const ultimaLinha = Math.max(1, conjunto.registros.length + 1);
  const filtro = colunas.length && conjunto.registros.length ? `<autoFilter ref="A1:${ultimaColuna}${ultimaLinha}"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${ultimaColuna}${ultimaLinha}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${cols ? `<cols>${cols}</cols>` : ''}
  <sheetData>${linhas.join('')}</sheetData>
  ${filtro}
</worksheet>`;
}

// CRC32 usado pelos registros ZIP do .xlsx.
const TABELA_CRC32 = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (const byte of buffer) c = TABELA_CRC32[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dataHoraDosZip(data = new Date()) {
  const ano = Math.max(1980, data.getFullYear());
  const dosTime = ((data.getHours() & 31) << 11) | ((data.getMinutes() & 63) << 5) | ((Math.floor(data.getSeconds() / 2)) & 31);
  const dosDate = (((ano - 1980) & 127) << 9) | (((data.getMonth() + 1) & 15) << 5) | (data.getDate() & 31);
  return { dosTime, dosDate };
}

function criarZip(arquivos) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  const { dosTime, dosDate } = dataHoraDosZip();

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome.replace(/\\/g, '/'), 'utf8');
    const original = Buffer.isBuffer(arquivo.dados) ? arquivo.dados : Buffer.from(String(arquivo.dados), 'utf8');
    const compactado = zlib.deflateRawSync(original, { level: 6 });
    const crc = crc32(original);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compactado.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, compactado);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compactado.length, 20);
    central.writeUInt32LE(original.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nome);

    offset += local.length + nome.length + compactado.length;
  }

  const blocoCentral = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(blocoCentral.length, 12);
  fim.writeUInt32LE(offset, 16);
  fim.writeUInt16LE(0, 20);
  return Buffer.concat([...locais, blocoCentral, fim]);
}

async function excelDeConjuntos(conjuntos) {
  const lista = Object.values(conjuntos);
  const sheets = lista.map((conjunto, i) => ({
    id: i + 1,
    nome: limparTextoXml(String(conjunto.aba || conjunto.nome || `Planilha ${i + 1}`).slice(0, 31)) || `Planilha ${i + 1}`,
    conjunto
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map(s => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheets.map(s => `<sheet name="${escaparXml(s.nome)}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map(s => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD400"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB59A00"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const arquivos = [
    { nome: '[Content_Types].xml', dados: contentTypes },
    { nome: '_rels/.rels', dados: rootRels },
    { nome: 'xl/workbook.xml', dados: workbook },
    { nome: 'xl/_rels/workbook.xml.rels', dados: workbookRels },
    { nome: 'xl/styles.xml', dados: styles },
    ...sheets.map(s => ({ nome: `xl/worksheets/sheet${s.id}.xml`, dados: xmlPlanilha(s.conjunto) }))
  ];

  return criarZip(arquivos);
}

function nomeArquivoBackup(entidade, formato) {
  const data = hojeApp();
  const rotulo = entidade === 'completo' ? 'backup-completo' : `exportacao-${entidade}`;
  return `AutoAgenda-${rotulo}-${data}.${formato}`;
}

app.get('/api/backup/resumo', async (req, res) => {
  try {
    const r = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM autoagenda.alunos) AS alunos,
        (SELECT COUNT(*)::int FROM autoagenda.instrutores) AS instrutores,
        (SELECT COUNT(*)::int FROM autoagenda.veiculos) AS veiculos,
        (SELECT COUNT(*)::int FROM autoagenda.locais) AS locais,
        (SELECT COUNT(*)::int FROM autoagenda.aulas) AS aulas,
        (SELECT COUNT(*)::int FROM autoagenda.planos_aula) AS planos,
        (SELECT COUNT(*)::int FROM autoagenda.financeiro) AS financeiro,
        (SELECT COUNT(*)::int FROM autoagenda.configuracoes) AS configuracoes
    `);
    const contagens = r.rows[0] || {};
    const totalRegistros = Object.values(contagens).reduce((soma, n) => soma + Number(n || 0), 0);
    res.json({
      version: APP_VERSION,
      gerado_em: new Date().toISOString(),
      total_registros: totalRegistros,
      contagens,
      formatos: ['csv','xlsx','json'],
      backup_completo_disponivel: true,
      credenciais_incluidas: false
    });
  } catch (error) {
    console.error('Erro ao carregar resumo de backup:', error);
    res.status(500).json({ error: 'Erro ao carregar resumo de backup.' });
  }
});

// V3.6 — status do backup nativo PostgreSQL/S3.
// A execução é externa ao web service (Cron Job), portanto esta rota apenas lê
// o histórico gravado pela rotina e nunca recebe/expõe credenciais de armazenamento.
app.get('/api/backup/automatico/status', async (req, res) => {
  try {
    const ultimas = await query(`
      SELECT id, tipo, status, arquivo, destino, tamanho_bytes, sha256, retencao_dias,
             iniciado_em, concluido_em, erro
      FROM autoagenda.backup_execucoes
      ORDER BY iniciado_em DESC, id DESC
      LIMIT 10
    `);
    const sucessoQ = await query(`
      SELECT id, tipo, status, arquivo, destino, tamanho_bytes, sha256, retencao_dias,
             iniciado_em, concluido_em, erro
      FROM autoagenda.backup_execucoes
      WHERE status='ENVIADO'
      ORDER BY concluido_em DESC NULLS LAST, id DESC
      LIMIT 1
    `);
    const ultima = ultimas.rows[0] || null;
    const ultimoSucesso = sucessoQ.rows[0] || null;
    res.json({
      version: APP_VERSION,
      modo: 'CRON_EXTERNO_OPCIONAL',
      armazenamento_recomendado: 'S3',
      retencao_recomendada_dias: 30,
      cron_ativado_pelo_app: false,
      observacao: 'A ativação do Cron Job e do armazenamento externo é feita no Render/AWS, fora do AutoAgenda.',
      ultima_execucao: ultima,
      ultimo_sucesso: ultimoSucesso,
      ultimas_execucoes: ultimas.rows
    });
  } catch (error) {
    console.error('Erro ao carregar status do backup automático:', error);
    res.status(500).json({ error: 'Erro ao carregar status do backup automático.' });
  }
});

app.get('/api/backup/exportar', async (req, res) => {
  const entidade = String(req.query.entidade || 'completo').trim().toLowerCase();
  const formato = String(req.query.formato || 'json').trim().toLowerCase();

  if (entidade !== 'completo' && !EXPORTACOES[entidade]) {
    return res.status(400).json({ error: 'Conjunto de dados inválido para exportação.' });
  }
  if (!['csv','xlsx','json'].includes(formato)) {
    return res.status(400).json({ error: 'Formato inválido. Use CSV, Excel ou JSON.' });
  }

  try {
    const conjuntos = await coletarBackup(entidade);
    const arquivo = nomeArquivoBackup(entidade, formato);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);

    if (formato === 'json') {
      res.type('application/json; charset=utf-8');
      return res.send(JSON.stringify(payloadJsonBackup(entidade, conjuntos), null, 2));
    }

    if (formato === 'csv') {
      const csv = entidade === 'completo'
        ? csvCompleto(conjuntos)
        : csvDeConjunto(conjuntos[entidade]);
      res.type('text/csv; charset=utf-8');
      return res.send(`\uFEFF${csv}`);
    }

    const arquivoExcel = await excelDeConjuntos(conjuntos);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(arquivoExcel);
  } catch (error) {
    console.error('Erro ao exportar backup:', error);
    if (!res.headersSent) return res.status(500).json({ error: 'Erro ao gerar o arquivo de backup/exportação.' });
  }
});


// ========================= V3.5 — RESTAURAÇÃO SEGURA DE BACKUP JSON =========================
// A restauração substitui somente os dados operacionais exportados no backup completo.
// Usuários, senhas e sessões são preservados; links de usuários INSTRUTOR são religados
// pelo mesmo instrutor_id quando esse cadastro existir no backup restaurado.
const RESTORE_BACKUP_VERSION = 1;
const RESTORE_LOCK_KEY = 35003500;
const RESTORE_CHAVES_PRINCIPAIS = Object.keys(EXPORTACOES);
const RESTORE_CHAVES_SUPORTE = Object.keys(EXPORTACOES_SUPORTE);
const RESTORE_CHAVES = [...RESTORE_CHAVES_PRINCIPAIS, ...RESTORE_CHAVES_SUPORTE];
const RESTORE_COLUNAS_PROIBIDAS = new Set([
  'confirmacao_token_hash',
  'confirmacao_token_expira_em',
  'confirmacao_token_usado_em'
]);

function objetoPlano(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor);
}

function compararVersoesSemver(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function lerPayloadRestauracao(req) {
  let texto = '';
  if (Buffer.isBuffer(req.body)) texto = req.body.toString('utf8');
  else if (typeof req.body === 'string') texto = req.body;
  else if (objetoPlano(req.body)) texto = JSON.stringify(req.body);

  if (!texto || !texto.trim()) throw erroHttp(400, 'Selecione um arquivo JSON de backup do AutoAgenda.');
  if (Buffer.byteLength(texto, 'utf8') > RESTORE_MAX_BYTES) {
    throw erroHttp(413, 'O arquivo de backup excede o limite de 10 MB para restauração nesta versão.');
  }

  let payload;
  try { payload = JSON.parse(texto); }
  catch { throw erroHttp(400, 'O arquivo selecionado não contém um JSON válido.'); }
  return { texto, payload, digest: hashSha256(texto) };
}

async function colunasAtuaisRestauracao(client) {
  const tabelas = RESTORE_CHAVES.map(chave => EXPORTACOES_COMPLETAS[chave].tabela);
  const q = await client.query(`
    SELECT table_name, column_name, ordinal_position
    FROM information_schema.columns
    WHERE table_schema='autoagenda' AND table_name = ANY($1::text[])
    ORDER BY table_name, ordinal_position
  `, [tabelas]);
  const mapa = {};
  for (const row of q.rows) {
    if (!mapa[row.table_name]) mapa[row.table_name] = [];
    mapa[row.table_name].push(row.column_name);
  }
  return mapa;
}

function idsDoConjunto(registros, chave) {
  const ids = new Set();
  for (const r of registros) {
    const id = Number(r?.id);
    if (!Number.isInteger(id) || id < 1) throw erroHttp(400, `O conjunto ${chave} contém um registro sem id válido.`);
    if (ids.has(id)) throw erroHttp(400, `O conjunto ${chave} contém id duplicado: ${id}.`);
    ids.add(id);
  }
  return ids;
}

function validarReferencia(id, ids, mensagem) {
  if (id === null || id === undefined || id === '') return;
  const n = Number(id);
  if (!Number.isInteger(n) || !ids.has(n)) throw erroHttp(400, mensagem.replace('{id}', String(id)));
}

function validarReferenciasBackup(dados) {
  const ids = {};
  for (const chave of RESTORE_CHAVES) ids[chave] = idsDoConjunto(dados[chave] || [], chave);

  for (const r of dados.instrutor_indisponibilidades || []) {
    validarReferencia(r.instrutor_id, ids.instrutores, 'Indisponibilidade referencia instrutor inexistente no backup: {id}.');
  }
  for (const r of dados.veiculo_indisponibilidades || []) {
    validarReferencia(r.veiculo_id, ids.veiculos, 'Indisponibilidade referencia veículo inexistente no backup: {id}.');
  }
  for (const r of dados.planos || []) {
    validarReferencia(r.aluno_id, ids.alunos, 'Plano referencia aluno inexistente no backup: {id}.');
    validarReferencia(r.instrutor_id, ids.instrutores, 'Plano referencia instrutor inexistente no backup: {id}.');
    validarReferencia(r.veiculo_id, ids.veiculos, 'Plano referencia veículo inexistente no backup: {id}.');
    validarReferencia(r.local_id, ids.locais, 'Plano referencia local inexistente no backup: {id}.');
  }
  for (const r of dados.aulas || []) {
    validarReferencia(r.aluno_id, ids.alunos, 'Aula referencia aluno inexistente no backup: {id}.');
    validarReferencia(r.instrutor_id, ids.instrutores, 'Aula referencia instrutor inexistente no backup: {id}.');
    validarReferencia(r.veiculo_id, ids.veiculos, 'Aula referencia veículo inexistente no backup: {id}.');
    validarReferencia(r.local_id, ids.locais, 'Aula referencia local inexistente no backup: {id}.');
    validarReferencia(r.plan_id, ids.planos, 'Aula referencia plano inexistente no backup: {id}.');
    validarReferencia(r.reposicao_de_id, ids.aulas, 'Aula referencia aula de reposição inexistente no backup: {id}.');
  }
  for (const r of dados.financeiro || []) {
    validarReferencia(r.aluno_id, ids.alunos, 'Financeiro referencia aluno inexistente no backup: {id}.');
  }
  for (const r of dados.avaliacoes_aluno || []) {
    validarReferencia(r.aluno_id, ids.alunos, 'Avaliação referencia aluno inexistente no backup: {id}.');
    validarReferencia(r.instrutor_id, ids.instrutores, 'Avaliação referencia instrutor inexistente no backup: {id}.');
  }
  for (const r of dados.lembrete_envios || []) {
    validarReferencia(r.aula_id, ids.aulas, 'Lembrete referencia aula inexistente no backup: {id}.');
  }
  for (const r of dados.whatsapp_envios || []) {
    validarReferencia(r.aula_id, ids.aulas, 'WhatsApp referencia aula inexistente no backup: {id}.');
    validarReferencia(r.plan_id, ids.planos, 'WhatsApp referencia plano inexistente no backup: {id}.');
  }
  for (const r of dados.email_envios || []) {
    validarReferencia(r.aula_id, ids.aulas, 'E-mail referencia aula inexistente no backup: {id}.');
    validarReferencia(r.plan_id, ids.planos, 'E-mail referencia plano inexistente no backup: {id}.');
  }
}

function validarBackupEstrutural(payload, colunasAtuais) {
  if (!objetoPlano(payload)) throw erroHttp(400, 'Estrutura de backup inválida.');
  if (payload.tipo !== 'AUTOAGENDA_BACKUP_COMPLETO') throw erroHttp(400, 'O arquivo não é um backup completo do AutoAgenda.');
  if (Number(payload.versao_backup) !== RESTORE_BACKUP_VERSION) {
    throw erroHttp(400, `Versão de backup incompatível. Esta versão aceita backup ${RESTORE_BACKUP_VERSION}.`);
  }
  if (payload.schema !== 'autoagenda' || payload.entidade !== 'completo') {
    throw erroHttp(400, 'O arquivo não pertence ao schema completo do AutoAgenda.');
  }
  if (payload.credenciais_incluidas === true) {
    throw erroHttp(400, 'Backup rejeitado porque declara conter credenciais.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(payload.app_version || ''))) {
    throw erroHttp(400, 'O backup não possui uma versão válida do AutoAgenda.');
  }
  if (compararVersoesSemver(payload.app_version, APP_VERSION) > 0) {
    throw erroHttp(400, `Este backup foi gerado pelo AutoAgenda V${payload.app_version}, mais novo que a versão atual V${APP_VERSION}. Atualize o sistema antes de restaurá-lo.`);
  }
  if (!objetoPlano(payload.estrutura) || !objetoPlano(payload.dados)) {
    throw erroHttp(400, 'O backup não contém as seções estrutura e dados esperadas.');
  }

  const desconhecidas = Object.keys(payload.dados).filter(k => !RESTORE_CHAVES.includes(k));
  if (desconhecidas.length) throw erroHttp(400, `O backup contém conjunto(s) desconhecido(s): ${desconhecidas.join(', ')}.`);

  const normalizados = {};
  for (const chave of RESTORE_CHAVES) {
    const def = EXPORTACOES_COMPLETAS[chave];
    const obrigatorio = RESTORE_CHAVES_PRINCIPAIS.includes(chave);
    const registros = payload.dados[chave];
    const estrutura = payload.estrutura[chave];

    if (obrigatorio && !Array.isArray(registros)) throw erroHttp(400, `O backup está incompleto: conjunto ${chave} ausente.`);
    if (registros !== undefined && !Array.isArray(registros)) throw erroHttp(400, `O conjunto ${chave} precisa ser uma lista.`);
    if (obrigatorio && !objetoPlano(estrutura)) throw erroHttp(400, `A estrutura do conjunto ${chave} está ausente.`);
    if (estrutura && estrutura.tabela !== def.tabela) throw erroHttp(400, `Tabela incompatível no conjunto ${chave}.`);

    const lista = Array.isArray(registros) ? registros : [];
    if (lista.length > 50000) throw erroHttp(400, `O conjunto ${chave} excede o limite de 50.000 registros.`);
    for (const r of lista) if (!objetoPlano(r)) throw erroHttp(400, `O conjunto ${chave} contém registro inválido.`);

    const colunasDeclaradas = Array.isArray(estrutura?.colunas)
      ? estrutura.colunas.map(String)
      : (lista[0] ? Object.keys(lista[0]) : ['id']);
    if (!colunasDeclaradas.includes('id') && chave !== 'configuracoes') {
      throw erroHttp(400, `A estrutura do conjunto ${chave} não contém a coluna id.`);
    }
    const atuais = new Set(colunasAtuais[def.tabela] || []);
    for (const coluna of colunasDeclaradas) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(coluna) || !atuais.has(coluna) || RESTORE_COLUNAS_PROIBIDAS.has(coluna)) {
        throw erroHttp(400, `Coluna incompatível ou não restaurável em ${chave}: ${coluna}.`);
      }
    }
    const permitidas = new Set(colunasDeclaradas);
    for (const r of lista) {
      for (const coluna of Object.keys(r)) {
        if (!permitidas.has(coluna) || RESTORE_COLUNAS_PROIBIDAS.has(coluna)) {
          throw erroHttp(400, `Registro de ${chave} contém coluna não declarada ou proibida: ${coluna}.`);
        }
      }
    }
    normalizados[chave] = lista;
  }

  if ((normalizados.configuracoes || []).length !== 1 || Number(normalizados.configuracoes[0]?.id) !== 1) {
    throw erroHttp(400, 'O backup precisa conter exatamente a configuração principal id=1.');
  }

  const total = RESTORE_CHAVES.reduce((s, chave) => s + normalizados[chave].length, 0);
  if (total > 100000) throw erroHttp(400, 'O backup excede o limite total de 100.000 registros.');
  validarReferenciasBackup(normalizados);

  return {
    dados: normalizados,
    total,
    contagens: Object.fromEntries(RESTORE_CHAVES.map(chave => [chave, normalizados[chave].length]))
  };
}

async function contagensAtuaisRestauracao(client) {
  const out = {};
  for (const chave of RESTORE_CHAVES) {
    const tabela = EXPORTACOES_COMPLETAS[chave].tabela;
    const q = await client.query(`SELECT COUNT(*)::int AS n FROM autoagenda.${tabela}`);
    out[chave] = Number(q.rows[0]?.n || 0);
  }
  return out;
}

function identificadorSql(nome) {
  return `"${String(nome).replace(/"/g, '""')}"`;
}

async function inserirLoteRestauracao(client, chave, registros, colunasDeclaradas, transformador = null) {
  if (!registros.length) return;
  const tabela = EXPORTACOES_COMPLETAS[chave].tabela;
  const colunas = colunasDeclaradas.filter(c => !RESTORE_COLUNAS_PROIBIDAS.has(c));
  const tamanhoLote = 100;

  for (let inicio = 0; inicio < registros.length; inicio += tamanhoLote) {
    const lote = registros.slice(inicio, inicio + tamanhoLote).map(r => transformador ? transformador({ ...r }) : { ...r });
    const valores = [];
    const grupos = lote.map((registro, linha) => {
      const base = linha * colunas.length;
      for (const coluna of colunas) valores.push(Object.prototype.hasOwnProperty.call(registro, coluna) ? registro[coluna] : null);
      return `(${colunas.map((_, i) => `$${base + i + 1}`).join(',')})`;
    });
    await client.query(`
      INSERT INTO autoagenda.${tabela} (${colunas.map(identificadorSql).join(',')})
      VALUES ${grupos.join(',')}
    `, valores);
  }
}

async function ajustarSequenciaTabela(client, tabela) {
  const q = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [`autoagenda.${tabela}`]);
  const seq = q.rows[0]?.seq;
  if (!seq) return;
  const m = await client.query(`SELECT COALESCE(MAX(id),0)::bigint AS max_id FROM autoagenda.${tabela}`);
  const maxId = Number(m.rows[0]?.max_id || 0);
  if (maxId > 0) await client.query(`SELECT setval($1::regclass, $2, true)`, [seq, maxId]);
  else await client.query(`SELECT setval($1::regclass, 1, false)`, [seq]);
}

async function executarRestauracaoBackup(client, payload, validacao) {
  const locked = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [RESTORE_LOCK_KEY]);
  if (locked.rows[0]?.ok !== true) throw erroHttp(409, 'Já existe uma restauração em andamento. Tente novamente em instantes.');

  // Não inicia a substituição enquanto um worker de comunicação estiver processando.
  // Usamos as mesmas chaves dos workers para impedir novos envios até o COMMIT/ROLLBACK.
  for (const workerLock of [33003300, 34003400, 37003700]) {
    const w = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [workerLock]);
    if (w.rows[0]?.ok !== true) {
      throw erroHttp(409, 'Há uma comunicação automática sendo processada neste momento. Aguarde alguns segundos e tente restaurar novamente.');
    }
  }

  // Bloqueia o conjunto operacional de uma só vez para impedir alterações concorrentes
  // durante a janela curta de substituição dos dados. Leituras/escritas aguardam o fim da transação.
  await client.query(`
    LOCK TABLE
      autoagenda.email_envios, autoagenda.whatsapp_envios, autoagenda.lembrete_envios, autoagenda.avaliacoes_aluno, autoagenda.financeiro,
      autoagenda.aulas, autoagenda.planos_aula, autoagenda.instrutor_indisponibilidades,
      autoagenda.veiculo_indisponibilidades, autoagenda.configuracoes, autoagenda.alunos,
      autoagenda.locais, autoagenda.veiculos, autoagenda.instrutores
    IN ACCESS EXCLUSIVE MODE
  `);

  const vinculosQ = await client.query(`
    SELECT u.id, u.instrutor_id, i.nome AS instrutor_nome, i.email AS instrutor_email, i.whatsapp AS instrutor_whatsapp
    FROM autoagenda.usuarios u
    JOIN autoagenda.instrutores i ON i.id=u.instrutor_id
    WHERE u.perfil='INSTRUTOR' AND u.instrutor_id IS NOT NULL
    ORDER BY u.id
  `);
  const vinculos = vinculosQ.rows.map(x => ({
    usuario_id:Number(x.id), instrutor_id:Number(x.instrutor_id),
    nome:String(x.instrutor_nome || '').trim().toLowerCase(),
    email:String(x.instrutor_email || '').trim().toLowerCase(),
    whatsapp:String(x.instrutor_whatsapp || '').replace(/\D/g, '')
  }));

  // A reposição usa uma FK autorreferente com ON DELETE RESTRICT. Zeramos
  // apenas dentro da mesma transação antes de excluir as aulas, evitando que
  // uma cadeia de reposições impeça a substituição completa do conjunto.
  await client.query(`UPDATE autoagenda.aulas SET reposicao_de_id=NULL WHERE reposicao_de_id IS NOT NULL`);

  const ordemExclusao = [
    'email_envios','whatsapp_envios','lembrete_envios','avaliacoes_aluno','financeiro','aulas','planos',
    'instrutor_indisponibilidades','veiculo_indisponibilidades','configuracoes',
    'alunos','locais','veiculos','instrutores'
  ];
  for (const chave of ordemExclusao) {
    const tabela = EXPORTACOES_COMPLETAS[chave].tabela;
    await client.query(`DELETE FROM autoagenda.${tabela}`);
  }

  const estrutura = payload.estrutura || {};
  const dados = validacao.dados;
  const colunas = chave => Array.isArray(estrutura[chave]?.colunas)
    ? estrutura[chave].colunas.map(String)
    : (dados[chave][0] ? Object.keys(dados[chave][0]) : ['id']);

  await inserirLoteRestauracao(client, 'instrutores', dados.instrutores, colunas('instrutores'));
  await inserirLoteRestauracao(client, 'alunos', dados.alunos, colunas('alunos'));
  await inserirLoteRestauracao(client, 'veiculos', dados.veiculos, colunas('veiculos'));
  await inserirLoteRestauracao(client, 'locais', dados.locais, colunas('locais'));
  await inserirLoteRestauracao(client, 'configuracoes', dados.configuracoes, colunas('configuracoes'));

  await inserirLoteRestauracao(client, 'avaliacoes_aluno', dados.avaliacoes_aluno, colunas('avaliacoes_aluno'));
  await inserirLoteRestauracao(client, 'instrutor_indisponibilidades', dados.instrutor_indisponibilidades, colunas('instrutor_indisponibilidades'));
  await inserirLoteRestauracao(client, 'veiculo_indisponibilidades', dados.veiculo_indisponibilidades, colunas('veiculo_indisponibilidades'));
  await inserirLoteRestauracao(client, 'planos', dados.planos, colunas('planos'));

  const reposicoes = new Map();
  for (const a of dados.aulas) if (a.reposicao_de_id !== null && a.reposicao_de_id !== undefined) reposicoes.set(Number(a.id), Number(a.reposicao_de_id));
  await inserirLoteRestauracao(client, 'aulas', dados.aulas, colunas('aulas'), r => {
    if (Object.prototype.hasOwnProperty.call(r, 'reposicao_de_id')) r.reposicao_de_id = null;
    return r;
  });
  for (const [id, reposicaoId] of reposicoes) {
    await client.query(`UPDATE autoagenda.aulas SET reposicao_de_id=$1 WHERE id=$2`, [reposicaoId, id]);
  }

  await inserirLoteRestauracao(client, 'financeiro', dados.financeiro, colunas('financeiro'));
  await inserirLoteRestauracao(client, 'lembrete_envios', dados.lembrete_envios, colunas('lembrete_envios'), r => {
    if (['PENDENTE','PROCESSANDO'].includes(String(r.status || '').toUpperCase())) {
      r.status = 'CANCELADO';
      r.processando_em = null;
      r.erro = 'Cancelado automaticamente durante a restauração para impedir envio inesperado.';
    }
    return r;
  });
  await inserirLoteRestauracao(client, 'whatsapp_envios', dados.whatsapp_envios, colunas('whatsapp_envios'), r => {
    if (['PENDENTE','PROCESSANDO'].includes(String(r.status || '').toUpperCase())) {
      r.status = 'CANCELADO';
      r.processando_em = null;
      r.erro = 'Cancelado automaticamente durante a restauração para impedir envio inesperado.';
    }
    return r;
  });
  await inserirLoteRestauracao(client, 'email_envios', dados.email_envios, colunas('email_envios'), r => {
    if (['PENDENTE','PROCESSANDO'].includes(String(r.status || '').toUpperCase())) {
      r.status = 'CANCELADO';
      r.processando_em = null;
      r.erro = 'Cancelado automaticamente durante a restauração para impedir envio inesperado.';
    }
    return r;
  });

  // Sempre exige uma decisão consciente do ADMIN após a restauração. Assim, um
  // backup antigo não dispara mensagens apenas porque as credenciais existem no Render.
  await client.query(`
    UPDATE autoagenda.configuracoes
    SET whatsapp_automatico_ativo=FALSE,
        email_automatico_ativo=FALSE,
        atualizado_em=NOW()
    WHERE id=1
  `);

  const instrutoresRestaurados = new Map(dados.instrutores.map(x => [Number(x.id), {
    nome:String(x.nome || '').trim().toLowerCase(),
    email:String(x.email || '').trim().toLowerCase(),
    whatsapp:String(x.whatsapp || '').replace(/\D/g, '')
  }]));
  let vinculosRestaurados = 0;
  let vinculosNaoEncontrados = 0;
  for (const v of vinculos) {
    const r = instrutoresRestaurados.get(v.instrutor_id);
    const identidadeCompativel = Boolean(r && (
      (v.nome && r.nome && v.nome === r.nome) ||
      (v.email && r.email && v.email === r.email) ||
      (v.whatsapp && r.whatsapp && v.whatsapp === r.whatsapp)
    ));
    if (identidadeCompativel) {
      await client.query(`UPDATE autoagenda.usuarios SET instrutor_id=$1, atualizado_em=NOW() WHERE id=$2 AND perfil='INSTRUTOR'`, [v.instrutor_id, v.usuario_id]);
      vinculosRestaurados++;
    } else {
      vinculosNaoEncontrados++;
    }
  }

  for (const chave of RESTORE_CHAVES) {
    if (chave === 'configuracoes') continue;
    await ajustarSequenciaTabela(client, EXPORTACOES_COMPLETAS[chave].tabela);
  }

  return { vinculosRestaurados, vinculosNaoEncontrados };
}

app.post('/api/backup/restaurar/validar', async (req, res) => {
  if (!usuarioEhAdmin(req)) return res.status(403).json({ error: 'Somente o administrador pode validar uma restauração.' });
  const client = await pool.connect();
  try {
    const { payload, digest } = lerPayloadRestauracao(req);
    const colunasAtuais = await colunasAtuaisRestauracao(client);
    const validacao = validarBackupEstrutural(payload, colunasAtuais);
    const atuais = await contagensAtuaisRestauracao(client);
    const pendentes = [...validacao.dados.lembrete_envios, ...validacao.dados.whatsapp_envios, ...validacao.dados.email_envios]
      .filter(x => ['PENDENTE','PROCESSANDO'].includes(String(x.status || '').toUpperCase())).length;
    res.json({
      ok: true,
      digest,
      arquivo: {
        tipo: payload.tipo,
        versao_backup: payload.versao_backup,
        app_version: payload.app_version,
        gerado_em: payload.gerado_em || null,
        timezone_aplicacao: payload.timezone_aplicacao || null
      },
      total_registros: validacao.total,
      contagens: validacao.contagens,
      contagens_atuais: atuais,
      usuarios_preservados: true,
      credenciais_restauradas: false,
      automacoes_serao_desativadas: true,
      filas_pendentes_serao_canceladas: pendentes > 0,
      aviso: 'A restauração substituirá os dados operacionais atuais. Usuários/senhas serão preservados e WhatsApp/e-mail automáticos ficarão desligados após a operação.'
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao validar o backup.' });
  } finally {
    client.release();
  }
});

app.post('/api/backup/restaurar/executar', async (req, res) => {
  if (!usuarioEhAdmin(req)) return res.status(403).json({ error: 'Somente o administrador pode executar uma restauração.' });
  const confirmacao = String(req.get('X-AutoAgenda-Restore-Confirmation') || '').trim().toUpperCase();
  if (confirmacao !== 'RESTAURAR') return res.status(400).json({ error: 'Confirmação de restauração inválida.' });

  const client = await pool.connect();
  try {
    const { payload, digest } = lerPayloadRestauracao(req);
    const digestEsperado = String(req.get('X-AutoAgenda-Backup-Digest') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digestEsperado) || digest !== digestEsperado) {
      throw erroHttp(409, 'O arquivo mudou depois da análise. Analise o backup novamente antes de restaurar.');
    }

    const colunasAtuais = await colunasAtuaisRestauracao(client);
    const validacao = validarBackupEstrutural(payload, colunasAtuais);
    await client.query('BEGIN');
    try {
      const detalhes = await executarRestauracaoBackup(client, payload, validacao);
      await client.query('COMMIT');
      res.json({
        ok: true,
        restaurado: true,
        total_registros: validacao.total,
        contagens: validacao.contagens,
        usuarios_preservados: true,
        automacoes_desativadas: true,
        ...detalhes,
        mensagem: 'Backup restaurado com sucesso. As automações de WhatsApp e e-mail ficaram desativadas por segurança.'
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    }
  } catch (error) {
    console.error('Erro ao restaurar backup:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao restaurar o backup. Nenhuma alteração parcial foi mantida.' });
  } finally {
    client.release();
  }
});

// ========================= V2.3.5 — WHATSAPP: AULA DO DIA + PLANO COMPLETO SEPARADOS =========================
// Regra definida no AutoAgenda:
// 1) Botões de WhatsApp exibidos nas aulas enviam SOMENTE os dados daquela aula do dia.
// 2) Na aba "Planos automáticos", o botão "Enviar plano" envia o cronograma completo do plano.
// 3) Toda mensagem termina com aviso claro: falta sem justificativa desconta a aula do pacote.

const AVISO_FALTA_WHATSAPP =
  '⚠️ *IMPORTANTE:* Se o aluno faltar sem justificativa, a aula será contabilizada como realizada para fins de saldo e será descontada do pacote. Portanto, o aluno perderá essa aula.';

const ROTULO_STATUS_WHATSAPP = status => ({
  AGENDADA: '⏳ Agendada',
  CONFIRMADA: '✅ Confirmada',
  REALIZADA: '🏁 Realizada',
  REMARCADA: '🔄 Remarcada',
  CANCELADA: '❌ Cancelada',
  FALTOU: '🚫 Faltou — aula descontada'
})[String(status || '').toUpperCase()] || String(status || '');

const CONFIRMACAO_STATUS_PERMITIDOS = ['AGUARDANDO','CONFIRMADA','PEDIU_REAGENDAMENTO'];
function normalizarConfirmacaoStatus(valor, fallback = 'AGUARDANDO') {
  const v = String(valor || '').trim().toUpperCase();
  if (CONFIRMACAO_STATUS_PERMITIDOS.includes(v)) return v;
  return CONFIRMACAO_STATUS_PERMITIDOS.includes(fallback) ? fallback : '';
}

function aulaSemMetadadosToken(row) {
  if (!row || typeof row !== 'object') return row;
  const { confirmacao_token_hash, confirmacao_token_expira_em, confirmacao_token_usado_em, ...segura } = row;
  return segura;
}


function gerarTokenConfirmacaoAluno() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenConfirmacaoFormatoValido(token) {
  return /^[A-Za-z0-9_-]{40,100}$/.test(String(token || ''));
}

function escaparHtmlPublico(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function basePublicaAutoAgenda(req) {
  const configurada = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configurada) {
    try {
      const u = new URL(configurada);
      if (['http:', 'https:'].includes(u.protocol)) return `${u.protocol}//${u.host}`;
    } catch {}
  }
  const host = String(req.get('host') || '').trim();
  if (!/^[A-Za-z0-9.:[\]-]+(?::\d+)?$/.test(host)) return '';
  return `${req.protocol}://${host}`;
}

function paginaConfirmacaoAluno({ aula = null, estado = 'ATIVA', mensagem = '' } = {}) {
  const status = String(aula?.confirmacao_status || 'AGUARDANDO').toUpperCase();
  const nomes = String(aula?.aluno_nome || '').trim();
  const primeiroNome = nomes.split(/\s+/)[0] || 'Aluno';
  const data = aula?.data_br || '';
  const hora = String(aula?.hora_inicio || '').slice(0, 5);
  const instrutor = aula?.instrutor_nome || 'A definir';
  const veiculo = aula?.veiculo_nome ? `${aula.veiculo_nome}${aula.veiculo_placa ? ` (${aula.veiculo_placa})` : ''}` : 'A definir';
  const local = aula?.local_nome || 'A definir';
  const token = String(aula?.token_publico || '');

  const titulo = estado === 'SUCESSO'
    ? (status === 'CONFIRMADA' ? 'Aula confirmada!' : 'Pedido registrado!')
    : estado === 'USADO'
      ? 'Resposta já registrada'
      : estado === 'INVALIDO'
        ? 'Link indisponível'
        : 'Confirme sua aula';

  let corpo = '';
  if (estado === 'ATIVA' && aula) {
    corpo = `
      <p class="intro">Olá, <strong>${escaparHtmlPublico(primeiroNome)}</strong>. Confira os dados abaixo e informe sua resposta.</p>
      <div class="card">
        <div><span>📅 Data</span><strong>${escaparHtmlPublico(data)}</strong></div>
        <div><span>🕐 Horário</span><strong>${escaparHtmlPublico(hora)}</strong></div>
        <div><span>👨‍🏫 Instrutor</span><strong>${escaparHtmlPublico(instrutor)}</strong></div>
        <div><span>🚗 Veículo</span><strong>${escaparHtmlPublico(veiculo)}</strong></div>
        <div><span>📍 Local</span><strong>${escaparHtmlPublico(local)}</strong></div>
      </div>
      <form method="post" action="/confirmar/${encodeURIComponent(token)}/acao">
        <button class="ok" type="submit" name="acao" value="CONFIRMADA">✅ CONFIRMAR AULA</button>
        <button class="change" type="submit" name="acao" value="PEDIU_REAGENDAMENTO">🔄 SOLICITAR REAGENDAMENTO</button>
      </form>
      <p class="note">Solicitar reagendamento <strong>não cancela a aula automaticamente</strong>. O instrutor ou administrador receberá o pedido e fará a alteração do horário no AutoAgenda.</p>`;
  } else {
    const textoPadrao = estado === 'USADO'
      ? (status === 'CONFIRMADA' ? 'Sua confirmação já foi registrada no AutoAgenda.' : status === 'PEDIU_REAGENDAMENTO' ? 'Seu pedido de reagendamento já foi registrado no AutoAgenda.' : 'Este link já foi utilizado.')
      : estado === 'SUCESSO'
        ? (status === 'CONFIRMADA' ? 'Sua presença foi confirmada no AutoAgenda.' : 'Seu pedido de reagendamento foi registrado. Aguarde o contato do instrutor ou da autoescola.')
        : 'Este link expirou, foi substituído ou não está mais disponível. Solicite um novo link ao instrutor ou à autoescola.';
    corpo = `<div class="result ${estado === 'INVALIDO' ? 'warn' : ''}">${escaparHtmlPublico(mensagem || textoPadrao)}</div>`;
    if (aula && data) {
      corpo += `<div class="mini">📅 ${escaparHtmlPublico(data)} às ${escaparHtmlPublico(hora)}${instrutor ? ` · 👨‍🏫 ${escaparHtmlPublico(instrutor)}` : ''}</div>`;
    }
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>${escaparHtmlPublico(titulo)} · AutoAgenda</title>
  <style>
    :root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:linear-gradient(180deg,#eef4ff,#f8fafc)}
    main{width:min(100%,520px);background:#fff;border:1px solid #e4e9f2;border-radius:24px;padding:26px;box-shadow:0 18px 55px rgba(25,42,70,.12)}
    .brand{font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#4169a8}.brand b{font-size:24px;display:block;letter-spacing:-.02em;text-transform:none;color:#172033;margin-top:5px}
    h1{font-size:28px;line-height:1.12;margin:24px 0 10px}.intro{color:#536176;line-height:1.55;margin:0 0 18px}
    .card{border:1px solid #e7ebf2;border-radius:18px;padding:7px 16px;margin:18px 0;background:#fafcff}.card div{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;padding:12px 0;border-bottom:1px solid #edf0f5}.card div:last-child{border-bottom:0}.card span{color:#69768a}.card strong{text-align:right;max-width:62%}
    form{display:grid;gap:11px;margin-top:20px}button{width:100%;border:0;border-radius:14px;padding:15px 16px;font-size:15px;font-weight:900;cursor:pointer}.ok{background:#177447;color:white}.change{background:#eef3fb;color:#244d86;border:1px solid #cfdbed}
    .note{font-size:13px;line-height:1.45;color:#69768a;margin:16px 2px 0}.result{padding:18px;border-radius:16px;background:#edf8f1;color:#145a37;line-height:1.55;font-weight:700}.result.warn{background:#fff4e8;color:#7b4a13}.mini{margin-top:14px;color:#68758a;font-size:14px;line-height:1.5}
    footer{margin-top:22px;color:#8792a3;font-size:12px;text-align:center}
    @media(max-width:420px){body{padding:12px}main{border-radius:18px;padding:20px}.card div{display:block}.card strong{display:block;max-width:none;text-align:left;margin-top:4px}h1{font-size:25px}}
  </style>
</head>
<body>
  <main>
    <div class="brand">Agenda de aulas<b>AutoAgenda</b></div>
    <h1>${escaparHtmlPublico(titulo)}</h1>
    ${corpo}
    <footer>Link individual de confirmação · Não compartilhe este endereço.</footer>
  </main>
</body>
</html>`;
}

async function consultarConfirmacaoPublica(token, { paraAtualizar = false, client = null } = {}) {
  if (!tokenConfirmacaoFormatoValido(token)) return null;
  const executor = client || pool;
  const tokenHash = hashSha256(token);
  const bloqueio = paraAtualizar ? 'FOR UPDATE OF a' : '';
  const r = await executor.query(`
    SELECT a.id, a.status, a.arquivada, a.confirmacao_status,
           a.confirmacao_token_expira_em, a.confirmacao_token_usado_em,
           TO_CHAR(a.data_aula, 'DD/MM/YYYY') AS data_br,
           TO_CHAR(a.hora_inicio, 'HH24:MI') AS hora_inicio,
           al.nome AS aluno_nome,
           i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa,
           l.nome AS local_nome
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id = a.aluno_id
    LEFT JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
    LEFT JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
    LEFT JOIN autoagenda.locais l ON l.id = a.local_id
    WHERE a.confirmacao_token_hash = $1
    LIMIT 1
    ${bloqueio}
  `, [tokenHash]);
  if (!r.rowCount) return null;
  return r.rows[0];
}

function estadoLinkConfirmacao(aula) {
  if (!aula) return 'INVALIDO';
  if (aula.confirmacao_token_usado_em) return 'USADO';
  if (aula.arquivada || !['AGENDADA','CONFIRMADA'].includes(String(aula.status || '').toUpperCase())) return 'INVALIDO';
  const expira = aula.confirmacao_token_expira_em ? new Date(aula.confirmacao_token_expira_em).getTime() : 0;
  if (!expira || expira <= Date.now()) return 'INVALIDO';
  return 'ATIVA';
}

// Página pública: o token funciona como credencial de uso único e não exige login.
// Nenhum dado administrativo, telefone, e-mail ou documento do aluno é exposto aqui.
app.get('/confirmar/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const aula = await consultarConfirmacaoPublica(token);
    const estado = estadoLinkConfirmacao(aula);
    if (aula) aula.token_publico = token;
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(paginaConfirmacaoAluno({ aula, estado }));
  } catch (error) {
    console.error('Erro ao abrir confirmação pública:', error);
    res.status(500).type('html').send(paginaConfirmacaoAluno({ estado: 'INVALIDO', mensagem: 'Não foi possível abrir a confirmação agora. Tente novamente.' }));
  }
});

app.post('/confirmar/:token/acao', async (req, res) => {
  const client = await pool.connect();
  try {
    const token = String(req.params.token || '');
    const acao = normalizarConfirmacaoStatus(req.body?.acao, '');
    if (!['CONFIRMADA','PEDIU_REAGENDAMENTO'].includes(acao)) {
      return res.status(400).type('html').send(paginaConfirmacaoAluno({ estado: 'INVALIDO', mensagem: 'Resposta inválida.' }));
    }

    await client.query('BEGIN');
    const aula = await consultarConfirmacaoPublica(token, { paraAtualizar: true, client });
    const estado = estadoLinkConfirmacao(aula);
    if (estado !== 'ATIVA') {
      await client.query('ROLLBACK');
      return res.status(409).type('html').send(paginaConfirmacaoAluno({ aula, estado }));
    }

    const atualizado = await client.query(`
      UPDATE autoagenda.aulas
      SET confirmacao_status=$1,
          confirmacao_origem='WHATSAPP',
          confirmacao_atualizada_em=NOW(),
          confirmacao_token_usado_em=NOW(),
          atualizado_em=NOW()
      WHERE id=$2
        AND confirmacao_token_hash=$3
        AND confirmacao_token_usado_em IS NULL
      RETURNING confirmacao_status
    `, [acao, aula.id, hashSha256(token)]);

    if (!atualizado.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).type('html').send(paginaConfirmacaoAluno({ aula, estado: 'USADO' }));
    }

    await client.query('COMMIT');
    aula.confirmacao_status = atualizado.rows[0].confirmacao_status;
    aula.confirmacao_token_usado_em = new Date();
    return res.type('html').send(paginaConfirmacaoAluno({ aula, estado: 'SUCESSO' }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Erro ao registrar confirmação pública:', error);
    return res.status(500).type('html').send(paginaConfirmacaoAluno({ estado: 'INVALIDO', mensagem: 'Não foi possível registrar sua resposta agora. Tente novamente.' }));
  } finally {
    client.release();
  }
});

app.get('/whatsapp/aula/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).type('text/plain; charset=utf-8').send('Aula inválida.');
    }
    if (req.usuario?.perfil === 'INSTRUTOR' && !instrutorEscopo) {
      return res.status(403).type('text/plain; charset=utf-8').send('Conta de instrutor sem vínculo operacional.');
    }

    const result = await query(`
      SELECT a.id,
             TO_CHAR(a.data_aula, 'DD/MM/YYYY') AS data_br,
             TO_CHAR(a.hora_inicio, 'HH24:MI') AS hora_inicio,
             a.status, a.arquivada,
             al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp,
             i.nome AS instrutor_nome,
             v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             l.nome AS local_nome
      FROM autoagenda.aulas a
      JOIN autoagenda.alunos al ON al.id = a.aluno_id
      LEFT JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
      LEFT JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
      LEFT JOIN autoagenda.locais l ON l.id = a.local_id
      WHERE a.id = $1
        AND ($2::int = 0 OR a.instrutor_id = $2)
    `, [id, instrutorEscopo]);

    if (!result.rowCount) {
      return res.status(404).type('text/plain; charset=utf-8').send('Aula não encontrada.');
    }

    const aula = result.rows[0];
    if (aula.arquivada || !['AGENDADA', 'CONFIRMADA'].includes(String(aula.status || '').toUpperCase())) {
      return res.status(400).type('text/plain; charset=utf-8')
        .send('O WhatsApp só está disponível para aulas agendadas ou confirmadas.');
    }

    const telefone = normalizarWhatsAppParaLink(aula.aluno_whatsapp);
    if (!telefone) {
      return res.status(400).type('text/plain; charset=utf-8')
        .send('Este aluno não possui um WhatsApp válido cadastrado. Edite o aluno e informe o número com DDD, por exemplo: (69) 99999-9999.');
    }

    const tokenConfirmacao = gerarTokenConfirmacaoAluno();
    const tokenHash = hashSha256(tokenConfirmacao);
    await query(`
      UPDATE autoagenda.aulas
      SET confirmacao_token_hash=$1,
          confirmacao_token_expira_em=GREATEST(NOW() + INTERVAL '48 hours', data_aula::timestamp + hora_inicio + INTERVAL '1 day'),
          confirmacao_token_usado_em=NULL,
          atualizado_em=NOW()
      WHERE id=$2
    `, [tokenHash, id]);

    const basePublica = basePublicaAutoAgenda(req);
    if (!basePublica) {
      return res.status(500).type('text/plain; charset=utf-8')
        .send('Não foi possível montar o link de confirmação. Configure PUBLIC_BASE_URL no Render.');
    }
    const linkConfirmacao = `${basePublica}/confirmar/${tokenConfirmacao}`;

    const texto = `Olá, ${aula.aluno_nome}! Seguem os dados da sua aula prática:\n\n` +
      `📅 Data: ${String(aula.data_br || '').trim()}\n` +
      `🕐 Horário: ${String(aula.hora_inicio || '').slice(0,5)}\n` +
      `👨‍🏫 Instrutor: ${aula.instrutor_nome || 'a definir'}\n` +
      `🚗 Veículo: ${aula.veiculo_nome || 'a definir'}${aula.veiculo_placa ? ` (${aula.veiculo_placa})` : ''}\n` +
      `📍 Local: ${aula.local_nome || 'a definir'}\n\n` +
      `✅ Confirme sua aula ou solicite reagendamento neste link individual:\n${linkConfirmacao}\n\n` +
      `${AVISO_FALTA_WHATSAPP}`;

    const destino = `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, destino);
  } catch (error) {
    console.error('Erro ao abrir WhatsApp da aula:', error);
    return res.status(500).type('text/plain; charset=utf-8').send('Erro ao preparar o WhatsApp. Tente novamente.');
  }
});

app.get('/whatsapp/plano/:id', async (req, res) => {
  try {
    if (req.usuario?.perfil === 'INSTRUTOR') {
      return res.status(403).type('text/plain; charset=utf-8').send('O envio do plano completo é restrito ao administrador.');
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).type('text/plain; charset=utf-8').send('Plano inválido.');
    }

    const planoQ = await query(`
      SELECT p.id, p.total_aulas, p.aulas_por_encontro, p.ativo,
             TO_CHAR(p.data_inicio, 'DD/MM/YYYY') AS data_inicio_br,
             al.nome AS aluno_nome, al.whatsapp AS aluno_whatsapp, al.categoria AS aluno_categoria,
             i.nome AS instrutor_nome,
             v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             l.nome AS local_nome
      FROM autoagenda.planos_aula p
      JOIN autoagenda.alunos al ON al.id = p.aluno_id
      LEFT JOIN autoagenda.instrutores i ON i.id = p.instrutor_id
      LEFT JOIN autoagenda.veiculos v ON v.id = p.veiculo_id
      LEFT JOIN autoagenda.locais l ON l.id = p.local_id
      WHERE p.id = $1
    `, [id]);

    if (!planoQ.rowCount) {
      return res.status(404).type('text/plain; charset=utf-8').send('Plano não encontrado.');
    }

    const plano = planoQ.rows[0];
    const telefone = normalizarWhatsAppParaLink(plano.aluno_whatsapp);
    if (!telefone) {
      return res.status(400).type('text/plain; charset=utf-8')
        .send('Este aluno não possui um WhatsApp válido cadastrado. Edite o aluno e informe o número com DDD, por exemplo: (69) 99999-9999.');
    }

    const cronogramaQ = await query(`
      SELECT a.id, a.plan_id, a.numero_plano, a.reposicao_de_id, a.excecao_plano,
             TO_CHAR(a.data_aula, 'DD/MM/YYYY') AS data_br,
             TO_CHAR(a.hora_inicio, 'HH24:MI') AS hora_inicio,
             a.status, a.aulas_unidades,
             i.nome AS instrutor_nome,
             v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             l.nome AS local_nome
      FROM autoagenda.aulas a
      LEFT JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
      LEFT JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
      LEFT JOIN autoagenda.locais l ON l.id = a.local_id
      WHERE a.arquivada = FALSE
        AND (
          a.plan_id = $1
          OR a.reposicao_de_id IN (
            SELECT origem.id
            FROM autoagenda.aulas origem
            WHERE origem.plan_id = $1
          )
        )
      ORDER BY a.data_aula, a.hora_inicio, a.id
    `, [id]);

    const cronograma = cronogramaQ.rows;
    if (!cronograma.length) {
      return res.status(400).type('text/plain; charset=utf-8').send('Este plano ainda não possui aulas geradas para enviar.');
    }

    const linhas = cronograma.map((x, idx) => {
      const unidades = Math.max(1, Number(x.aulas_unidades || 1));
      const detalheUnidades = unidades > 1 ? ` — ${unidades} aulas` : '';
      const especial = x.reposicao_de_id ? ' ↪️ Reposição' : (x.excecao_plano ? ' • horário alterado' : '');
      return `${idx + 1}. ${x.data_br} às ${String(x.hora_inicio || '').slice(0,5)}${detalheUnidades} — ${ROTULO_STATUS_WHATSAPP(x.status)}${especial}`;
    }).join('\n');

    const texto = `Olá, ${plano.aluno_nome}! Segue seu *plano completo de aulas práticas*:\n\n` +
      `🚘 Categoria: ${plano.aluno_categoria || 'a definir'}\n` +
      `📚 Total do plano: ${Number(plano.total_aulas || 0)} aula(s)\n` +
      `👨‍🏫 Instrutor: ${plano.instrutor_nome || 'a definir'}\n` +
      `🚗 Veículo: ${plano.veiculo_nome || 'a definir'}${plano.veiculo_placa ? ` (${plano.veiculo_placa})` : ''}\n` +
      `📍 Local: ${plano.local_nome || 'a definir'}\n\n` +
      `📅 *CRONOGRAMA COMPLETO*\n${linhas}\n\n` +
      `${AVISO_FALTA_WHATSAPP}`;

    const destino = `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, destino);
  } catch (error) {
    console.error('Erro ao abrir WhatsApp do plano:', error);
    return res.status(500).type('text/plain; charset=utf-8').send('Erro ao preparar o plano para WhatsApp. Tente novamente.');
  }
});

// ========================= AULAS =========================
app.get('/api/aulas', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;
    const instrutorEscopo = instrutorIdDaSessao(req);
    const incluirArquivadas = usuarioEhAdmin(req)
      && ['1','true','sim'].includes(String(req.query?.incluir_arquivadas || '').toLowerCase());
    const params = [];
    const condicoes = [];
    if (instrutorEscopo) {
      params.push(instrutorEscopo);
      condicoes.push(`a.instrutor_id = $${params.length}`);
    }
    if (!incluirArquivadas) condicoes.push('a.arquivada = FALSE');
    if (data_inicio && data_fim) {
      params.push(data_inicio, data_fim);
      condicoes.push(`a.data_aula BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    const filtro = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const result = await query(`
      SELECT a.id, a.aluno_id, al.nome AS aluno_nome,
             a.instrutor_id, i.nome AS instrutor_nome,
             a.veiculo_id, v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             a.local_id, l.nome AS local_nome, l.endereco AS local_endereco,
             a.data_aula, a.hora_inicio, a.duracao_minutos,
             a.status, a.observacoes, a.criado_em,
             a.plan_id, a.numero_plano, a.aulas_unidades, a.excecao_plano,
             a.arquivada, a.arquivada_em, a.reposicao_de_id,
             origem.data_aula AS reposicao_data_original,
             origem.hora_inicio AS reposicao_hora_original,
             COALESCE((
               SELECT MIN(r.id)
               FROM autoagenda.aulas r
               WHERE r.reposicao_de_id = a.id
                 AND r.arquivada = FALSE
                 AND r.status IN ('AGENDADA','CONFIRMADA','REALIZADA')
             ), 0)::int AS reposicao_id_ativa
      FROM autoagenda.aulas a
      JOIN autoagenda.alunos al ON al.id = a.aluno_id
      JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
      JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
      JOIN autoagenda.locais l ON l.id = a.local_id
      LEFT JOIN autoagenda.aulas origem ON origem.id = a.reposicao_de_id
      ${filtro}
      ORDER BY a.data_aula, a.hora_inicio
    `, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar aulas.' });
  }
});

app.get('/api/aulas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    const r = await query(`
      SELECT a.*, al.nome AS aluno_nome,
             i.nome AS instrutor_nome, v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             l.nome AS local_nome, l.endereco AS local_endereco,
             origem.data_aula AS reposicao_data_original,
             origem.hora_inicio AS reposicao_hora_original,
             COALESCE((
               SELECT MIN(r.id)
               FROM autoagenda.aulas r
               WHERE r.reposicao_de_id = a.id
                 AND r.arquivada = FALSE
                 AND r.status IN ('AGENDADA','CONFIRMADA','REALIZADA')
             ), 0)::int AS reposicao_id_ativa
      FROM autoagenda.aulas a
      JOIN autoagenda.alunos al ON al.id=a.aluno_id
      JOIN autoagenda.instrutores i ON i.id=a.instrutor_id
      JOIN autoagenda.veiculos v ON v.id=a.veiculo_id
      JOIN autoagenda.locais l ON l.id=a.local_id
      LEFT JOIN autoagenda.aulas origem ON origem.id=a.reposicao_de_id
      WHERE a.id=$1
        AND ($2::int = 0 OR a.instrutor_id=$2)
    `, [id, instrutorEscopo]);
    if (!r.rowCount) return res.status(404).json({ error:'Aula não encontrada.' });
    res.json(aulaSemMetadadosToken(r.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error:'Erro ao consultar aula.' });
  }
});

app.post('/api/aulas', async (req, res) => {
  const client = await pool.connect();
  try {
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos = null,
            aulas_unidades = 1, status = 'AGENDADA', confirmacao_status = null, observacoes = '' } = req.body;
    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }
    const statusFinal = ['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'].includes(status) ? status : 'AGENDADA';
    const confirmacaoFinal = normalizarConfirmacaoStatus(confirmacao_status, statusFinal === 'CONFIRMADA' ? 'CONFIRMADA' : 'AGUARDANDO');
    const unidadesFinal = Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4));
    validarDataParaStatus(data_aula, statusFinal);

    await client.query('BEGIN');
    const configFuncionamento = await obterConfigFuncionamento(client);
    const duracaoFinal = validarInteiroPositivo(duracao_minutos, configFuncionamento.duracao_padrao_minutos, 480);
    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos: duracaoFinal };
    await bloquearChavesTransacao(client, chavesAgenda(dados));
    await validarRecursosAtivos(client, { instrutor_id, veiculo_id, local_id });

    if (['AGENDADA','CONFIRMADA'].includes(statusFinal)) {
      await validarHorarioFuncionamento(client, dados, configFuncionamento);
      await validarDisponibilidadeInstrutor(client, instrutor_id, dados, configFuncionamento);
      await validarDisponibilidadeVeiculo(client, veiculo_id, dados);
    }
    await validarSaldoAula(client, { aluno_id, status:statusFinal, data_aula, aulas_unidades:unidadesFinal });

    if (['AGENDADA','CONFIRMADA'].includes(statusFinal)) {
      const conflito = await verificarConflito(client, dados, [], configFuncionamento.intervalo_minutos);
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Conflito de horário.', conflito: conflito.rows[0] });
      }
    }

    const result = await client.query(`
      INSERT INTO autoagenda.aulas
        (aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
         duracao_minutos, status, confirmacao_status, confirmacao_origem, confirmacao_atualizada_em,
         observacoes, aulas_unidades, arquivada)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',NOW(),$10,$11,FALSE)
      RETURNING *
    `, [
      Number(aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id), data_aula,
      String(hora_inicio).slice(0, 5), duracaoFinal, statusFinal, confirmacaoFinal, observacoes || '', unidadesFinal
    ]);

    await client.query('COMMIT');
    dispararEmailAulaSeguro(result.rows[0].id, 'AGENDAMENTO', String(result.rows[0].criado_em || ''));
    dispararWhatsAppAulaSeguro(result.rows[0].id, 'AGENDAMENTO', String(result.rows[0].criado_em || ''));
    res.status(201).json(aulaSemMetadadosToken(result.rows[0]));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao agendar aula.' });
  } finally { client.release(); }
});


// ========================= V2.1 — REAGENDAMENTO INTELIGENTE =========================
// Cria uma nova aula vinculada à aula cancelada/faltada, preservando integralmente o histórico.
app.post('/api/aulas/:id/reposicao', async (req, res) => {
  const client = await pool.connect();
  try {
    const origemId = Number(req.params.id);
    const instrutorEscopo = instrutorIdDaSessao(req);
    const { instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
            duracao_minutos = null, aulas_unidades = null, observacoes = '' } = req.body || {};
    const instrutorIdFinal = instrutorEscopo || Number(instrutor_id);
    if (!Number.isInteger(origemId) || origemId < 1) throw erroHttp(400, 'Aula original inválida.');
    if (!instrutorIdFinal || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      throw erroHttp(400, 'Preencha instrutor, veículo, local, data e horário da reposição.');
    }

    await client.query('BEGIN');
    const origemQ = await client.query(
      `SELECT * FROM autoagenda.aulas
       WHERE id=$1 AND ($2::int=0 OR instrutor_id=$2)
       FOR UPDATE`,
      [origemId, instrutorEscopo]
    );
    if (!origemQ.rowCount) throw erroHttp(404, 'Aula original não encontrada.');
    const origem = origemQ.rows[0];
    if (String(origem.status || '').toUpperCase() !== 'CANCELADA') {
      throw erroHttp(409, 'A reposição sem perda da aula só pode ser criada para uma aula CANCELADA. FALTOU representa falta sem justificativa e a aula é descontada do pacote.');
    }

    const reposicaoExistente = await client.query(`
      SELECT id, data_aula, hora_inicio, status
      FROM autoagenda.aulas
      WHERE reposicao_de_id=$1
        AND arquivada=FALSE
        AND status IN ('AGENDADA','CONFIRMADA','REALIZADA')
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `, [origemId]);
    if (reposicaoExistente.rowCount) {
      const r = reposicaoExistente.rows[0];
      throw erroHttp(409, `Esta aula já possui reposição ativa em ${String(r.data_aula).slice(0,10)} às ${String(r.hora_inicio).slice(0,5)}.`);
    }

    const config = await obterConfigFuncionamento(client);
    const duracaoFinal = validarInteiroPositivo(duracao_minutos, Number(origem.duracao_minutos || config.duracao_padrao_minutos), 480);
    const unidadesFinal = Math.min(4, validarInteiroPositivo(aulas_unidades, Number(origem.aulas_unidades || 1), 4));
    validarDataParaStatus(data_aula, 'AGENDADA');

    const dados = {
      aluno_id: Number(origem.aluno_id),
      instrutor_id: Number(instrutorIdFinal),
      veiculo_id: Number(veiculo_id),
      data_aula,
      hora_inicio,
      duracao_minutos: duracaoFinal
    };
    await bloquearChavesTransacao(client, chavesAgenda(dados));
    await validarRecursosAtivos(client, {
      aluno_id: Number(origem.aluno_id),
      instrutor_id: Number(instrutorIdFinal),
      veiculo_id: Number(veiculo_id),
      local_id: Number(local_id)
    });
    await validarHorarioFuncionamento(client, dados, config);
    await validarDisponibilidadeInstrutor(client, Number(instrutorIdFinal), dados, config);
    await validarDisponibilidadeVeiculo(client, Number(veiculo_id), dados);
    await validarSaldoAula(client, {
      aluno_id: Number(origem.aluno_id),
      status: 'AGENDADA',
      data_aula,
      aulas_unidades: unidadesFinal
    });

    const conflito = await verificarConflito(client, dados, [], config.intervalo_minutos);
    if (conflito.rowCount) {
      throw erroHttp(409, 'Conflito de horário para a reposição. Escolha outro horário.');
    }

    const textoOrigem = `Reposição da aula de ${String(origem.data_aula).slice(0,10)} às ${String(origem.hora_inicio).slice(0,5)}.`;
    const observacoesFinal = String(observacoes || '').trim()
      ? `${String(observacoes).trim()}\n${textoOrigem}`
      : textoOrigem;

    const result = await client.query(`
      INSERT INTO autoagenda.aulas
        (aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
         duracao_minutos, status, observacoes, aulas_unidades, arquivada, reposicao_de_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'AGENDADA',$8,$9,FALSE,$10)
      RETURNING *
    `, [
      Number(origem.aluno_id), Number(instrutorIdFinal), Number(veiculo_id), Number(local_id),
      data_aula, String(hora_inicio).slice(0,5), duracaoFinal, observacoesFinal, unidadesFinal, origemId
    ]);

    await client.query('COMMIT');
    dispararEmailAulaSeguro(result.rows[0].id, 'AGENDAMENTO', String(result.rows[0].criado_em || ''));
    dispararWhatsAppAulaSeguro(result.rows[0].id, 'AGENDAMENTO', String(result.rows[0].criado_em || ''));
    res.status(201).json({ ...aulaSemMetadadosToken(result.rows[0]), aula_original_id: origemId });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao criar reposição.' });
  } finally { client.release(); }
});

// Edita apenas esta aula. Em aula de plano, registra como exceção.
app.put('/api/aulas/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
            duracao_minutos = 50, aulas_unidades = 1, status = 'AGENDADA',
            confirmacao_status = null, observacoes = '' } = req.body;
    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }
    const statusPermitidos = ['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'];
    if (!statusPermitidos.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    validarDataParaStatus(data_aula, status);

    await client.query('BEGIN');
    const existente = await client.query('SELECT * FROM autoagenda.aulas WHERE id=$1 FOR UPDATE', [id]);
    if (!existente.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Aula não encontrada.' });
    }
    const antiga = existente.rows[0];
    const confirmacaoFinal = normalizarConfirmacaoStatus(
      confirmacao_status,
      normalizarConfirmacaoStatus(antiga.confirmacao_status, String(antiga.status || '').toUpperCase() === 'CONFIRMADA' ? 'CONFIRMADA' : 'AGUARDANDO')
    );
    const mudouAgendamentoEmail =
      dateOnlyUTC(antiga.data_aula).toISOString().slice(0,10) !== String(data_aula).slice(0,10)
      || String(antiga.hora_inicio || '').slice(0,5) !== String(hora_inicio).slice(0,5)
      || Number(antiga.instrutor_id) !== Number(instrutor_id)
      || Number(antiga.veiculo_id) !== Number(veiculo_id)
      || Number(antiga.local_id) !== Number(local_id);
    const cancelouEmail = String(antiga.status || '').toUpperCase() !== 'CANCELADA' && status === 'CANCELADA';
    if (antiga.arquivada) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Esta aula está arquivada e não pode ser alterada.' });
    }

    const configFuncionamento = await obterConfigFuncionamento(client);
    const duracaoFinal = validarInteiroPositivo(duracao_minutos, Number(antiga.duracao_minutos) || configFuncionamento.duracao_padrao_minutos, 480);
    const unidadesFinal = Math.min(4, validarInteiroPositivo(aulas_unidades, Number(antiga.aulas_unidades) || 1, 4));
    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos:duracaoFinal };
    await bloquearChavesTransacao(client, chavesAgenda(dados));

    await validarRecursosAtivos(client, { instrutor_id, veiculo_id, local_id }, {
      instrutor_id: antiga.instrutor_id, veiculo_id: antiga.veiculo_id, local_id: antiga.local_id
    });

    if (['AGENDADA','CONFIRMADA'].includes(status)) {
      await validarHorarioFuncionamento(client, dados, configFuncionamento);
      await validarDisponibilidadeInstrutor(client, instrutor_id, dados, configFuncionamento);
      await validarDisponibilidadeVeiculo(client, veiculo_id, dados);
    }
    await validarSaldoAula(client, { aluno_id, status, data_aula, aulas_unidades:unidadesFinal }, [id]);

    if (['AGENDADA','CONFIRMADA'].includes(status)) {
      const conflito = await verificarConflito(client, dados, [id], configFuncionamento.intervalo_minutos);
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error:'Conflito de horário.', conflito:conflito.rows[0] });
      }
    }

    const result = await client.query(`
      UPDATE autoagenda.aulas
      SET aluno_id=$1, instrutor_id=$2, veiculo_id=$3, local_id=$4,
          data_aula=$5, hora_inicio=$6, duracao_minutos=$7,
          lembrete_dia_anterior_enviado=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time THEN FALSE ELSE lembrete_dia_anterior_enviado END,
          lembrete_dia_anterior_enviado_em=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time THEN NULL ELSE lembrete_dia_anterior_enviado_em END,
          lembrete_horas_antes_enviado=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time THEN FALSE ELSE lembrete_horas_antes_enviado END,
          lembrete_horas_antes_enviado_em=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time THEN NULL ELSE lembrete_horas_antes_enviado_em END,
          aulas_unidades=$8, status=$9,
          confirmacao_status=$10,
          confirmacao_origem=CASE WHEN confirmacao_status IS DISTINCT FROM $10 THEN 'MANUAL' ELSE confirmacao_origem END,
          confirmacao_atualizada_em=CASE WHEN confirmacao_status IS DISTINCT FROM $10 THEN NOW() ELSE confirmacao_atualizada_em END,
          confirmacao_token_hash=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time OR instrutor_id IS DISTINCT FROM $2::int OR veiculo_id IS DISTINCT FROM $3::int OR local_id IS DISTINCT FROM $4::int OR confirmacao_status IS DISTINCT FROM $10 THEN NULL ELSE confirmacao_token_hash END,
          confirmacao_token_expira_em=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time OR instrutor_id IS DISTINCT FROM $2::int OR veiculo_id IS DISTINCT FROM $3::int OR local_id IS DISTINCT FROM $4::int OR confirmacao_status IS DISTINCT FROM $10 THEN NULL ELSE confirmacao_token_expira_em END,
          confirmacao_token_usado_em=CASE WHEN data_aula IS DISTINCT FROM $5::date OR hora_inicio IS DISTINCT FROM $6::time OR instrutor_id IS DISTINCT FROM $2::int OR veiculo_id IS DISTINCT FROM $3::int OR local_id IS DISTINCT FROM $4::int OR confirmacao_status IS DISTINCT FROM $10 THEN NULL ELSE confirmacao_token_usado_em END,
          observacoes=$11,
          excecao_plano=CASE WHEN plan_id IS NULL THEN FALSE ELSE TRUE END,
          atualizado_em=NOW()
      WHERE id=$12
      RETURNING *
    `, [Number(aluno_id),Number(instrutor_id),Number(veiculo_id),Number(local_id),data_aula,
        String(hora_inicio).slice(0,5),duracaoFinal,unidadesFinal,status,confirmacaoFinal,observacoes||'',id]);

    await client.query('COMMIT');
    if (cancelouEmail) {
      dispararEmailAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].atualizado_em || Date.now()));
      dispararWhatsAppAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].atualizado_em || Date.now()));
    } else if (mudouAgendamentoEmail && ['AGENDADA','CONFIRMADA'].includes(status)) {
      dispararEmailAulaSeguro(id, 'REAGENDAMENTO', String(result.rows[0].atualizado_em || Date.now()));
      dispararWhatsAppAulaSeguro(id, 'REAGENDAMENTO', String(result.rows[0].atualizado_em || Date.now()));
    }
    res.json(aulaSemMetadadosToken(result.rows[0]));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error:error.statusCode ? error.message : 'Erro ao atualizar aula.' });
  } finally { client.release(); }
});

// Edita esta aula e desloca todas as próximas do mesmo plano pelo mesmo intervalo.
app.put('/api/aulas/:id/serie', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const payload = req.body || {};
    if (!payload.data_aula || !payload.hora_inicio || !payload.instrutor_id || !payload.veiculo_id || !payload.local_id) {
      return res.status(400).json({ error:'Preencha os dados da alteração.' });
    }
    if (payload.status && !['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'].includes(payload.status)) {
      return res.status(400).json({ error:'Status inválido.' });
    }
    if (String(payload.data_aula).slice(0,10) < hojeApp()) {
      return res.status(400).json({ error:'Uma alteração em série não pode deslocar as próximas aulas para uma data passada.' });
    }

    await client.query('BEGIN');
    const atual = await client.query('SELECT * FROM autoagenda.aulas WHERE id=$1 FOR UPDATE', [id]);
    if (!atual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Aula não encontrada.' });
    }
    const alvo = atual.rows[0];
    if (alvo.arquivada) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Esta aula está arquivada.' });
    }
    if (!alvo.plan_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'Esta aula não pertence a um plano automático.' });
    }

    await validarRecursosAtivos(client, payload);
    const configFuncionamento = await obterConfigFuncionamento(client);
    const antigoDT = dateTimeUTC(alvo.data_aula, alvo.hora_inicio);
    const novoDT = dateTimeUTC(payload.data_aula, payload.hora_inicio);
    const delta = novoDT.getTime() - antigoDT.getTime();
    const deltaDias = Math.round((dateOnlyUTC(payload.data_aula).getTime() - dateOnlyUTC(alvo.data_aula).getTime()) / 86400000);

    const planoQ = await client.query('SELECT dias_semana FROM autoagenda.planos_aula WHERE id=$1 FOR UPDATE', [alvo.plan_id]);
    if (!planoQ.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Plano automático não encontrado.' });
    }
    const diasAtuais = Array.isArray(planoQ.rows[0].dias_semana) ? planoQ.rows[0].dias_semana.map(Number) : [];
    const novosDias = Array.from(new Set(diasAtuais.map(d => ((d + deltaDias) % 7 + 7) % 7))).sort((a,b)=>a-b);

    const afetadasQ = await client.query(`
      SELECT * FROM autoagenda.aulas
      WHERE plan_id=$1 AND arquivada=FALSE
        AND (data_aula + hora_inicio) >= $2::timestamp
        AND status IN ('AGENDADA','CONFIRMADA')
      ORDER BY data_aula, hora_inicio
    `, [alvo.plan_id, `${String(alvo.data_aula).slice(0,10)} ${String(alvo.hora_inicio).slice(0,8)}`]);
    const afetadas = afetadasQ.rows;
    const ids = afetadas.map(a=>Number(a.id));
    if (!afetadas.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'Não há aulas futuras deste plano para alterar.' });
    }

    const novas = afetadas.map(a => {
      const dt = dateTimeUTC(a.data_aula, a.hora_inicio);
      const novo = new Date(dt.getTime()+delta);
      const isAlvo = Number(a.id)===id;
      return {
        ...a,
        data_aula_nova:isoDateUTC(novo), hora_inicio_nova:hhmmUTC(novo),
        instrutor_id_novo:Number(payload.instrutor_id), veiculo_id_novo:Number(payload.veiculo_id), local_id_novo:Number(payload.local_id),
        duracao_minutos_nova:isAlvo ? validarInteiroPositivo(payload.duracao_minutos,Number(a.duracao_minutos),480) : Number(a.duracao_minutos),
        aulas_unidades_nova:isAlvo ? Math.min(4,validarInteiroPositivo(payload.aulas_unidades,Number(a.aulas_unidades)||1,4)) : Number(a.aulas_unidades||1)
      };
    });

    const chaves=[];
    for (const n of novas) chaves.push(...chavesAgenda({ aluno_id:n.aluno_id,instrutor_id:n.instrutor_id_novo,veiculo_id:n.veiculo_id_novo,data_aula:n.data_aula_nova }));
    await bloquearChavesTransacao(client,chaves);

    const alvoNovo = novas.find(n=>Number(n.id)===id);
    const statusAlvo = payload.status || alvo.status;
    const confirmacaoAlvo = normalizarConfirmacaoStatus(
      payload.confirmacao_status,
      normalizarConfirmacaoStatus(alvo.confirmacao_status, String(alvo.status || '').toUpperCase() === 'CONFIRMADA' ? 'CONFIRMADA' : 'AGUARDANDO')
    );
    await validarSaldoAula(client,{ aluno_id:alvo.aluno_id,status:statusAlvo,data_aula:alvoNovo.data_aula_nova,aulas_unidades:alvoNovo.aulas_unidades_nova },[id]);

    for (const n of novas) {
      const isAlvo = Number(n.id)===id;
      const statusNovo = isAlvo ? statusAlvo : n.status;
      const dadosDisponibilidade={ data_aula:n.data_aula_nova,hora_inicio:n.hora_inicio_nova,duracao_minutos:n.duracao_minutos_nova };
      if (['AGENDADA','CONFIRMADA'].includes(statusNovo)) {
        await validarHorarioFuncionamento(client,dadosDisponibilidade,configFuncionamento);
        await validarDisponibilidadeInstrutor(client,n.instrutor_id_novo,dadosDisponibilidade,configFuncionamento);
        await validarDisponibilidadeVeiculo(client,n.veiculo_id_novo,dadosDisponibilidade);
        const conflito=await verificarConflito(client,{ aluno_id:n.aluno_id,instrutor_id:n.instrutor_id_novo,veiculo_id:n.veiculo_id_novo,data_aula:n.data_aula_nova,hora_inicio:n.hora_inicio_nova,duracao_minutos:n.duracao_minutos_nova },ids,configFuncionamento.intervalo_minutos);
        if (conflito.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error:`Conflito ao alterar a série em ${n.data_aula_nova} às ${n.hora_inicio_nova}.`, conflito:conflito.rows[0] });
        }
      }
    }

    for (const n of novas) {
      const isAlvo=Number(n.id)===id;
      await client.query(`
        UPDATE autoagenda.aulas
        SET instrutor_id=$1,veiculo_id=$2,local_id=$3,data_aula=$4,hora_inicio=$5,duracao_minutos=$6,
            lembrete_dia_anterior_enviado=CASE WHEN data_aula IS DISTINCT FROM $4::date OR hora_inicio IS DISTINCT FROM $5::time THEN FALSE ELSE lembrete_dia_anterior_enviado END,
            lembrete_dia_anterior_enviado_em=CASE WHEN data_aula IS DISTINCT FROM $4::date OR hora_inicio IS DISTINCT FROM $5::time THEN NULL ELSE lembrete_dia_anterior_enviado_em END,
            lembrete_horas_antes_enviado=CASE WHEN data_aula IS DISTINCT FROM $4::date OR hora_inicio IS DISTINCT FROM $5::time THEN FALSE ELSE lembrete_horas_antes_enviado END,
            lembrete_horas_antes_enviado_em=CASE WHEN data_aula IS DISTINCT FROM $4::date OR hora_inicio IS DISTINCT FROM $5::time THEN NULL ELSE lembrete_horas_antes_enviado_em END,
            aulas_unidades=$7,status=CASE WHEN $8 THEN $9 ELSE status END,
            confirmacao_status=CASE WHEN $8 THEN $10 ELSE confirmacao_status END,
            confirmacao_origem=CASE WHEN $8 AND confirmacao_status IS DISTINCT FROM $10 THEN 'MANUAL' ELSE confirmacao_origem END,
            confirmacao_atualizada_em=CASE WHEN $8 AND confirmacao_status IS DISTINCT FROM $10 THEN NOW() ELSE confirmacao_atualizada_em END,
            confirmacao_token_hash=NULL, confirmacao_token_expira_em=NULL, confirmacao_token_usado_em=NULL,
            observacoes=CASE WHEN $8 THEN $11 ELSE observacoes END,
            excecao_plano=FALSE,atualizado_em=NOW()
        WHERE id=$12
      `,[n.instrutor_id_novo,n.veiculo_id_novo,n.local_id_novo,n.data_aula_nova,n.hora_inicio_nova,n.duracao_minutos_nova,n.aulas_unidades_nova,isAlvo,statusAlvo,confirmacaoAlvo,payload.observacoes||'',Number(n.id)]);
    }

    await client.query(`UPDATE autoagenda.planos_aula SET hora_inicio=$1,instrutor_id=$2,veiculo_id=$3,local_id=$4,dias_semana=$5::int[],atualizado_em=NOW() WHERE id=$6`,
      [String(payload.hora_inicio).slice(0,5),Number(payload.instrutor_id),Number(payload.veiculo_id),Number(payload.local_id),novosDias,alvo.plan_id]);

    await client.query('COMMIT');
    dispararEmailPlanoSeguro(alvo.plan_id, 'PLANO_ATUALIZADO', `serie-${Date.now()}`);
    dispararWhatsAppPlanoSeguro(alvo.plan_id, 'PLANO_ATUALIZADO', `serie-${Date.now()}`);
    res.json({ ok:true,alteradas:novas.length });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error:error.statusCode ? error.message : 'Erro ao alterar a série de aulas.' });
  } finally { client.release(); }
});

// Mantém o histórico: DELETE arquiva a aula em vez de removê-la fisicamente.
// Aulas já REALIZADAS ou com FALTA são registros históricos consolidados e não podem ser arquivadas por esta rota.
app.delete('/api/aulas/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id=Number(req.params.id);
    await client.query('BEGIN');
    const atual=await client.query('SELECT id,status,arquivada FROM autoagenda.aulas WHERE id=$1 FOR UPDATE',[id]);
    if (!atual.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Aula não encontrada.' });
    }
    const aula=atual.rows[0];
    if (aula.arquivada) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Esta aula já está arquivada.' });
    }
    if (['REALIZADA','FALTOU'].includes(aula.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Aulas realizadas ou com falta fazem parte do histórico e não podem ser arquivadas.' });
    }
    const result=await client.query(`
      UPDATE autoagenda.aulas
      SET status='CANCELADA', arquivada=TRUE, arquivada_em=NOW(), atualizado_em=NOW()
      WHERE id=$1
      RETURNING id, status, arquivada, arquivada_em
    `,[id]);
    await client.query('COMMIT');
    dispararEmailAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].arquivada_em || Date.now()));
    dispararWhatsAppAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].arquivada_em || Date.now()));
    res.json({ ok:true,aula:result.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error:'Erro ao arquivar aula.' });
  } finally {
    client.release();
  }
});

// V2.4 — alteração manual da confirmação da aula.
// Origem e data/hora ficam prontas para futura confirmação automática via WhatsApp.
app.patch('/api/aulas/:id/confirmacao', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const confirmacao = normalizarConfirmacaoStatus(req.body?.confirmacao_status, '');
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error:'Aula inválida.' });
    if (!confirmacao) return res.status(400).json({ error:'Status de confirmação inválido.' });
    await client.query('BEGIN');
    const instrutorEscopo = instrutorIdDaSessao(req);
    const atual = await client.query(
      `SELECT * FROM autoagenda.aulas WHERE id=$1 AND ($2::int=0 OR instrutor_id=$2) FOR UPDATE`,
      [id, instrutorEscopo]
    );
    if (!atual.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Aula não encontrada.' }); }
    const aula = atual.rows[0];
    if (aula.arquivada) { await client.query('ROLLBACK'); return res.status(409).json({ error:'Aula arquivada não pode ter a confirmação alterada.' }); }
    if (!['AGENDADA','CONFIRMADA'].includes(String(aula.status || '').toUpperCase())) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'A confirmação só pode ser alterada em aulas agendadas.' });
    }
    const result = await client.query(`
      UPDATE autoagenda.aulas
      SET confirmacao_status=$1, confirmacao_origem='MANUAL', confirmacao_atualizada_em=NOW(),
          confirmacao_token_hash=NULL, confirmacao_token_expira_em=NULL, confirmacao_token_usado_em=NULL,
          atualizado_em=NOW()
      WHERE id=$2 RETURNING *
    `,[confirmacao,id]);
    await client.query('COMMIT');
    res.json(aulaSemMetadadosToken(result.rows[0]));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error:'Erro ao atualizar a confirmação da aula.' });
  } finally { client.release(); }
});

app.patch('/api/aulas/:id/status', async (req, res) => {
  const client=await pool.connect();
  try {
    const id=Number(req.params.id);
    const { status }=req.body;
    const permitidos=['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'];
    if (!permitidos.includes(status)) return res.status(400).json({ error:'Status inválido.' });

    await client.query('BEGIN');
    const instrutorEscopo = instrutorIdDaSessao(req);
    const q=await client.query(
      `SELECT * FROM autoagenda.aulas WHERE id=$1 AND ($2::int=0 OR instrutor_id=$2) FOR UPDATE`,
      [id, instrutorEscopo]
    );
    if (!q.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Aula não encontrada.' });
    }
    const aula=q.rows[0];
    if (aula.arquivada) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Aula arquivada não pode ter o status alterado.' });
    }
    validarDataParaStatus(aula.data_aula,status);
    await bloquearChavesTransacao(client,chavesAgenda(aula));

    const config=await obterConfigFuncionamento(client);
    if (['AGENDADA','CONFIRMADA'].includes(status)) {
      await validarRecursosAtivos(client,aula);
      await validarHorarioFuncionamento(client,aula,config);
      await validarDisponibilidadeInstrutor(client,aula.instrutor_id,aula,config);
      await validarDisponibilidadeVeiculo(client,aula.veiculo_id,aula);
      const conflito=await verificarConflito(client,aula,[id],config.intervalo_minutos);
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error:'Conflito de horário ao reativar a aula.',conflito:conflito.rows[0] });
      }
    }
    await validarSaldoAula(client,{ aluno_id:aula.aluno_id,status,data_aula:aula.data_aula,aulas_unidades:aula.aulas_unidades },[id]);

    const result=await client.query(`
      UPDATE autoagenda.aulas
      SET status=$1,
          confirmacao_status=CASE WHEN $1='CONFIRMADA' THEN 'CONFIRMADA' ELSE confirmacao_status END,
          confirmacao_origem=CASE WHEN $1='CONFIRMADA' THEN 'MANUAL' ELSE confirmacao_origem END,
          confirmacao_atualizada_em=CASE WHEN $1='CONFIRMADA' THEN NOW() ELSE confirmacao_atualizada_em END,
          confirmacao_token_hash=NULL, confirmacao_token_expira_em=NULL, confirmacao_token_usado_em=NULL,
          atualizado_em=NOW()
      WHERE id=$2 RETURNING *
    `,[status,id]);
    await client.query('COMMIT');
    if (status === 'CANCELADA' && String(aula.status || '').toUpperCase() !== 'CANCELADA') {
      dispararEmailAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].atualizado_em || Date.now()));
      dispararWhatsAppAulaSeguro(id, 'CANCELAMENTO', String(result.rows[0].atualizado_em || Date.now()));
    }
    res.json(aulaSemMetadadosToken(result.rows[0]));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error:error.statusCode ? error.message : 'Erro ao atualizar status da aula.' });
  } finally { client.release(); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`AutoAgenda V${APP_VERSION} rodando na porta ${PORT}`);
      iniciarWorkerLembretesAutomaticos();
      if (!LOGIN_READY) {
        console.error('SEGURANÇA: login individual sem administrador ativo. Configure AUTOAGENDA_USER e AUTOAGENDA_PASSWORD para o bootstrap inicial.');
      } else {
        console.log('Segurança: login individual ativo com sessão HttpOnly.');
      }
    });
  } catch (error) {
    console.error('AutoAgenda não iniciou porque o banco não pôde ser preparado.');
    process.exit(1);
  }
}

start();
