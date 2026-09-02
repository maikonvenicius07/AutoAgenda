CREATE TABLE IF NOT EXISTS instrutores (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  whatsapp VARCHAR(30),
  email VARCHAR(180),
  categorias VARCHAR(20) DEFAULT 'AB',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alunos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  whatsapp VARCHAR(30) NOT NULL,
  email VARCHAR(180),
  categoria VARCHAR(10) DEFAULT 'B',
  aulas_contratadas INTEGER NOT NULL DEFAULT 20,
  aulas_realizadas INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS veiculos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  placa VARCHAR(15),
  categoria VARCHAR(10) DEFAULT 'B',
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS locais (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  endereco VARCHAR(300),
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS aulas (
  id SERIAL PRIMARY KEY,
  aluno_id INTEGER NOT NULL REFERENCES alunos(id),
  instrutor_id INTEGER NOT NULL REFERENCES instrutores(id),
  veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
  local_id INTEGER NOT NULL REFERENCES locais(id),
  data_aula DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  duracao_minutos INTEGER NOT NULL DEFAULT 50,
  status VARCHAR(30) NOT NULL DEFAULT 'AGENDADA',
  observacoes TEXT,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aulas_data ON aulas(data_aula);

INSERT INTO instrutores (nome, whatsapp, email, categorias)
SELECT 'Instrutor Principal', '(69) 99999-0000', 'instrutor@autoagenda.com.br', 'AB'
WHERE NOT EXISTS (SELECT 1 FROM instrutores);

INSERT INTO veiculos (nome, placa, categoria)
SELECT 'Carro de Aula', 'AAA1A11', 'B'
WHERE NOT EXISTS (SELECT 1 FROM veiculos);

INSERT INTO locais (nome, endereco)
SELECT 'Ponto de Encontro', 'Endereço a definir'
WHERE NOT EXISTS (SELECT 1 FROM locais);
