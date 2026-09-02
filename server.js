require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ok:true}); }
  catch (e) { console.error(e); res.status(500).json({ok:false}); }
});

app.get('/api/alunos', async (_, res) => {
  try { const r = await pool.query('SELECT * FROM alunos WHERE ativo=TRUE ORDER BY nome'); res.json(r.rows); }
  catch (e) { console.error(e); res.status(500).json({error:'Erro ao consultar alunos.'}); }
});

app.post('/api/alunos', async (req, res) => {
  const {nome, whatsapp, email, categoria='B', aulas_contratadas=20, observacoes=''} = req.body;
  if (!nome || !whatsapp) return res.status(400).json({error:'Nome e WhatsApp são obrigatórios.'});
  try {
    const r = await pool.query(`INSERT INTO alunos
      (nome,whatsapp,email,categoria,aulas_contratadas,observacoes)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nome.trim(), whatsapp.trim(), email||null, categoria, Number(aulas_contratadas)||20, observacoes]);
    res.status(201).json(r.rows[0]);
  } catch(e){ console.error(e); res.status(500).json({error:'Erro ao cadastrar aluno.'}); }
});

app.get('/api/instrutores', async (_, res) => {
  try { const r=await pool.query('SELECT * FROM instrutores WHERE ativo=TRUE ORDER BY nome'); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:'Erro ao consultar instrutores.'}); }
});
app.get('/api/veiculos', async (_, res) => {
  try { const r=await pool.query('SELECT * FROM veiculos WHERE ativo=TRUE ORDER BY nome'); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:'Erro ao consultar veículos.'}); }
});
app.get('/api/locais', async (_, res) => {
  try { const r=await pool.query('SELECT * FROM locais WHERE ativo=TRUE ORDER BY nome'); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:'Erro ao consultar locais.'}); }
});

app.get('/api/aulas', async (_, res) => {
  try {
    const r=await pool.query(`SELECT a.*, al.nome aluno_nome, i.nome instrutor_nome,
      v.nome veiculo_nome, v.placa veiculo_placa, l.nome local_nome, l.endereco local_endereco
      FROM aulas a JOIN alunos al ON al.id=a.aluno_id
      JOIN instrutores i ON i.id=a.instrutor_id
      JOIN veiculos v ON v.id=a.veiculo_id
      JOIN locais l ON l.id=a.local_id
      ORDER BY a.data_aula,a.hora_inicio`);
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:'Erro ao consultar aulas.'}); }
});

app.post('/api/aulas', async (req,res) => {
  const {aluno_id,instrutor_id,veiculo_id,local_id,data_aula,hora_inicio,duracao_minutos=50,observacoes=''}=req.body;
  if(!aluno_id||!instrutor_id||!veiculo_id||!local_id||!data_aula||!hora_inicio)
    return res.status(400).json({error:'Preencha todos os dados obrigatórios.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const inicio=`${data_aula} ${hora_inicio}:00`;
    const c=await client.query(`SELECT a.id,a.hora_inicio FROM aulas a
      WHERE a.data_aula=$1 AND a.status NOT IN ('CANCELADA','REMARCADA')
      AND (a.aluno_id=$2 OR a.instrutor_id=$3 OR a.veiculo_id=$4)
      AND (a.data_aula+a.hora_inicio) < ($5::timestamp + ($6 || ' minutes')::interval)
      AND $5::timestamp < (a.data_aula+a.hora_inicio + (a.duracao_minutos || ' minutes')::interval)
      LIMIT 1`,[data_aula,aluno_id,instrutor_id,veiculo_id,inicio,Number(duracao_minutos)]);
    if(c.rowCount){ await client.query('ROLLBACK'); return res.status(409).json({error:'Conflito de horário.', conflito:c.rows[0]}); }
    const r=await client.query(`INSERT INTO aulas
      (aluno_id,instrutor_id,veiculo_id,local_id,data_aula,hora_inicio,duracao_minutos,status,observacoes)
      VALUES($1,$2,$3,$4,$5,$6,$7,'AGENDADA',$8) RETURNING *`,
      [aluno_id,instrutor_id,veiculo_id,local_id,data_aula,hora_inicio,Number(duracao_minutos),observacoes]);
    await client.query('COMMIT'); res.status(201).json(r.rows[0]);
  }catch(e){ await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Erro ao agendar aula.'}); }
  finally{ client.release(); }
});

app.get('*', (_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`AutoAgenda rodando na porta ${PORT}`));
