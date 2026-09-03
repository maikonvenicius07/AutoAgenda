-- AutoAgenda V1.4
-- Schema compatível com o server.js atual.
-- O servidor cria/migra automaticamente; este arquivo serve para referência e execução manual controlada.

CREATE SCHEMA IF NOT EXISTS autoagenda;

CREATE TABLE IF NOT EXISTS autoagenda.instrutores (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  whatsapp VARCHAR(30),
  email VARCHAR(180),
  categorias VARCHAR(20) DEFAULT 'AB',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autoagenda.alunos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  whatsapp VARCHAR(30) NOT NULL,
  email VARCHAR(180),
  categoria VARCHAR(10) DEFAULT 'B',
  aulas_contratadas INTEGER NOT NULL DEFAULT 20 CHECK (aulas_contratadas > 0),
  aulas_realizadas INTEGER NOT NULL DEFAULT 0 CHECK (aulas_realizadas >= 0),
  aulas_realizadas_anteriores INTEGER NOT NULL DEFAULT 0 CHECK (aulas_realizadas_anteriores >= 0),
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autoagenda.veiculos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  placa VARCHAR(15),
  categoria VARCHAR(10) DEFAULT 'B',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autoagenda.locais (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  endereco VARCHAR(300),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

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
);

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
  plan_id INTEGER REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL,
  numero_plano INTEGER,
  aulas_unidades INTEGER NOT NULL DEFAULT 1,
  excecao_plano BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migrações seguras para instalações anteriores.
ALTER TABLE autoagenda.alunos ADD COLUMN IF NOT EXISTS aulas_realizadas_anteriores INTEGER;
UPDATE autoagenda.alunos
SET aulas_realizadas_anteriores = COALESCE(aulas_realizadas, 0)
WHERE aulas_realizadas_anteriores IS NULL;
ALTER TABLE autoagenda.alunos ALTER COLUMN aulas_realizadas_anteriores SET DEFAULT 0;
ALTER TABLE autoagenda.alunos ALTER COLUMN aulas_realizadas_anteriores SET NOT NULL;

ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS plan_id INTEGER;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS numero_plano INTEGER;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS aulas_unidades INTEGER NOT NULL DEFAULT 1;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS excecao_plano BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aulas_plan_id_fkey'
      AND conrelid = 'autoagenda.aulas'::regclass
  ) THEN
    ALTER TABLE autoagenda.aulas
      ADD CONSTRAINT aulas_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_data ON autoagenda.aulas(data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_instrutor_data ON autoagenda.aulas(instrutor_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_veiculo_data ON autoagenda.aulas(veiculo_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_aluno_data ON autoagenda.aulas(aluno_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_plan ON autoagenda.aulas(plan_id, data_aula, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_autoagenda_planos_aluno_ativo ON autoagenda.planos_aula(aluno_id, ativo);
