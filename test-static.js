const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));
let failed = 0;
const results = [];
function test(name, ok, detail='') {
  results.push({name, ok, detail});
  if (!ok) failed++;
}

for (const f of ['server.js','package.json','package-lock.json','public/index.html','public/app.js','public/style.css','sql/schema.sql','render.yaml']) {
  test(`arquivo essencial: ${f}`, exists(f));
}

const pkg = JSON.parse(read('package.json'));
const server = read('server.js');
const app = read('public/app.js');
const html = read('public/index.html');
const css = read('public/style.css');
const schema = read('sql/schema.sql');

const version = pkg.version;
test('versão server/package consistente', server.includes(`const APP_VERSION = '${version}';`), version);
test('versão dos assets consistente', html.includes(`style.css?v=${version}`) && html.includes(`app.js?v=${version}`), version);

for (const f of ['server.js','public/app.js']) {
  const r = cp.spawnSync(process.execPath, ['--check', path.join(root,f)], {encoding:'utf8'});
  test(`sintaxe JavaScript: ${f}`, r.status === 0, (r.stderr||'').trim());
}

const routeRe = /app\.(get|post|put|patch|delete)\(\s*(['"])(.*?)\2/gis;
const routes=[]; let m;
while ((m=routeRe.exec(server))) routes.push(`${m[1].toUpperCase()} ${m[3]}`);
const uniqueRoutes = new Set(routes);
test('rotas sem duplicidade', routes.length === uniqueRoutes.size, `${routes.length} rota(s), ${uniqueRoutes.size} única(s)`);
test('quantidade mínima de rotas esperada', routes.length >= 65, `${routes.length}`);

const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1]);
const dupIds=ids.filter((id,i)=>ids.indexOf(id)!==i);
test('IDs HTML sem duplicidade', dupIds.length===0, [...new Set(dupIds)].join(', '));

const localRefs=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(x=>x[1])
  .filter(x=>!x.match(/^(https?:|#|mailto:|tel:|javascript:|data:)/));
const missing=[];
for (const ref of localRefs) {
  const clean=ref.split('?')[0].split('#')[0];
  if (!clean) continue;
  if (!exists(path.join('public',clean.replace(/^\//,'')))) missing.push(ref);
}
test('referências locais do HTML existem', missing.length===0, missing.join(', '));

test('CSS com chaves balanceadas', (css.match(/{/g)||[]).length === (css.match(/}/g)||[]).length);
test('sem uso de eval()', !/\beval\s*\(/.test(server+app));

const requiredRoutes = [
  'POST /api/auth/login','POST /api/auth/logout','GET /api/auth/status',
  'GET /api/alunos','POST /api/alunos','PUT /api/alunos/:id','DELETE /api/alunos/:id','GET /api/alunos/:id/historico',
  'POST /api/instrutores','PUT /api/instrutores/:id','POST /api/veiculos','PUT /api/veiculos/:id','POST /api/locais','PUT /api/locais/:id',
  'GET /api/horarios-livres','GET /api/planos','POST /api/planos','POST /api/planos/preview','PATCH /api/planos/:id/encerrar',
  'GET /api/dashboard/resumo','GET /api/relatorios/resumo','GET /api/financeiro','POST /api/financeiro',
  'GET /api/backup/resumo','GET /api/backup/exportar','GET /api/aulas','POST /api/aulas','PUT /api/aulas/:id','DELETE /api/aulas/:id',
  'POST /api/aulas/:id/reposicao','PUT /api/aulas/:id/serie','PATCH /api/aulas/:id/confirmacao','PATCH /api/aulas/:id/status'
];
const routeSet=new Set(routes);
const missingRoutes=requiredRoutes.filter(r=>!routeSet.has(r));
test('rotas funcionais principais presentes', missingRoutes.length===0, missingRoutes.join(', '));

test('perfis ADMIN e INSTRUTOR presentes', server.includes("'ADMIN'") && server.includes("'INSTRUTOR'"));
test('barreira central de permissão do instrutor presente', server.includes('rotaPermitidaAoInstrutor') && server.includes("req.usuario?.perfil !== 'INSTRUTOR'"));
test('transações PostgreSQL presentes', server.includes("client.query('BEGIN')") && server.includes("client.query('COMMIT')") && server.includes("client.query('ROLLBACK')"));
test('bloqueios FOR UPDATE presentes', server.includes('FOR UPDATE'));
test('regras de conflito presentes', /conflito/i.test(server));
test('controle de saldo presente', /saldo/i.test(server));
test('data de nascimento presente', server.includes('data_nascimento') && /dataNascimento|data_nascimento/.test(app));
test('modo escuro presente', /dark/.test(app) && /dark/.test(html) && /dark/.test(css));
test('backup CSV/Excel/JSON declarado', server.includes("formatos: ['csv','xlsx','json']") && server.includes("['csv','xlsx','json'].includes(formato)"));
test('backup sem credenciais declarado', server.includes('credenciais_incluidas: false'));
test('confirmação pública por token presente', server.includes("app.get('/confirmar/:token'") && server.includes("app.post('/confirmar/:token/acao'"));
test('token público usa randomBytes e hash SHA-256', server.includes('crypto.randomBytes(32)') && server.includes('confirmacao_token_hash'));
test('token de confirmação é de uso único', server.includes('confirmacao_token_usado_em=NOW()') && server.includes('confirmacao_token_usado_em IS NULL'));
test('link de confirmação entra no WhatsApp', server.includes('linkConfirmacao') && server.includes('/confirmar/${tokenConfirmacao}'));
test('backup exclui metadados do token', server.includes("['confirmacao_token_hash','confirmacao_token_expira_em','confirmacao_token_usado_em']"));
test('API comum remove metadados do token', server.includes('function aulaSemMetadadosToken') && server.includes('res.json(aulaSemMetadadosToken'));
test('schema contém campos do token público', ['confirmacao_token_hash','confirmacao_token_expira_em','confirmacao_token_usado_em'].every(c=>schema.includes(c)));

test('schema contém tabelas principais', ['alunos','instrutores','veiculos','locais','aulas','planos_aula','financeiro','usuarios','sessoes','configuracoes'].every(t=>schema.includes(`autoagenda.${t}`)));
const deps = Object.keys(pkg.dependencies||{}).sort();
test('dependências diretas esperadas', JSON.stringify(deps)===JSON.stringify(['dotenv','express','pg']), deps.join(', '));
test('nenhum .env versionado no pacote', !exists('.env'));

for (const r of results) console.log(`${r.ok?'OK':'FALHA'} | ${r.name}${r.detail?' | '+r.detail:''}`);
console.log(`\nResumo: ${results.length-failed}/${results.length} testes aprovados.`);
process.exit(failed ? 1 : 0);
