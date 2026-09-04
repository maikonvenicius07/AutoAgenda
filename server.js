require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '2.8.0';
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
const ADMIN_USER = String(process.env.AUTOAGENDA_USER || '').trim();
const ADMIN_PASSWORD = String(process.env.AUTOAGENDA_PASSWORD || '');
const AUTH_CONFIGURED = Boolean(ADMIN_USER && ADMIN_PASSWORD);
const AUTH_REQUIRED = IS_PRODUCTION || AUTH_CONFIGURED;

// Proteção simples contra tentativas repetidas de login.
// É propositalmente mantida em memória: não altera o banco nem grava credenciais.
const AUTH_MAX_FAILURES = 8;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_BLOCK_MS = 15 * 60 * 1000;
const authAttempts = new Map();

function authClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'desconhecido';
}

function authState(req) {
  const key = authClientKey(req);
  const now = Date.now();
  let state = authAttempts.get(key);
  if (!state) return { key, blocked: false, retryAfter: 0 };

  if (state.blockedUntil && state.blockedUntil > now) {
    return { key, blocked: true, retryAfter: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)) };
  }

  if ((state.firstFailureAt || 0) + AUTH_WINDOW_MS <= now) {
    authAttempts.delete(key);
    state = null;
  } else if (state?.blockedUntil && state.blockedUntil <= now) {
    authAttempts.delete(key);
    state = null;
  }
  return { key, blocked: false, retryAfter: 0 };
}

function registrarFalhaAuth(key) {
  const now = Date.now();
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

function textoSeguroIgual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req, res, next) => {
  if (req.path === '/api/health') return next();

  // Em produção, o AutoAgenda não expõe dados pessoais se usuário/senha não estiverem configurados.
  if (AUTH_REQUIRED && !AUTH_CONFIGURED) {
    const mensagem = 'AutoAgenda protegido: configure AUTOAGENDA_USER e AUTOAGENDA_PASSWORD no Render antes de liberar o acesso.';
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: mensagem, security_setup_required: true });
    return res.status(503).type('text/plain; charset=utf-8').send(mensagem);
  }

  if (!AUTH_CONFIGURED) return next();

  const state = authState(req);
  if (state.blocked) {
    res.setHeader('Retry-After', String(state.retryAfter));
    if (req.path.startsWith('/api/')) {
      return res.status(429).json({ error: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.' });
    }
    return res.status(429).type('text/plain; charset=utf-8').send('Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.');
  }

  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (textoSeguroIgual(user, ADMIN_USER) && textoSeguroIgual(pass, ADMIN_PASSWORD)) {
        limparFalhasAuth(state.key);
        return next();
      }
      registrarFalhaAuth(state.key);
    } catch {
      registrarFalhaAuth(state.key);
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="AutoAgenda", charset="UTF-8"');
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  return res.status(401).send('Acesso protegido ao AutoAgenda.');
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      // Durante a evolução do projeto, evita o navegador carregar JS/HTML antigos após um deploy.
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

async function query(text, params = []) {
  return pool.query(text, params);
}

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

    // V2.5 — estrutura de lembretes, ainda com envio manual pelo WhatsApp.
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_ativo BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_hora TIME NOT NULL DEFAULT '18:00'");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes_ativo BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes INTEGER NOT NULL DEFAULT 2");

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

    await client.query('COMMIT');
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
    res.json({ ok: true, version: APP_VERSION, auth_required: AUTH_REQUIRED, auth_configured: AUTH_CONFIGURED, security_ready: !AUTH_REQUIRED || AUTH_CONFIGURED, database: true, schema_autoagenda: result.rows[0].schema_autoagenda, agora: result.rows[0].agora });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, database: false, error: 'Falha ao conectar ao banco.' });
  }
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


async function obterConfigLembretes(client) {
  const r = await client.query(`
    SELECT lembrete_dia_anterior_ativo,
           TO_CHAR(lembrete_dia_anterior_hora, 'HH24:MI') AS lembrete_dia_anterior_hora,
           lembrete_horas_antes_ativo, lembrete_horas_antes
    FROM autoagenda.configuracoes
    WHERE id = 1
  `);
  const x = r.rows[0] || {};
  return {
    lembrete_dia_anterior_ativo: x.lembrete_dia_anterior_ativo !== false,
    lembrete_dia_anterior_hora: String(x.lembrete_dia_anterior_hora || '18:00').slice(0,5),
    lembrete_horas_antes_ativo: x.lembrete_horas_antes_ativo !== false,
    lembrete_horas_antes: Math.max(1, Math.min(24, Number(x.lembrete_horas_antes || 2)))
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
    lembrete_horas_antes: horas
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
    const mostrarTodos = incluirInativos(req);
    const result = await query(`
      SELECT a.id, a.nome, a.whatsapp, a.email, a.categoria,
             a.aulas_contratadas, a.aulas_realizadas,
             a.aulas_realizadas_anteriores,
             a.ativo, a.criado_em,
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
      ORDER BY a.ativo DESC, a.nome
    `, [hojeApp(), mostrarTodos]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar alunos.' });
  }
});

// O CPF completo só é enviado quando o usuário abre um aluno específico para edição.
app.get('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query(`
      SELECT id, nome, cpf, whatsapp, email, categoria,
             aulas_contratadas, aulas_realizadas, aulas_realizadas_anteriores,
             observacoes, ativo, criado_em, atualizado_em
      FROM autoagenda.alunos
      WHERE id = $1
    `, [id]);
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
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Aluno inválido.' });

    const alunoQ = await query(`
      SELECT id, nome, whatsapp, email, categoria, aulas_contratadas,
             aulas_realizadas, aulas_realizadas_anteriores, observacoes,
             ativo, criado_em, atualizado_em,
             CASE WHEN LENGTH(COALESCE(cpf,'')) = 11
                  THEN '***.***.***-' || RIGHT(cpf, 2)
                  ELSE NULL END AS cpf_mascarado
      FROM autoagenda.alunos
      WHERE id = $1
    `, [id]);
    if (!alunoQ.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const hoje = hojeApp();
    const [metricasQ, aulasQ, planosQ] = await Promise.all([
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
      `, [id, hoje]),
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
        ORDER BY a.data_aula DESC, a.hora_inicio DESC, a.id DESC
      `, [id]),
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
        ORDER BY p.criado_em DESC, p.id DESC
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

    res.json({ aluno, resumo, planos: planosQ.rows, aulas: aulasQ.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar histórico do aluno.' });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const {
      nome, cpf, whatsapp, email, categoria = 'B', aulas_contratadas = 20,
      aulas_realizadas_anteriores = 0, observacoes = ''
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const cpfLimpo = normalizarCpf(cpf);
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
        (nome, cpf, whatsapp, email, categoria, aulas_contratadas,
         aulas_realizadas, aulas_realizadas_anteriores, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
      RETURNING id, nome, whatsapp, email, categoria, aulas_contratadas,
                aulas_realizadas, aulas_realizadas_anteriores, observacoes, ativo
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, categoria,
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
      nome, cpf, whatsapp, email, categoria, aulas_contratadas,
      aulas_realizadas_anteriores = 0, observacoes
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const cpfLimpo = normalizarCpf(cpf);
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
      SET nome = $1, cpf = $2, whatsapp = $3, email = $4, categoria = $5,
          aulas_contratadas = $6,
          aulas_realizadas = $7,
          aulas_realizadas_anteriores = $7,
          observacoes = $8,
          atualizado_em = NOW()
      WHERE id = $9 AND ativo = TRUE
      RETURNING id, nome, whatsapp, email, categoria, aulas_contratadas,
                aulas_realizadas, aulas_realizadas_anteriores, observacoes, ativo
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, categoria || 'B',
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
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE autoagenda.configuracoes
      SET lembrete_dia_anterior_ativo=$1,
          lembrete_dia_anterior_hora=$2::time,
          lembrete_horas_antes_ativo=$3,
          lembrete_horas_antes=$4,
          atualizado_em=NOW()
      WHERE id=1
      RETURNING lembrete_dia_anterior_ativo,
                TO_CHAR(lembrete_dia_anterior_hora,'HH24:MI') AS lembrete_dia_anterior_hora,
                lembrete_horas_antes_ativo, lembrete_horas_antes
    `,[cfg.lembrete_dia_anterior_ativo,cfg.lembrete_dia_anterior_hora,cfg.lembrete_horas_antes_ativo,cfg.lembrete_horas_antes]);
    await sincronizarAgendamentoLembretes(client);
    await client.query('COMMIT');
    res.json(r.rows[0] || cfg);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao salvar lembretes.' });
  } finally { client.release(); }
});

app.get('/api/lembretes', async (req, res) => {
  const client = await pool.connect();
  try {
    await sincronizarAgendamentoLembretes(client);
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
      SELECT * FROM itens ORDER BY lembrete_em, aula_id, tipo LIMIT 200
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
        proximos_7_dias: itens.filter(x => String(x.lembrete_em) >= agoraTexto && String(x.lembrete_em) <= limite7).length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error:'Erro ao consultar lembretes.' });
  } finally { client.release(); }
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
    res.json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error:'Erro ao atualizar lembrete.' });
  } finally { client.release(); }
});

// ---------- Instrutores ----------
app.get('/api/instrutores', async (req, res) => {
  try {
    const mostrarTodos = incluirInativos(req);
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
      ORDER BY i.ativo DESC, i.nome
    `, [hojeApp(), mostrarTodos]);
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
    const mostrarTodos = incluirInativos(req);
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
    const mostrarTodos = incluirInativos(req);
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
    const instrutorId = Number(req.query.instrutor_id);
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

app.get('/whatsapp/aula/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).type('text/plain; charset=utf-8').send('Aula inválida.');
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
    `, [id]);

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

    const texto = `Olá, ${aula.aluno_nome}! Seguem os dados da sua aula prática:\n\n` +
      `📅 Data: ${String(aula.data_br || '').trim()}\n` +
      `🕐 Horário: ${String(aula.hora_inicio || '').slice(0,5)}\n` +
      `👨‍🏫 Instrutor: ${aula.instrutor_nome || 'a definir'}\n` +
      `🚗 Veículo: ${aula.veiculo_nome || 'a definir'}${aula.veiculo_placa ? ` (${aula.veiculo_placa})` : ''}\n` +
      `📍 Local: ${aula.local_nome || 'a definir'}\n\n` +
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
    const incluirArquivadas = ['1','true','sim'].includes(String(req.query?.incluir_arquivadas || '').toLowerCase());
    const params = [];
    const condicoes = [];
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
    `, [id]);
    if (!r.rowCount) return res.status(404).json({ error:'Aula não encontrada.' });
    res.json(r.rows[0]);
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
    res.status(201).json(result.rows[0]);
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
    const { instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
            duracao_minutos = null, aulas_unidades = null, observacoes = '' } = req.body || {};
    if (!Number.isInteger(origemId) || origemId < 1) throw erroHttp(400, 'Aula original inválida.');
    if (!instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      throw erroHttp(400, 'Preencha instrutor, veículo, local, data e horário da reposição.');
    }

    await client.query('BEGIN');
    const origemQ = await client.query('SELECT * FROM autoagenda.aulas WHERE id=$1 FOR UPDATE', [origemId]);
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
      instrutor_id: Number(instrutor_id),
      veiculo_id: Number(veiculo_id),
      data_aula,
      hora_inicio,
      duracao_minutos: duracaoFinal
    };
    await bloquearChavesTransacao(client, chavesAgenda(dados));
    await validarRecursosAtivos(client, {
      aluno_id: Number(origem.aluno_id),
      instrutor_id: Number(instrutor_id),
      veiculo_id: Number(veiculo_id),
      local_id: Number(local_id)
    });
    await validarHorarioFuncionamento(client, dados, config);
    await validarDisponibilidadeInstrutor(client, Number(instrutor_id), dados, config);
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
      Number(origem.aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id),
      data_aula, String(hora_inicio).slice(0,5), duracaoFinal, observacoesFinal, unidadesFinal, origemId
    ]);

    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], aula_original_id: origemId });
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
          observacoes=$11,
          excecao_plano=CASE WHEN plan_id IS NULL THEN FALSE ELSE TRUE END,
          atualizado_em=NOW()
      WHERE id=$12
      RETURNING *
    `, [Number(aluno_id),Number(instrutor_id),Number(veiculo_id),Number(local_id),data_aula,
        String(hora_inicio).slice(0,5),duracaoFinal,unidadesFinal,status,confirmacaoFinal,observacoes||'',id]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
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
            observacoes=CASE WHEN $8 THEN $11 ELSE observacoes END,
            excecao_plano=FALSE,atualizado_em=NOW()
        WHERE id=$12
      `,[n.instrutor_id_novo,n.veiculo_id_novo,n.local_id_novo,n.data_aula_nova,n.hora_inicio_nova,n.duracao_minutos_nova,n.aulas_unidades_nova,isAlvo,statusAlvo,confirmacaoAlvo,payload.observacoes||'',Number(n.id)]);
    }

    await client.query(`UPDATE autoagenda.planos_aula SET hora_inicio=$1,instrutor_id=$2,veiculo_id=$3,local_id=$4,dias_semana=$5::int[],atualizado_em=NOW() WHERE id=$6`,
      [String(payload.hora_inicio).slice(0,5),Number(payload.instrutor_id),Number(payload.veiculo_id),Number(payload.local_id),novosDias,alvo.plan_id]);

    await client.query('COMMIT');
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
    const atual = await client.query('SELECT * FROM autoagenda.aulas WHERE id=$1 FOR UPDATE',[id]);
    if (!atual.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Aula não encontrada.' }); }
    const aula = atual.rows[0];
    if (aula.arquivada) { await client.query('ROLLBACK'); return res.status(409).json({ error:'Aula arquivada não pode ter a confirmação alterada.' }); }
    if (!['AGENDADA','CONFIRMADA'].includes(String(aula.status || '').toUpperCase())) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'A confirmação só pode ser alterada em aulas agendadas.' });
    }
    const result = await client.query(`
      UPDATE autoagenda.aulas
      SET confirmacao_status=$1, confirmacao_origem='MANUAL', confirmacao_atualizada_em=NOW(), atualizado_em=NOW()
      WHERE id=$2 RETURNING *
    `,[confirmacao,id]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
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
    const q=await client.query('SELECT * FROM autoagenda.aulas WHERE id=$1 FOR UPDATE',[id]);
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
          atualizado_em=NOW()
      WHERE id=$2 RETURNING *
    `,[status,id]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
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
      if (AUTH_REQUIRED && !AUTH_CONFIGURED) {
        console.error('SEGURANÇA: produção bloqueada até configurar AUTOAGENDA_USER e AUTOAGENDA_PASSWORD.');
      } else if (AUTH_CONFIGURED) {
        console.log('Segurança: acesso protegido por autenticação básica.');
      }
    });
  } catch (error) {
    console.error('AutoAgenda não iniciou porque o banco não pôde ser preparado.');
    process.exit(1);
  }
}

start();
