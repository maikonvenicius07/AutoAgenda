-- AutoAgenda V2.5.0
-- Schema compatível com o server.js atual.
-- O servidor cria/migra automaticamente; este arquivo serve para referência e execução manual controlada.

CREATE SCHEMA IF NOT EXISTS autoagenda;

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
);

CREATE TABLE IF NOT EXISTS autoagenda.instrutor_indisponibilidades (
  id SERIAL PRIMARY KEY,
  instrutor_id INTEGER NOT NULL REFERENCES autoagenda.instrutores(id) ON DELETE CASCADE,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  motivo VARCHAR(250),
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_autoagenda_instrutor_indisp_periodo
ON autoagenda.instrutor_indisponibilidades(instrutor_id, data_inicio, data_fim);

CREATE TABLE IF NOT EXISTS autoagenda.alunos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  cpf VARCHAR(11),
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
  situacao VARCHAR(20) NOT NULL DEFAULT 'DISPONIVEL',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autoagenda.veiculo_indisponibilidades (
  id SERIAL PRIMARY KEY,
  veiculo_id INTEGER NOT NULL REFERENCES autoagenda.veiculos(id) ON DELETE CASCADE,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'INDISPONIVEL',
  motivo VARCHAR(250),
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_autoagenda_veiculo_indisp_periodo
ON autoagenda.veiculo_indisponibilidades(veiculo_id, data_inicio, data_fim);

CREATE TABLE IF NOT EXISTS autoagenda.locais (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  endereco VARCHAR(300),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autoagenda.configuracoes (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dias_funcionamento INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  hora_abertura TIME NOT NULL DEFAULT '07:00',
  hora_encerramento TIME NOT NULL DEFAULT '20:00',
  duracao_padrao_minutos INTEGER NOT NULL DEFAULT 50 CHECK (duracao_padrao_minutos BETWEEN 10 AND 240),
  intervalo_minutos INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_minutos BETWEEN 0 AND 120),
  lembrete_dia_anterior_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lembrete_dia_anterior_hora TIME NOT NULL DEFAULT '18:00',
  lembrete_horas_antes_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lembrete_horas_antes INTEGER NOT NULL DEFAULT 2 CHECK (lembrete_horas_antes BETWEEN 1 AND 24),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO autoagenda.configuracoes
  (id, dias_funcionamento, hora_abertura, hora_encerramento, duracao_padrao_minutos, intervalo_minutos)
VALUES (1, ARRAY[0,1,2,3,4,5,6], '07:00', '20:00', 50, 0)
ON CONFLICT (id) DO NOTHING;

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
  plan_id INTEGER REFERENCES autoagenda.planos_aula(id) ON DELETE SET NULL,
  numero_plano INTEGER,
  aulas_unidades INTEGER NOT NULL DEFAULT 1,
  excecao_plano BOOLEAN NOT NULL DEFAULT FALSE,
  arquivada BOOLEAN NOT NULL DEFAULT FALSE,
  arquivada_em TIMESTAMP,
  reposicao_de_id INTEGER REFERENCES autoagenda.aulas(id) ON DELETE RESTRICT,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migrações seguras para instalações anteriores.
ALTER TABLE autoagenda.alunos ADD COLUMN IF NOT EXISTS cpf VARCHAR(11);
CREATE UNIQUE INDEX IF NOT EXISTS ux_autoagenda_alunos_cpf
  ON autoagenda.alunos(cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';

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
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS arquivada BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMP;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS reposicao_de_id INTEGER;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_status VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO';
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_origem VARCHAR(20) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS confirmacao_atualizada_em TIMESTAMP;

ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_ativo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_hora TIME NOT NULL DEFAULT '18:00';
ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes_ativo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE autoagenda.configuracoes ADD COLUMN IF NOT EXISTS lembrete_horas_antes INTEGER NOT NULL DEFAULT 2;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_em TIMESTAMP;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_enviado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_dia_anterior_enviado_em TIMESTAMP;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_em TIMESTAMP;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_enviado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE autoagenda.aulas ADD COLUMN IF NOT EXISTS lembrete_horas_antes_enviado_em TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_lembrete_dia ON autoagenda.aulas(lembrete_dia_anterior_em);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_lembrete_horas ON autoagenda.aulas(lembrete_horas_antes_em);

UPDATE autoagenda.aulas
SET confirmacao_status = 'CONFIRMADA', confirmacao_origem = 'SISTEMA',
    confirmacao_atualizada_em = COALESCE(confirmacao_atualizada_em, atualizado_em, NOW())
WHERE status = 'CONFIRMADA' AND confirmacao_status = 'AGUARDANDO' AND confirmacao_atualizada_em IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aulas_confirmacao_status_check' AND conrelid='autoagenda.aulas'::regclass) THEN
    ALTER TABLE autoagenda.aulas ADD CONSTRAINT aulas_confirmacao_status_check CHECK (confirmacao_status IN ('AGUARDANDO','CONFIRMADA','PEDIU_REAGENDAMENTO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aulas_confirmacao_origem_check' AND conrelid='autoagenda.aulas'::regclass) THEN
    ALTER TABLE autoagenda.aulas ADD CONSTRAINT aulas_confirmacao_origem_check CHECK (confirmacao_origem IN ('MANUAL','WHATSAPP','SISTEMA'));
  END IF;
END $$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aulas_reposicao_de_id_fkey'
      AND conrelid = 'autoagenda.aulas'::regclass
  ) THEN
    ALTER TABLE autoagenda.aulas
      ADD CONSTRAINT aulas_reposicao_de_id_fkey
      FOREIGN KEY (reposicao_de_id) REFERENCES autoagenda.aulas(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_data ON autoagenda.aulas(data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_ativas_data ON autoagenda.aulas(data_aula, hora_inicio) WHERE arquivada = FALSE;
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_instrutor_data ON autoagenda.aulas(instrutor_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_veiculo_data ON autoagenda.aulas(veiculo_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_aluno_data ON autoagenda.aulas(aluno_id, data_aula);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_plan ON autoagenda.aulas(plan_id, data_aula, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_autoagenda_aulas_reposicao ON autoagenda.aulas(reposicao_de_id) WHERE reposicao_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autoagenda_planos_aluno_ativo ON autoagenda.planos_aula(aluno_id, ativo);
