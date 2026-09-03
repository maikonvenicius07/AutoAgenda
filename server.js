require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '1.8.0';
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
      CREATE TABLE IF NOT EXISTS autoagenda.configuracoes (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        dias_funcionamento INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
        hora_abertura TIME NOT NULL DEFAULT '07:00',
        hora_encerramento TIME NOT NULL DEFAULT '20:00',
        duracao_padrao_minutos INTEGER NOT NULL DEFAULT 50
          CHECK (duracao_padrao_minutos BETWEEN 10 AND 240),
        intervalo_minutos INTEGER NOT NULL DEFAULT 0
          CHECK (intervalo_minutos BETWEEN 0 AND 120),
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
        observacoes TEXT,
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
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
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_instrutor_indisp_periodo ON autoagenda.instrutor_indisponibilidades(instrutor_id, data_inicio, data_fim)');

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
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await query(`
      SELECT a.id, a.nome, a.cpf, a.whatsapp, a.email, a.categoria,
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
      nome, cpf, whatsapp, email, categoria = 'B', aulas_contratadas = 20,
      aulas_realizadas_anteriores = 0, observacoes = ''
    } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const cpfLimpo = normalizarCpf(cpf);
    if (!cpfValido(cpfLimpo)) {
      return res.status(400).json({ error: 'Informe um CPF válido com 11 dígitos.' });
    }

    const result = await query(`
      INSERT INTO autoagenda.alunos
        (nome, cpf, whatsapp, email, categoria, aulas_contratadas,
         aulas_realizadas, aulas_realizadas_anteriores, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
      RETURNING *
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, categoria,
      validarInteiroPositivo(aulas_contratadas, 20, 500),
      Math.max(0, Number(aulas_realizadas_anteriores) || 0),
      observacoes || ''
    ]);

    res.status(201).json(result.rows[0]);
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
    if (!cpfValido(cpfLimpo)) {
      return res.status(400).json({ error: 'Informe um CPF válido com 11 dígitos.' });
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
      RETURNING *
    `, [
      nome.trim(), cpfLimpo, whatsapp.trim(), email || null, categoria || 'B',
      validarInteiroPositivo(aulas_contratadas, 20, 500),
      Math.max(0, Number(aulas_realizadas_anteriores) || 0),
      observacoes || '', id
    ]);

    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    if (error.code === '23505' && String(error.constraint || '').includes('alunos_cpf')) {
      return res.status(409).json({ error: 'Este CPF já está cadastrado em outro aluno.' });
    }
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
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.veiculo_id=v.id AND p.ativo=TRUE),0)::int AS planos_ativos,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.veiculo_id=v.id AND a.data_aula >= $1::date AND a.status IN ('AGENDADA','CONFIRMADA')),0)::int AS aulas_futuras,
             COALESCE((SELECT COUNT(*) FROM autoagenda.planos_aula p WHERE p.veiculo_id=v.id),0)::int AS planos_total,
             COALESCE((SELECT COUNT(*) FROM autoagenda.aulas a WHERE a.veiculo_id=v.id),0)::int AS aulas_total
      FROM autoagenda.veiculos v
      WHERE ($2::boolean = TRUE OR v.ativo = TRUE)
      ORDER BY v.ativo DESC, v.nome
    `, [hojeApp(), mostrarTodos]);
    res.json(result.rows);
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
    await garantirVeiculoSemDuplicidade(client, { nome, placa, categoria });
    const r = await client.query(
      `INSERT INTO autoagenda.veiculos (nome, placa, categoria) VALUES ($1,$2,$3) RETURNING *`,
      [nome, placa, categoria]
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
    await garantirVeiculoSemDuplicidade(client, { nome, placa, categoria }, id);
    const r = await client.query(
      `UPDATE autoagenda.veiculos SET nome=$1, placa=$2, categoria=$3, atualizado_em=NOW() WHERE id=$4 RETURNING *`,
      [nome, placa, categoria, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Veículo não encontrado.' });
    res.json(r.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar veículo.' });
  } finally { client.release(); }
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
      const r = await client.query('UPDATE autoagenda.veiculos SET ativo=TRUE, atualizado_em=NOW() WHERE id=$1 RETURNING *', [id]);
      return res.json(r.rows[0]);
    }

    const atualizado = await desativarRecurso(client, 'veiculo', 'veiculos', id);
    res.json(atualizado);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao alterar situação do veículo.' });
  } finally { client.release(); }
});

app.delete('/api/veiculos/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await desativarRecurso(client, 'veiculo', 'veiculos', Number(req.params.id));
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
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao gerar prévia.' });
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
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao criar agenda automática.' });
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
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos = null, aulas_unidades = 1, status = 'AGENDADA', observacoes = '' } = req.body;
    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }

    await validarRecursosAtivos(client, { instrutor_id, veiculo_id, local_id });
    const configFuncionamento = await obterConfigFuncionamento(client);
    const duracaoFinal = validarInteiroPositivo(duracao_minutos, configFuncionamento.duracao_padrao_minutos, 480);
    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos: duracaoFinal };
    await validarHorarioFuncionamento(client, dados, configFuncionamento);
    await validarDisponibilidadeInstrutor(client, instrutor_id, dados, configFuncionamento);
    await client.query('BEGIN');
    const conflito = await verificarConflito(client, dados, [], configFuncionamento.intervalo_minutos);
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
      String(hora_inicio).slice(0, 5), duracaoFinal,
      ['AGENDADA','CONFIRMADA','REALIZADA','REMARCADA','CANCELADA','FALTOU'].includes(status) ? status : 'AGENDADA',
      observacoes || '',
      Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4))
    ]);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao agendar aula.' });
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

    const existente = await client.query(
      'SELECT id, plan_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos, status FROM autoagenda.aulas WHERE id = $1',
      [id]
    );
    if (!existente.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });

    await validarRecursosAtivos(
      client,
      { instrutor_id, veiculo_id, local_id },
      {
        instrutor_id: existente.rows[0].instrutor_id,
        veiculo_id: existente.rows[0].veiculo_id,
        local_id: existente.rows[0].local_id
      }
    );

    const configFuncionamento = await obterConfigFuncionamento(client);
    const duracaoFinal = validarInteiroPositivo(duracao_minutos, Number(existente.rows[0].duracao_minutos) || configFuncionamento.duracao_padrao_minutos, 480);
    const horarioAlterado =
      String(existente.rows[0].data_aula).slice(0,10) !== String(data_aula).slice(0,10) ||
      String(existente.rows[0].hora_inicio).slice(0,5) !== String(hora_inicio).slice(0,5) ||
      Number(existente.rows[0].duracao_minutos) !== duracaoFinal;
    const reativandoHorario =
      !['AGENDADA','CONFIRMADA'].includes(String(existente.rows[0].status)) &&
      ['AGENDADA','CONFIRMADA'].includes(status);
    const instrutorAlterado = Number(existente.rows[0].instrutor_id) !== Number(instrutor_id);

    if (horarioAlterado || reativandoHorario || instrutorAlterado) {
      const dadosDisponibilidade = { data_aula, hora_inicio, duracao_minutos: duracaoFinal };
      await validarHorarioFuncionamento(client, dadosDisponibilidade, configFuncionamento);
      await validarDisponibilidadeInstrutor(client, instrutor_id, dadosDisponibilidade, configFuncionamento);
    }

    await client.query('BEGIN');
    if (!['CANCELADA','REMARCADA'].includes(status)) {
      const conflito = await verificarConflito(
        client,
        { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos: duracaoFinal },
        [id],
        configFuncionamento.intervalo_minutos
      );
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
      String(hora_inicio).slice(0, 5), duracaoFinal,
      Math.min(4, validarInteiroPositivo(aulas_unidades, 1, 4)), status, observacoes || '', id
    ]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erro ao atualizar aula.' });
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

    await validarRecursosAtivos(client, payload);
    const configFuncionamento = await obterConfigFuncionamento(client);
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
      const dadosDisponibilidade = {
        data_aula: n.data_aula_nova,
        hora_inicio: n.hora_inicio_nova,
        duracao_minutos: n.duracao_minutos_nova
      };
      await validarHorarioFuncionamento(client, dadosDisponibilidade, configFuncionamento);
      await validarDisponibilidadeInstrutor(client, n.instrutor_id_novo, dadosDisponibilidade, configFuncionamento);

      const conflito = await verificarConflito(client, {
        aluno_id: n.aluno_id,
        instrutor_id: n.instrutor_id_novo,
        veiculo_id: n.veiculo_id_novo,
        data_aula: n.data_aula_nova,
        hora_inicio: n.hora_inicio_nova,
        duracao_minutos: n.duracao_minutos_nova
      }, ids, configFuncionamento.intervalo_minutos);
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
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao alterar a série de aulas.' });
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
