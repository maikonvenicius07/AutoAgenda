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
  'POST /api/aulas/:id/reposicao','PUT /api/aulas/:id/serie','PATCH /api/aulas/:id/confirmacao','PATCH /api/aulas/:id/status',
  'GET /api/configuracoes/lembretes','PUT /api/configuracoes/lembretes','GET /api/lembretes','POST /api/lembretes/processar-agora',
  'GET /api/configuracoes/email','PUT /api/configuracoes/email','POST /api/email/processar-agora'
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
test('WhatsApp Cloud API usa endpoint oficial /messages', server.includes('https://graph.facebook.com/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages'));
test('credenciais do WhatsApp ficam somente em variáveis de ambiente', ['WHATSAPP_CLOUD_API_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','WHATSAPP_TEMPLATE_LEMBRETE'].every(x=>server.includes(x)) && !['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID'].some(x=>app.includes(x)||html.includes(x)));
test('envio automático fica desativado por padrão', schema.includes('whatsapp_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE') && server.includes('whatsapp_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE'));
test('fila de lembretes possui estados auditáveis', ['PENDENTE','PROCESSANDO','ENVIADO','FALHOU','CANCELADO'].every(x=>server.includes(`'${x}'`)) && schema.includes('autoagenda.lembrete_envios'));
test('worker evita concorrência entre instâncias', server.includes('pg_try_advisory_lock(33003300)') && server.includes('pg_advisory_unlock(33003300)'));
test('worker não repete falha automaticamente', server.includes("WHERE le.status='PENDENTE'") && !server.includes("WHERE le.status IN ('PENDENTE','FALHOU')"));
test('lembrete manual permanece disponível', app.includes('WhatsApp manual') && app.includes('/whatsapp/aula/'));
test('interface possui controle de automação oficial', html.includes('cfgWhatsAppAutoAtivo') && html.includes('processarLembretesAgora') && app.includes('whatsapp_api_configurada'));
test('histórico de lembretes entra no backup completo', server.includes("lembrete_envios: { tabela: 'lembrete_envios'"));

test('API de e-mail usa endpoint HTTPS oficial do Resend', server.includes("fetch('https://api.resend.com/emails'"));
test('credenciais de e-mail ficam somente no backend', ['RESEND_API_KEY','EMAIL_FROM'].every(x=>server.includes(x)) && !['RESEND_API_KEY','EMAIL_FROM','EMAIL_REPLY_TO'].some(x=>app.includes(x)||html.includes(x)));
test('e-mail automático nasce desligado', schema.includes('email_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE') && server.includes('email_automatico_ativo BOOLEAN NOT NULL DEFAULT FALSE'));
test('fila de e-mail possui estados auditáveis', schema.includes('autoagenda.email_envios') && ['PENDENTE','PROCESSANDO','ENVIADO','FALHOU','CANCELADO'].every(x=>server.includes(`'${x}'`)));
test('e-mail usa chave de idempotência', server.includes("'Idempotency-Key': chaveEmailSeguro(envio.chave_idempotencia)") && schema.includes('chave_idempotencia VARCHAR(256) NOT NULL UNIQUE'));
test('worker de e-mail evita concorrência entre instâncias', server.includes('pg_try_advisory_lock(34003400)') && server.includes('pg_advisory_unlock(34003400)'));
test('e-mail não bloqueia operação principal', server.includes('dispararEmailAulaSeguro') && server.includes('setImmediate(async () =>'));
test('aluno sem e-mail é tratado sem quebrar a agenda', server.includes("motivo:'SEM_EMAIL_VALIDO'"));
test('interface possui controle de e-mail automático', html.includes('cfgEmailAutoAtivo') && html.includes('processarEmailsAgora') && app.includes('email_api_configurada'));
test('histórico de e-mails entra no backup completo', server.includes("email_envios: { tabela: 'email_envios'"));
test('plano automático possui e-mail resumo', server.includes("'PLANO_AGENDADO'") && server.includes('dispararEmailPlanoSeguro(planId'));
test('eventos de e-mail cobrem agendamento, lembrete, reagendamento e cancelamento', ['AGENDAMENTO','LEMBRETE_DIA_ANTERIOR','LEMBRETE_HORAS_ANTES','REAGENDAMENTO','CANCELAMENTO'].every(x=>server.includes(`'${x}'`)));

test('schema contém tabelas principais', ['alunos','instrutores','veiculos','locais','aulas','planos_aula','financeiro','usuarios','sessoes','configuracoes','lembrete_envios','email_envios'].every(t=>schema.includes(`autoagenda.${t}`)));
const deps = Object.keys(pkg.dependencies||{}).sort();
test('dependências diretas esperadas', JSON.stringify(deps)===JSON.stringify(['dotenv','express','pg']), deps.join(', '));
test('sem automação não oficial de WhatsApp Web', !deps.some(d=>['whatsapp-web.js','puppeteer','playwright','selenium-webdriver'].includes(d)) && !/whatsapp-web\.js|puppeteer|playwright|selenium-webdriver/i.test(server));
test('nenhum .env versionado no pacote', !exists('.env'));

for (const r of results) console.log(`${r.ok?'OK':'FALHA'} | ${r.name}${r.detail?' | '+r.detail:''}`);
console.log(`\nResumo: ${results.length-failed}/${results.length} testes aprovados.`);
process.exit(failed ? 1 : 0);
