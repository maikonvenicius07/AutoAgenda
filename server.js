require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '1.4.0';
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

if (!process.env.DATABASE_URL) {
  console.warn('ATENÇÃO: DATABASE_URL não configurada.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const ADMIN_USER = String(process.env.AUTOAGENDA_USER || '').trim();
const ADMIN_PASSWORD = String(process.env.AUTOAGENDA_PASSWORD || '');

app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  if (!ADMIN_USER || !ADMIN_PASSWORD) return next();

  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
    } catch {}
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="AutoAgenda", charset="UTF-8"');
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
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoagenda.alunos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
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
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
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
        observacoes TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Migração segura das versões anteriores para a V1.4.
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
      END $$;
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_data ON autoagenda.aulas(data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_instrutor_data ON autoagenda.aulas(instrutor_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_veiculo_data ON autoagenda.aulas(veiculo_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_aluno_data ON autoagenda.aulas(aluno_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_plan ON autoagenda.aulas(plan_id, data_aula, hora_inicio)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_planos_aluno_ativo ON autoagenda.planos_aula(aluno_id, ativo)');

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
    res.json({ ok: true, version: APP_VERSION, auth_required: Boolean(ADMIN_USER && ADMIN_PASSWORD), database: true, schema_autoagenda: result.rows[0].schema_autoagenda, agora: result.rows[0].agora });
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

async function saldoAluno(client, alunoId) {
  const r = await client.query(`
    SELECT a.id, a.aulas_contratadas,
           (
             COALESCE(a.aulas_realizadas_anteriores, 0)
             + COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id AND au.status = 'REALIZADA'
             ), 0)
           )::int AS realizadas,
           COALESCE((
             SELECT SUM(au.aulas_unidades)
             FROM autoagenda.aulas au
             WHERE au.aluno_id = a.id
               AND au.data_aula >= $2::date
               AND au.status IN ('AGENDADA','CONFIRMADA')
           ), 0)::int AS agendadas
    FROM autoagenda.alunos a
    WHERE a.id = $1 AND a.ativo = TRUE
  `, [Number(alunoId), hojeApp()]);

  if (!r.rowCount) return null;
  const x = r.rows[0];
  return {
    ...x,
    disponiveis: Math.max(0, Number(x.aulas_contratadas) - Number(x.realizadas) - Number(x.agendadas))
  };
}

function validarInteiroPositivo(valor, padrao, maximo = 10000) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > maximo) return padrao;
  return n;
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

async function verificarConflito(client, dados, excluirIds = []) {
  const inicio = `${dados.data_aula} ${String(dados.hora_inicio).slice(0, 5)}:00`;
  const ids = (Array.isArray(excluirIds) ? excluirIds : [excluirIds]).map(Number).filter(Boolean);

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
      AND ((a.data_aula + a.hora_inicio) < ($5::timestamp + ($6 || ' minutes')::interval))
      AND ($5::timestamp < (a.data_aula + a.hora_inicio + (a.duracao_minutos || ' minutes')::interval))
    ORDER BY a.hora_inicio
    LIMIT 1
  `, [
    dados.data_aula,
    Number(dados.aluno_id),
    Number(dados.instrutor_id),
    Number(dados.veiculo_id),
    inicio,
    Number(dados.duracao_minutos),
    ids
  ]);
}

async function sugerirHorario(client, dados, excluirIds = []) {
  const inicioBase = 7 * 60;
  const fim = 20 * 60;
  const passo = 30;
  for (let min = inicioBase; min + Number(dados.duracao_minutos) <= fim; min += passo) {
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    const teste = { ...dados, hora_inicio: `${hh}:${mm}` };
    const conflito = await verificarConflito(client, teste, excluirIds);
    if (!conflito.rowCount) return `${hh}:${mm}`;
  }
  return null;
}

async function listarConflitosPlano(client, base, ocorrencias) {
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
    const c = await verificarConflito(client, dados);
    if (c.rowCount) {
      const sugestao = await sugerirHorario(client, dados);
      conflitos.push({ ...o, conflito: c.rows[0], sugestao_horario: sugestao });
    }
  }
  return conflitos;
}

// ========================= ALUNOS =========================
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await query(`
      SELECT a.id, a.nome, a.whatsapp, a.email, a.categoria,
             a.aulas_contratadas, a.aulas_realizadas,
             a.aulas_realizadas_anteriores, a.observacoes,
             a.ativo, a.criado_em,
             COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id AND au.status = 'REALIZADA'
             ), 0)::int AS realizadas_sistema,
             COALESCE((
               SELECT SUM(au.aulas_unidades)
               FROM autoagenda.aulas au
               WHERE au.aluno_id = a.id
                 AND au.data_aula >= $1::date
                 AND au.status IN ('AGENDADA','CONFIRMADA')
             ), 0)::int AS aulas_agendadas
      FROM autoagenda.alunos a
      WHERE a.ativo = TRUE
      ORDER BY a.nome
    `, [hojeApp()]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar alunos.' });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const {
      nome, whatsapp, email, categoria = 'B', aulas_contratadas = 20,
      aulas_realizadas_anteriores = 0, observacoes = ''
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const result = await query(`
      INSERT INTO autoagenda.alunos
        (nome, whatsapp, email, categoria, aulas_contratadas,
         aulas_realizadas, aulas_realizadas_anteriores, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
      RETURNING *
    `, [
      nome.trim(), whatsapp.trim(), email || null, categoria,
      validarInteiroPositivo(aulas_contratadas, 20, 500),
      Math.max(0, Number(aulas_realizadas_anteriores) || 0),
      observacoes || ''
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});

app.put('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nome, whatsapp, email, categoria, aulas_contratadas,
      aulas_realizadas_anteriores = 0, observacoes
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const result = await query(`
      UPDATE autoagenda.alunos
      SET nome = $1, whatsapp = $2, email = $3, categoria = $4,
          aulas_contratadas = $5,
          aulas_realizadas = $6,
          aulas_realizadas_anteriores = $6,
          observacoes = $7,
          atualizado_em = NOW()
      WHERE id = $8 AND ativo = TRUE
      RETURNING *
    `, [
      nome.trim(), whatsapp.trim(), email || null, categoria || 'B',
      validarInteiroPositivo(aulas_contratadas, 20, 500),
      Math.max(0, Number(aulas_realizadas_anteriores) || 0),
      observacoes || '', id
    ]);

    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar aluno.' });
  }
});

app.delete('/api/alunos/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Aluno inválido.' });

    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE autoagenda.alunos
      SET ativo = FALSE, atualizado_em = NOW()
      WHERE id = $1 AND ativo = TRUE
      RETURNING id
    `, [id]);

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno não encontrado.' });
    }

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
      RETURNING id
    `, [id, hojeApp()]);

    await client.query('COMMIT');
    res.json({
      ok: true,
      planos_encerrados: planosEncerrados.rowCount,
      aulas_futuras_canceladas: futurasCanceladas.rowCount
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir aluno.' });
  } finally {
    client.release();
  }
});

// ========================= APOIO =========================
app.get('/api/instrutores', async (req, res) => {
  try {
    const result = await query('SELECT id, nome, whatsapp, email, categorias, ativo FROM autoagenda.instrutores WHERE ativo = TRUE ORDER BY nome');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar instrutores.' });
  }
});

app.get('/api/veiculos', async (req, res) => {
  try {
    const result = await query('SELECT id, nome, placa, categoria, ativo FROM autoagenda.veiculos WHERE ativo = TRUE ORDER BY nome');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar veículos.' });
  }
});

app.get('/api/locais', async (req, res) => {
  try {
    const result = await query('SELECT id, nome, endereco, ativo FROM autoagenda.locais WHERE ativo = TRUE ORDER BY nome');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar locais.' });
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
    const conflitos = await listarConflitosPlano(client, base, ocorrencias);
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
    res.status(500).json({ error: error.message || 'Erro ao gerar prévia.' });
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

    await client.query('BEGIN');

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

    const conflitos = await listarConflitosPlano(client, base, ocorrencias);
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
      Math.max(1, Number(base.duracao_base_minutos) || 50),
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
    res.status(500).json({ error: error.message || 'Erro ao criar agenda automática.' });
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

// ========================= AULAS =========================
app.get('/api/aulas', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;
    const params = [];
    let filtro = '';
    if (data_inicio && data_fim) {
      params.push(data_inicio, data_fim);
      filtro = 'WHERE a.data_aula BETWEEN $1 AND $2';
    }

    const result = await query(`
      SELECT a.id, a.aluno_id, al.nome AS aluno_nome,
             a.instrutor_id, i.nome AS instrutor_nome,
             a.veiculo_id, v.nome AS veiculo_nome, v.placa AS veiculo_placa,
             a.local_id, l.nome AS local_nome, l.endereco AS local_endereco,
             a.data_aula, a.hora_inicio, a.duracao_minutos,
             a.status, a.observacoes, a.criado_em,
             a.plan_id, a.numero_plano, a.aulas_unidades, a.excecao_plano
      FROM autoagenda.aulas a
      JOIN autoagenda.alunos al ON al.id = a.aluno_id
      JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
      JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
      JOIN autoagenda.locais l ON l.id = a.local_id
      ${filtro}
      ORDER BY a.data_aula, a.hora_inicio
    `, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar aulas.' });
  }
});

app.post('/api/aulas', async (req, res) => {
  const client = await pool.connect();
  try {
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos = 50, aulas_unidades = 1, status = 'AGENDADA', observacoes = '' } = req.body;
    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }

    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos: validarInteiroPositivo(duracao_minutos, 50, 480) };
    await client.query('BEGIN');
    const conflito = await verificarConflito(client, dados);
    if (conflito.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Conflito de horário.', conflito: conflito.rows[0] });
    }

    const result = await client.query(`
      INSERT INTO autoagenda.aulas
        (aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
         duracao_minutos, status, observacoes, aulas_unidades)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      Number(aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id), data_aula,
      String(hora_inicio).slice(0, 5), validarInteiroPositivo(duracao_minutos, 50, 480),
      ['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'].includes(status) ? status : 'AGENDADA',
      observacoes || '',
      Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4))
    ]);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error: 'Erro ao agendar aula.' });
  } finally {
    client.release();
  }
});

// Edita apenas esta aula. Em aula de plano, registra como exceção.
app.put('/api/aulas/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio,
            duracao_minutos = 50, aulas_unidades = 1, status = 'AGENDADA', observacoes = '' } = req.body;

    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }
    const statusPermitidos = ['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'];
    if (!statusPermitidos.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

    const existente = await client.query('SELECT id, plan_id FROM autoagenda.aulas WHERE id = $1', [id]);
    if (!existente.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });

    await client.query('BEGIN');
    if (!['CANCELADA','REMARCADA'].includes(status)) {
      const conflito = await verificarConflito(client, { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos }, [id]);
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Conflito de horário.', conflito: conflito.rows[0] });
      }
    }

    const result = await client.query(`
      UPDATE autoagenda.aulas
      SET aluno_id = $1, instrutor_id = $2, veiculo_id = $3, local_id = $4,
          data_aula = $5, hora_inicio = $6, duracao_minutos = $7,
          aulas_unidades = $8, status = $9, observacoes = $10,
          excecao_plano = CASE WHEN plan_id IS NULL THEN FALSE ELSE TRUE END,
          atualizado_em = NOW()
      WHERE id = $11
      RETURNING *
    `, [
      Number(aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id), data_aula,
      String(hora_inicio).slice(0, 5), validarInteiroPositivo(duracao_minutos, 50, 480),
      Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4)), status, observacoes || '', id
    ]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar aula.' });
  } finally {
    client.release();
  }
});

// Edita esta aula e desloca todas as próximas do mesmo plano pelo mesmo intervalo.
app.put('/api/aulas/:id/serie', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const payload = req.body || {};
    const atual = await client.query('SELECT * FROM autoagenda.aulas WHERE id = $1', [id]);
    if (!atual.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });
    const alvo = atual.rows[0];
    if (!alvo.plan_id) return res.status(400).json({ error: 'Esta aula não pertence a um plano automático.' });

    if (!payload.data_aula || !payload.hora_inicio || !payload.instrutor_id || !payload.veiculo_id || !payload.local_id) {
      return res.status(400).json({ error: 'Preencha os dados da alteração.' });
    }
    if (payload.status && !['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'].includes(payload.status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    if (String(payload.data_aula).slice(0, 10) < hojeApp()) {
      return res.status(400).json({ error: 'Uma alteração em série não pode deslocar as próximas aulas para uma data passada.' });
    }

    const antigoDT = dateTimeUTC(alvo.data_aula, alvo.hora_inicio);
    const novoDT = dateTimeUTC(payload.data_aula, payload.hora_inicio);
    const delta = novoDT.getTime() - antigoDT.getTime();
    const deltaDias = Math.round(
      (dateOnlyUTC(payload.data_aula).getTime() - dateOnlyUTC(alvo.data_aula).getTime()) / 86400000
    );

    const planoQ = await client.query('SELECT dias_semana FROM autoagenda.planos_aula WHERE id = $1', [alvo.plan_id]);
    if (!planoQ.rowCount) return res.status(404).json({ error: 'Plano automático não encontrado.' });
    const diasAtuais = Array.isArray(planoQ.rows[0].dias_semana) ? planoQ.rows[0].dias_semana.map(Number) : [];
    const novosDias = Array.from(new Set(diasAtuais.map(d => ((d + deltaDias) % 7 + 7) % 7))).sort((a, b) => a - b);

    await client.query('BEGIN');
    const afetadasQ = await client.query(`
      SELECT * FROM autoagenda.aulas
      WHERE plan_id = $1
        AND (data_aula + hora_inicio) >= $2::timestamp
        AND status IN ('AGENDADA','CONFIRMADA')
      ORDER BY data_aula, hora_inicio
    `, [alvo.plan_id, `${String(alvo.data_aula).slice(0,10)} ${String(alvo.hora_inicio).slice(0,8)}`]);

    const afetadas = afetadasQ.rows;
    const ids = afetadas.map(a => Number(a.id));
    if (!afetadas.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Não há aulas futuras deste plano para alterar.' });
    }

    const novas = afetadas.map(a => {
      const dt = dateTimeUTC(a.data_aula, a.hora_inicio);
      const novo = new Date(dt.getTime() + delta);
      const isAlvo = Number(a.id) === id;
      return {
        ...a,
        data_aula_nova: isoDateUTC(novo),
        hora_inicio_nova: hhmmUTC(novo),
        instrutor_id_novo: Number(payload.instrutor_id),
        veiculo_id_novo: Number(payload.veiculo_id),
        local_id_novo: Number(payload.local_id),
        duracao_minutos_nova: isAlvo
          ? validarInteiroPositivo(payload.duracao_minutos, Number(a.duracao_minutos), 480)
          : Number(a.duracao_minutos),
        aulas_unidades_nova: isAlvo
          ? Math.min(4, validarInteiroPositivo(payload.aulas_unidades, Number(a.aulas_unidades) || 1, 4))
          : Number(a.aulas_unidades || 1)
      };
    });

    for (const n of novas) {
      const conflito = await verificarConflito(client, {
        aluno_id: n.aluno_id,
        instrutor_id: n.instrutor_id_novo,
        veiculo_id: n.veiculo_id_novo,
        data_aula: n.data_aula_nova,
        hora_inicio: n.hora_inicio_nova,
        duracao_minutos: n.duracao_minutos_nova
      }, ids);
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Conflito ao alterar a série em ${n.data_aula_nova} às ${n.hora_inicio_nova}.`,
          conflito: conflito.rows[0]
        });
      }
    }

    for (const n of novas) {
      const isAlvo = Number(n.id) === id;
      await client.query(`
        UPDATE autoagenda.aulas
        SET instrutor_id = $1, veiculo_id = $2, local_id = $3,
            data_aula = $4, hora_inicio = $5, duracao_minutos = $6,
            aulas_unidades = $7,
            status = CASE WHEN $8 THEN $9 ELSE status END,
            observacoes = CASE WHEN $8 THEN $10 ELSE observacoes END,
            excecao_plano = FALSE,
            atualizado_em = NOW()
        WHERE id = $11
      `, [
        n.instrutor_id_novo, n.veiculo_id_novo, n.local_id_novo,
        n.data_aula_nova, n.hora_inicio_nova, n.duracao_minutos_nova,
        n.aulas_unidades_nova, isAlvo, payload.status || alvo.status,
        payload.observacoes || '', Number(n.id)
      ]);
    }

    await client.query(`
      UPDATE autoagenda.planos_aula
      SET hora_inicio = $1, instrutor_id = $2, veiculo_id = $3, local_id = $4,
          dias_semana = $5::int[], atualizado_em = NOW()
      WHERE id = $6
    `, [
      String(payload.hora_inicio).slice(0,5), Number(payload.instrutor_id), Number(payload.veiculo_id),
      Number(payload.local_id), novosDias, alvo.plan_id
    ]);

    await client.query('COMMIT');
    res.json({ ok: true, alteradas: novas.length });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(500).json({ error: error.message || 'Erro ao alterar a série de aulas.' });
  } finally {
    client.release();
  }
});

app.delete('/api/aulas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query('DELETE FROM autoagenda.aulas WHERE id = $1 RETURNING id', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir aula.' });
  }
});

app.patch('/api/aulas/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const permitidos = ['AGENDADA', 'CONFIRMADA', 'REALIZADA', 'REMARCADA', 'CANCELADA', 'FALTOU'];
    if (!permitidos.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

    const result = await query(`
      UPDATE autoagenda.aulas SET status = $1, atualizado_em = NOW()
      WHERE id = $2 RETURNING *
    `, [status, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar status da aula.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`AutoAgenda V${APP_VERSION} rodando na porta ${PORT}`);
      if (!ADMIN_USER || !ADMIN_PASSWORD) {
        console.warn('SEGURANÇA: AUTOAGENDA_USER/AUTOAGENDA_PASSWORD não configurados. O acesso está sem autenticação.');
      }
    });
  } catch (error) {
    console.error('AutoAgenda não iniciou porque o banco não pôde ser preparado.');
    process.exit(1);
  }
}

start();
