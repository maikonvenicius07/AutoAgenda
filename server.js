require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.warn('ATENÇÃO: DATABASE_URL não configurada.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
        aulas_realizadas INTEGER NOT NULL DEFAULT 0 CHECK (aulas_realizadas >= 0),
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

    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_data ON autoagenda.aulas(data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_instrutor_data ON autoagenda.aulas(instrutor_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_veiculo_data ON autoagenda.aulas(veiculo_id, data_aula)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_aluno_data ON autoagenda.aulas(aluno_id, data_aula)');

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
    console.log('Schema autoagenda verificado/criado com sucesso.');
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
    res.json({ ok: true, database: true, schema_autoagenda: result.rows[0].schema_autoagenda, agora: result.rows[0].agora });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, database: false, error: 'Falha ao conectar ao banco.' });
  }
});

// ========================= ALUNOS =========================
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, nome, whatsapp, email, categoria,
             aulas_contratadas, aulas_realizadas, observacoes,
             ativo, criado_em
      FROM autoagenda.alunos
      WHERE ativo = TRUE
      ORDER BY nome
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar alunos.' });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const { nome, whatsapp, email, categoria = 'B', aulas_contratadas = 20, observacoes = '' } = req.body;
    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const result = await query(`
      INSERT INTO autoagenda.alunos
        (nome, whatsapp, email, categoria, aulas_contratadas, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [nome.trim(), whatsapp.trim(), email || null, categoria, Number(aulas_contratadas) || 20, observacoes || '']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao cadastrar aluno.' });
  }
});

app.put('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, whatsapp, email, categoria, aulas_contratadas, aulas_realizadas, observacoes } = req.body;

    if (!nome || !whatsapp) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });

    const result = await query(`
      UPDATE autoagenda.alunos
      SET nome = $1,
          whatsapp = $2,
          email = $3,
          categoria = $4,
          aulas_contratadas = $5,
          aulas_realizadas = $6,
          observacoes = $7,
          atualizado_em = NOW()
      WHERE id = $8 AND ativo = TRUE
      RETURNING *
    `, [
      nome.trim(), whatsapp.trim(), email || null, categoria || 'B',
      Number(aulas_contratadas) || 20, Number(aulas_realizadas) || 0,
      observacoes || '', id
    ]);

    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar aluno.' });
  }
});

// Exclusão lógica: preserva as aulas já vinculadas ao aluno.
app.delete('/api/alunos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query(`
      UPDATE autoagenda.alunos
      SET ativo = FALSE, atualizado_em = NOW()
      WHERE id = $1 AND ativo = TRUE
      RETURNING id
    `, [id]);

    if (!result.rowCount) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir aluno.' });
  }
});

// ========================= APOIO =========================
app.get('/api/instrutores', async (req, res) => {
  try {
    const result = await query(`SELECT id, nome, whatsapp, email, categorias, ativo FROM autoagenda.instrutores WHERE ativo = TRUE ORDER BY nome`);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar instrutores.' });
  }
});

app.get('/api/veiculos', async (req, res) => {
  try {
    const result = await query(`SELECT id, nome, placa, categoria, ativo FROM autoagenda.veiculos WHERE ativo = TRUE ORDER BY nome`);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar veículos.' });
  }
});

app.get('/api/locais', async (req, res) => {
  try {
    const result = await query(`SELECT id, nome, endereco, ativo FROM autoagenda.locais WHERE ativo = TRUE ORDER BY nome`);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar locais.' });
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
      SELECT
        a.id, a.aluno_id, al.nome AS aluno_nome,
        a.instrutor_id, i.nome AS instrutor_nome,
        a.veiculo_id, v.nome AS veiculo_nome, v.placa AS veiculo_placa,
        a.local_id, l.nome AS local_nome, l.endereco AS local_endereco,
        a.data_aula, a.hora_inicio, a.duracao_minutos,
        a.status, a.observacoes, a.criado_em
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

async function verificarConflito(client, dados, excluirId = null) {
  const inicio = `${dados.data_aula} ${dados.hora_inicio}:00`;
  const params = [
    dados.data_aula,
    Number(dados.aluno_id),
    Number(dados.instrutor_id),
    Number(dados.veiculo_id),
    inicio,
    Number(dados.duracao_minutos)
  ];

  let excluir = '';
  if (excluirId) {
    params.push(Number(excluirId));
    excluir = 'AND a.id <> $7';
  }

  return client.query(`
    SELECT a.id, a.data_aula, a.hora_inicio, a.duracao_minutos,
           al.nome AS aluno_nome, i.nome AS instrutor_nome,
           v.nome AS veiculo_nome, v.placa AS veiculo_placa
    FROM autoagenda.aulas a
    JOIN autoagenda.alunos al ON al.id = a.aluno_id
    JOIN autoagenda.instrutores i ON i.id = a.instrutor_id
    JOIN autoagenda.veiculos v ON v.id = a.veiculo_id
    WHERE a.data_aula = $1
      AND a.status NOT IN ('CANCELADA', 'REMARCADA')
      ${excluir}
      AND (a.aluno_id = $2 OR a.instrutor_id = $3 OR a.veiculo_id = $4)
      AND ((a.data_aula + a.hora_inicio) < ($5::timestamp + ($6 || ' minutes')::interval))
      AND ($5::timestamp < (a.data_aula + a.hora_inicio + (a.duracao_minutos || ' minutes')::interval))
    LIMIT 1
  `, params);
}

app.post('/api/aulas', async (req, res) => {
  const client = await pool.connect();
  try {
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos = 50, observacoes = '' } = req.body;
    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }

    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos };
    await client.query('BEGIN');
    const conflito = await verificarConflito(client, dados);
    if (conflito.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Conflito de horário.', conflito: conflito.rows[0] });
    }

    const result = await client.query(`
      INSERT INTO autoagenda.aulas
        (aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos, status, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'AGENDADA',$8)
      RETURNING *
    `, [Number(aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id), data_aula, hora_inicio, Number(duracao_minutos), observacoes || '']);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Erro ao agendar aula.' });
  } finally {
    client.release();
  }
});

// NOVO: editar aula, inclusive dia e horário.
app.put('/api/aulas/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { aluno_id, instrutor_id, veiculo_id, local_id, data_aula, hora_inicio, duracao_minutos = 50, status = 'AGENDADA', observacoes = '' } = req.body;

    if (!aluno_id || !instrutor_id || !veiculo_id || !local_id || !data_aula || !hora_inicio) {
      return res.status(400).json({ error: 'Preencha aluno, instrutor, veículo, local, data e horário.' });
    }

    const existente = await client.query('SELECT id FROM autoagenda.aulas WHERE id = $1', [id]);
    if (!existente.rowCount) return res.status(404).json({ error: 'Aula não encontrada.' });

    const dados = { aluno_id, instrutor_id, veiculo_id, data_aula, hora_inicio, duracao_minutos };
    await client.query('BEGIN');
    const conflito = await verificarConflito(client, dados, id);
    if (conflito.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Conflito de horário.', conflito: conflito.rows[0] });
    }

    const result = await client.query(`
      UPDATE autoagenda.aulas
      SET aluno_id = $1,
          instrutor_id = $2,
          veiculo_id = $3,
          local_id = $4,
          data_aula = $5,
          hora_inicio = $6,
          duracao_minutos = $7,
          status = $8,
          observacoes = $9,
          atualizado_em = NOW()
      WHERE id = $10
      RETURNING *
    `, [Number(aluno_id), Number(instrutor_id), Number(veiculo_id), Number(local_id), data_aula, hora_inicio, Number(duracao_minutos), status, observacoes || '', id]);

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

// NOVO: excluir aula definitivamente.
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
    app.listen(PORT, () => console.log(`AutoAgenda rodando na porta ${PORT}`));
  } catch (error) {
    console.error('AutoAgenda não iniciou porque o banco não pôde ser preparado.');
    process.exit(1);
  }
}

start();
