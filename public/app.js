const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let alunos = [], instrutores = [], veiculos = [], locais = [], aulas = [], planos = [];
let confirmAction = null;
let ultimoPreviewPlano = null;

const iso = () => {
  const d = new Date(), o = d.getTimezoneOffset();
  return new Date(d - o * 60000).toISOString().slice(0, 10);
};
const hora = h => h ? String(h).slice(0, 5) : '';
const dataISO = d => String(d || '').slice(0, 10);
const fmtData = d => dataISO(d).split('-').reverse().join('/');
const addDaysISO = (data, dias) => {
  const [y,m,d] = dataISO(data).split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() + dias);
  return x.toISOString().slice(0, 10);
};
const inicioSemanaISO = data => {
  const [y,m,d] = dataISO(data).split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  const day = x.getUTCDay();
  const desloc = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + desloc);
  return x.toISOString().slice(0, 10);
};
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(u, o = {}) {
  const { headers = {}, ...rest } = o;
  const r = await fetch(u, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(d.error || 'Erro');
    e.status = r.status;
    e.data = d;
    throw e;
  }
  return d;
}

function toast(t) {
  $('#toast').textContent = t;
  $('#toast').classList.remove('hide');
  clearTimeout(window.__t);
  window.__t = setTimeout(() => $('#toast').classList.add('hide'), 3200);
}
function open(id) { $('#' + id).classList.remove('hide'); }
function close(id) { $('#' + id).classList.add('hide'); }

function abrirTab(id) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === id));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === id));
  if (id === 'semana') renderSemana();
}
$$('.tab').forEach(b => b.onclick = () => abrirTab(b.dataset.tab));
$$('[data-close]').forEach(b => b.onclick = () => close(b.dataset.close));

function statusLabel(s) {
  return ({
    AGENDADA: '⏳ Agendada',
    CONFIRMADA: '✅ Confirmada',
    REALIZADA: '🏁 Realizada',
    REMARCADA: '🔄 Remarcada',
    CANCELADA: '❌ Cancelada',
    FALTOU: '🚫 Faltou'
  })[s] || s;
}

function realizadasAluno(a) {
  const anteriores = Number(
    a.aulas_realizadas_anteriores ?? a.aulas_realizadas ?? 0
  );
  const sistema = Number(a.realizadas_sistema || 0);
  return Math.max(0, anteriores) + Math.max(0, sistema);
}

function studentHtml(a) {
  const contratadas = Number(a.aulas_contratadas || 0);
  const realizadas = realizadasAluno(a);
  const agendadas = Number(a.aulas_agendadas || 0);
  const aindaProgramar = Math.max(0, contratadas - realizadas - agendadas);
  const restantes = Math.max(0, contratadas - realizadas);
  const pct = contratadas ? Math.min(100, Math.round(realizadas / contratadas * 100)) : 0;

  return `<article class="student">
    <div class="student-top">
      <div>
        <h3>${esc(a.nome)}</h3>
        <p>📲 ${esc(a.whatsapp)}</p>
        <p>📧 ${esc(a.email || 'Sem e-mail')}</p>
        <p>🚘 Categoria ${esc(a.categoria)}</p>
      </div>
      <span class="remaining-badge">${restantes} restantes</span>
    </div>

    <div class="student-numbers">
      <div><span>Contratadas</span><b>${contratadas}</b></div>
      <div><span>Realizadas</span><b>${realizadas}</b></div>
      <div><span>Agendadas</span><b>${agendadas}</b></div>
      <div><span>A programar</span><b>${aindaProgramar}</b></div>
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <small class="progress-text">${realizadas} de ${contratadas} aulas realizadas</small>

    <div class="actions-row">
      <button type="button" class="mini plan" data-plan-aluno="${a.id}">📅 Montar agenda</button>
      <button type="button" class="mini edit" data-edit-aluno="${a.id}">✏️ Editar</button>
      <button type="button" class="mini delete" data-del-aluno="${a.id}">🗑️ Excluir</button>
    </div>
  </article>`;
}

function aulaHtml(x, comAcoes = false) {
  const plano = x.plan_id ? `<span class="plan-badge">🔁 Plano ${x.numero_plano || ''}${x.excecao_plano ? ' • alterada' : ''}</span>` : '';
  const unidades = Number(x.aulas_unidades || 1);
  const unidadeTxt = unidades > 1 ? ` · ${unidades} aulas consecutivas` : '';
  const reposicao = comAcoes && ['CANCELADA','FALTOU'].includes(x.status)
    ? `<button type="button" class="mini plan" data-repor-aula="${x.id}">↪️ Repor</button>` : '';

  return `<div class="lesson ${String(x.status || '').toLowerCase()}">
    <div class="lesson-time">${hora(x.hora_inicio)}</div>
    <div class="lesson-main">
      <b>${esc(x.aluno_nome)}</b>
      <small>👨‍🏫 ${esc(x.instrutor_nome)} · 🚗 ${esc(x.veiculo_nome)} ${esc(x.veiculo_placa || '')}</small>
      <small>📍 ${esc(x.local_nome)} · ${statusLabel(x.status)}${unidadeTxt}</small>
      ${plano}
    </div>
    ${comAcoes ? `<div class="actions-row lesson-actions">
      ${reposicao}
      <button type="button" class="mini edit" data-edit-aula="${x.id}">✏️ Alterar</button>
      <button type="button" class="mini delete" data-del-aula="${x.id}">🗑️ Excluir</button>
    </div>` : ''}
  </div>`;
}

const nomesDias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function planoHtml(p) {
  const dias = (Array.isArray(p.dias_semana) ? p.dias_semana : []).map(d => nomesDias[Number(d)]).join(', ');
  return `<article class="student plan-card ${p.ativo ? '' : 'inactive'}">
    <div class="student-top">
      <div>
        <h3>🔁 ${esc(p.aluno_nome)}</h3>
        <p><b>${dias || 'Dia fixo'}</b> às <b>${hora(p.hora_inicio)}</b></p>
        <p>👨‍🏫 ${esc(p.instrutor_nome)} · 🚗 ${esc(p.veiculo_nome)} ${esc(p.veiculo_placa || '')}</p>
        <p>📍 ${esc(p.local_nome)}</p>
      </div>
      <span class="remaining-badge">${p.ativo ? 'Ativo' : 'Encerrado'}</span>
    </div>
    <div class="student-numbers plan-numbers">
      <div><span>Aulas</span><b>${p.total_aulas}</b></div>
      <div><span>Encontros</span><b>${p.encontros_gerados}</b></div>
      <div><span>Por encontro</span><b>${p.aulas_por_encontro}</b></div>
      <div><span>Início</span><b class="small-value">${fmtData(p.data_inicio)}</b></div>
    </div>
    ${p.ativo ? `<div class="actions-row">
      <button type="button" class="mini secondary" data-encerrar-plano="${p.id}">⏹️ Encerrar e manter aulas</button>
      <button type="button" class="mini delete" data-encerrar-cancelar="${p.id}">🗑️ Encerrar e cancelar futuras</button>
    </div>` : ''}
  </article>`;
}

function configItemHtml(tipo, x) {
  const uso = `${Number(x.planos_ativos || 0)} plano(s) · ${Number(x.aulas_futuras || 0)} aula(s) futura(s)`;
  if (tipo === 'instrutor') {
    return `<div class="config-item"><div><b>${esc(x.nome)}</b><small>${esc(x.categorias || 'AB')} · ${esc(x.whatsapp || 'Sem WhatsApp')}</small><small>${uso}</small></div><div class="config-actions"><button type="button" class="mini edit" data-edit-instrutor="${x.id}">✏️</button><button type="button" class="mini delete" data-del-instrutor="${x.id}">🗑️</button></div></div>`;
  }
  if (tipo === 'veiculo') {
    return `<div class="config-item"><div><b>${esc(x.nome)}</b><small>${esc(x.placa || 'Sem placa')} · Categoria ${esc(x.categoria || 'B')}</small><small>${uso}</small></div><div class="config-actions"><button type="button" class="mini edit" data-edit-veiculo="${x.id}">✏️</button><button type="button" class="mini delete" data-del-veiculo="${x.id}">🗑️</button></div></div>`;
  }
  return `<div class="config-item"><div><b>${esc(x.nome)}</b><small>${esc(x.endereco || 'Sem endereço informado')}</small><small>${uso}</small></div><div class="config-actions"><button type="button" class="mini edit" data-edit-local="${x.id}">✏️</button><button type="button" class="mini delete" data-del-local="${x.id}">🗑️</button></div></div>`;
}

function renderConfiguracoes() {
  $('#cfgQtdInstrutores').textContent = instrutores.length;
  $('#cfgQtdVeiculos').textContent = veiculos.length;
  $('#cfgQtdLocais').textContent = locais.length;
  $('#listaInstrutoresConfig').innerHTML = instrutores.length ? instrutores.map(x => configItemHtml('instrutor', x)).join('') : '<div class="empty small-empty">Nenhum instrutor ativo.</div>';
  $('#listaVeiculosConfig').innerHTML = veiculos.length ? veiculos.map(x => configItemHtml('veiculo', x)).join('') : '<div class="empty small-empty">Nenhum veículo ativo.</div>';
  $('#listaLocaisConfig').innerHTML = locais.length ? locais.map(x => configItemHtml('local', x)).join('') : '<div class="empty small-empty">Nenhum local ativo.</div>';
}

function aulaSemanaHtml(a) {
  const cls = String(a.status || '').toLowerCase();
  return `<div class="week-lesson ${cls}" data-week-edit="${a.id}"><div class="week-lesson-time">${hora(a.hora_inicio)}</div><b>${esc(a.aluno_nome)}</b><small>👨‍🏫 ${esc(a.instrutor_nome)}</small><small>🚗 ${esc(a.veiculo_nome)}${a.veiculo_placa ? ' · ' + esc(a.veiculo_placa) : ''}</small><small>${statusLabel(a.status)}</small></div>`;
}

function renderSemana() {
  const ref = $('#filtroSemana')?.value || iso();
  const inicio = inicioSemanaISO(ref);
  const fim = addDaysISO(inicio, 6);
  if ($('#periodoSemana')) $('#periodoSemana').textContent = `${fmtData(inicio)} a ${fmtData(fim)}`;
  const filtroInstrutor = Number($('#filtroInstrutorSemana')?.value || 0);
  const diasLongos = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
  const hoje = iso();
  const colunas = Array.from({length: 7}, (_, i) => {
    const data = addDaysISO(inicio, i);
    const doDia = aulas.filter(a => dataISO(a.data_aula) === data && (!filtroInstrutor || Number(a.instrutor_id) === filtroInstrutor));
    return `<section class="week-day ${data === hoje ? 'today' : ''}"><header class="week-day-head"><div><b>${diasLongos[i]}</b><span>${fmtData(data)}</span></div><button type="button" class="mini secondary" data-new-week-day="${data}" title="Nova aula neste dia">＋</button></header><div class="week-day-body">${doDia.length ? doDia.map(aulaSemanaHtml).join('') : '<div class="week-empty">Livre</div>'}</div></section>`;
  }).join('');
  $('#agendaSemanal').innerHTML = colunas;
  $$('[data-new-week-day]').forEach(b => b.onclick = () => novaAula({ data: b.dataset.newWeekDay, hora: '08:00', instrutor_id: filtroInstrutor || undefined }));
  $$('[data-week-edit]').forEach(b => b.onclick = () => editarAula(Number(b.dataset.weekEdit)));
}

function render() {
  $('#sAlunos').textContent = alunos.length;
  const h = iso();
  const ah = aulas.filter(a => dataISO(a.data_aula) === h && a.status !== 'CANCELADA');
  $('#sHoje').textContent = ah.length;
  $('#sAgendadas').textContent = aulas
    .filter(a => dataISO(a.data_aula) >= h && ['AGENDADA','CONFIRMADA'].includes(a.status))
    .reduce((s, a) => s + Number(a.aulas_unidades || 1), 0);
  $('#sPlanos').textContent = planos.filter(p => p.ativo).length;

  $('#listaAlunos').innerHTML = alunos.length ? alunos.map(studentHtml).join('') : '<div class="empty">Nenhum aluno cadastrado.</div>';
  $('#hoje').innerHTML = ah.length ? ah.map(a => aulaHtml(a, false)).join('') : '<div class="empty">Nenhuma aula hoje.</div>';

  const f = $('#filtroData').value;
  const fa = aulas.filter(a => dataISO(a.data_aula) === f);
  $('#listaAgenda').innerHTML = fa.length ? fa.map(a => aulaHtml(a, true)).join('') : '<div class="empty">Nenhuma aula nesta data.</div>';
  $('#listaPlanos').innerHTML = planos.length ? planos.map(planoHtml).join('') : '<div class="empty"><b>Nenhum plano automático criado ainda.</b><br><br>Clique em <b>+ Criar plano automático</b> acima ou em <b>📅 Montar agenda</b> no cartão do aluno.</div>';

  renderConfiguracoes();
  preencherSelects();
  renderSemana();
  bindDynamic();
}

function preencherSelects() {
  const optsAluno = alunos.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  const optsInstrutor = instrutores.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  const optsVeiculo = veiculos.map(x => `<option value="${x.id}">${esc(x.nome)}${x.placa ? ' - ' + esc(x.placa) : ''}</option>`).join('');
  const optsLocal = locais.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');

  $('#aAluno').innerHTML = optsAluno;
  $('#aInstrutor').innerHTML = optsInstrutor;
  $('#aVeiculo').innerHTML = optsVeiculo;
  $('#aLocal').innerHTML = optsLocal;
  $('#pInstrutor').innerHTML = optsInstrutor;
  $('#pVeiculo').innerHTML = optsVeiculo;
  $('#pLocal').innerHTML = optsLocal;
  const escolher = $('#escolherAlunoPlano');
  if (escolher) escolher.innerHTML = optsAluno;

  const filtroSemana = $('#filtroInstrutorSemana');
  if (filtroSemana) {
    const atual = filtroSemana.value;
    filtroSemana.innerHTML = '<option value="">Todos os instrutores</option>' + optsInstrutor;
    if ([...filtroSemana.options].some(o => o.value === atual)) filtroSemana.value = atual;
  }
}

function bindDynamic() {
  $$('[data-edit-aluno]').forEach(b => b.onclick = () => editarAluno(Number(b.dataset.editAluno)));
  $$('[data-del-aluno]').forEach(b => b.onclick = () => pedirExcluirAluno(Number(b.dataset.delAluno)));
  $$('[data-plan-aluno]').forEach(b => b.onclick = () => abrirPlano(Number(b.dataset.planAluno)));
  $$('[data-edit-aula]').forEach(b => b.onclick = () => editarAula(Number(b.dataset.editAula)));
  $$('[data-del-aula]').forEach(b => b.onclick = () => pedirExcluirAula(Number(b.dataset.delAula)));
  $$('[data-repor-aula]').forEach(b => b.onclick = () => reporAula(Number(b.dataset.reporAula)));
  $$('[data-encerrar-plano]').forEach(b => b.onclick = () => pedirEncerrarPlano(Number(b.dataset.encerrarPlano), false));
  $$('[data-encerrar-cancelar]').forEach(b => b.onclick = () => pedirEncerrarPlano(Number(b.dataset.encerrarCancelar), true));
  $$('[data-edit-instrutor]').forEach(b => b.onclick = () => editarInstrutor(Number(b.dataset.editInstrutor)));
  $$('[data-del-instrutor]').forEach(b => b.onclick = () => pedirExcluirRecurso('instrutor', Number(b.dataset.delInstrutor)));
  $$('[data-edit-veiculo]').forEach(b => b.onclick = () => editarVeiculo(Number(b.dataset.editVeiculo)));
  $$('[data-del-veiculo]').forEach(b => b.onclick = () => pedirExcluirRecurso('veiculo', Number(b.dataset.delVeiculo)));
  $$('[data-edit-local]').forEach(b => b.onclick = () => editarLocal(Number(b.dataset.editLocal)));
  $$('[data-del-local]').forEach(b => b.onclick = () => pedirExcluirRecurso('local', Number(b.dataset.delLocal)));
}

async function load() {
  try {
    [alunos, instrutores, veiculos, locais, aulas, planos] = await Promise.all([
      api('/api/alunos'), api('/api/instrutores'), api('/api/veiculos'), api('/api/locais'), api('/api/aulas'), api('/api/planos')
    ]);
    render();
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar dados');
  }
}

async function health() {
  try {
    const h = await api('/api/health');
    const seguranca = h.auth_required ? ' · 🔒 acesso protegido' : ' · ⚠️ acesso sem senha';
    $('#db').textContent = `🟢 Banco conectado — AutoAgenda V${h.version || '1.5'}${seguranca}.`;
    $('#db').className = h.auth_required ? 'db ok' : 'db warn';
  } catch {
    $('#db').textContent = '🔴 Banco não conectado. Verifique DATABASE_URL no Render.';
    $('#db').className = 'db fail';
  }
}

// ========================= ALUNOS =========================
function novoAluno() {
  $('#fAluno').reset();
  $('#alunoId').value = '';
  $('#contratadas').value = 20;
  $('#realizadas').value = 0;
  $('#tituloAluno').textContent = 'Novo aluno';
  $('#salvarAluno').textContent = 'Salvar aluno';
  $('#erroAluno').classList.add('hide');
  open('mAluno');
}

function editarAluno(id) {
  const a = alunos.find(x => Number(x.id) === id);
  if (!a) return;
  $('#alunoId').value = a.id;
  $('#nome').value = a.nome || '';
  $('#whats').value = a.whatsapp || '';
  $('#email').value = a.email || '';
  $('#cat').value = a.categoria || 'B';
  $('#contratadas').value = a.aulas_contratadas || 20;
  $('#realizadas').value = Number(
    a.aulas_realizadas_anteriores ?? a.aulas_realizadas ?? 0
  );
  $('#obs').value = a.observacoes || '';
  $('#tituloAluno').textContent = 'Editar aluno';
  $('#salvarAluno').textContent = 'Salvar alterações';
  $('#erroAluno').classList.add('hide');
  open('mAluno');
}

function confirmar(titulo, texto, acao, botao = 'Confirmar') {
  $('#confirmTitulo').textContent = titulo;
  $('#confirmTexto').textContent = texto;
  $('#confirmSim').textContent = botao;
  confirmAction = acao;
  open('confirm');
}
$('#confirmNao').onclick = () => { confirmAction = null; close('confirm'); };
$('#confirmSim').onclick = async () => {
  const fn = confirmAction;
  confirmAction = null;
  close('confirm');
  if (fn) await fn();
};

function pedirExcluirAluno(id) {
  const a = alunos.find(x => Number(x.id) === id);
  if (!a) return;
  confirmar('Excluir aluno?', `O aluno ${a.nome} deixará de aparecer na lista. As aulas antigas vinculadas a ele serão preservadas.`, async () => {
    try {
      const r = await api('/api/alunos/' + id, { method: 'DELETE' });
      const extras = Number(r.aulas_futuras_canceladas || 0)
        ? ` · ${r.aulas_futuras_canceladas} aula(s) futura(s) cancelada(s)`
        : '';
      toast(`✅ Aluno excluído${extras}.`);
      await load();
    } catch (e) { toast(e.message); }
  }, 'Excluir');
}

$('#novoAluno').onclick = novoAluno;
$('#fAluno').onsubmit = async e => {
  e.preventDefault();
  $('#erroAluno').classList.add('hide');
  const id = Number($('#alunoId').value || 0);
  const payload = {
    nome: $('#nome').value,
    whatsapp: $('#whats').value,
    email: $('#email').value,
    categoria: $('#cat').value,
    aulas_contratadas: Number($('#contratadas').value),
    aulas_realizadas_anteriores: Number($('#realizadas').value),
    observacoes: $('#obs').value
  };
  try {
    await api(id ? '/api/alunos/' + id : '/api/alunos', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close('mAluno');
    toast(id ? '✅ Aluno atualizado.' : '✅ Aluno salvo no banco.');
    await load();
  } catch (x) {
    $('#erroAluno').textContent = x.message;
    $('#erroAluno').classList.remove('hide');
  }
};

// ========================= AULA MANUAL / EDIÇÃO =========================
function novaAula(prefill = null) {
  if (!alunos.length) return toast('Cadastre um aluno primeiro.');
  if (!instrutores.length || !veiculos.length || !locais.length) {
    toast('Cadastre pelo menos um instrutor, um veículo e um local em Configurações.');
    abrirTab('configuracoes');
    return;
  }
  $('#fAula').reset();
  $('#aulaId').value = '';
  $('#aulaPlanId').value = '';
  $('#aData').value = prefill?.data || $('#filtroData').value || iso();
  $('#aHora').value = prefill?.hora || '08:00';
  $('#aDur').value = String(prefill?.duracao || 50);
  $('#aUnidades').value = String(prefill?.unidades || 1);
  $('#aStatus').value = 'AGENDADA';
  $('#tituloAula').textContent = prefill?.reposicao ? 'Repor aula' : 'Nova aula';
  $('#salvarAula').textContent = prefill?.reposicao ? 'Agendar reposição' : 'Agendar aula';
  $('#erroAula').classList.add('hide');
  $('#serieBox').classList.add('hide');
  $('#aplicarProximas').checked = false;
  preencherSelects();
  if (prefill?.aluno_id) $('#aAluno').value = prefill.aluno_id;
  if (prefill?.instrutor_id) $('#aInstrutor').value = prefill.instrutor_id;
  if (prefill?.veiculo_id) $('#aVeiculo').value = prefill.veiculo_id;
  if (prefill?.local_id) $('#aLocal').value = prefill.local_id;
  $('#aObs').value = prefill?.observacoes || '';
  open('mAula');
}

function editarAula(id) {
  const a = aulas.find(x => Number(x.id) === id);
  if (!a) return;
  preencherSelects();
  $('#aulaId').value = a.id;
  $('#aulaPlanId').value = a.plan_id || '';
  $('#aAluno').value = a.aluno_id;
  $('#aInstrutor').value = a.instrutor_id;
  $('#aVeiculo').value = a.veiculo_id;
  $('#aLocal').value = a.local_id;
  $('#aData').value = dataISO(a.data_aula);
  $('#aHora').value = hora(a.hora_inicio);
  $('#aDur').value = String(a.duracao_minutos || 50);
  $('#aUnidades').value = String(a.aulas_unidades || 1);
  $('#aStatus').value = a.status || 'AGENDADA';
  $('#aObs').value = a.observacoes || '';
  $('#tituloAula').textContent = 'Alterar aula';
  $('#salvarAula').textContent = 'Salvar alterações';
  $('#erroAula').classList.add('hide');
  $('#aplicarProximas').checked = false;
  $('#serieBox').classList.toggle('hide', !a.plan_id);
  open('mAula');
}

function pedirExcluirAula(id) {
  const a = aulas.find(x => Number(x.id) === id);
  if (!a) return;
  confirmar('Excluir aula?', `Excluir definitivamente a aula de ${a.aluno_nome} em ${fmtData(a.data_aula)} às ${hora(a.hora_inicio)}?`, async () => {
    try {
      await api('/api/aulas/' + id, { method: 'DELETE' });
      toast('✅ Aula excluída.');
      await load();
    } catch (e) { toast(e.message); }
  }, 'Excluir');
}

function reporAula(id) {
  const a = aulas.find(x => Number(x.id) === id);
  if (!a) return;
  novaAula({
    reposicao: true,
    aluno_id: a.aluno_id,
    instrutor_id: a.instrutor_id,
    veiculo_id: a.veiculo_id,
    local_id: a.local_id,
    data: $('#filtroData').value || iso(),
    hora: hora(a.hora_inicio),
    duracao: a.duracao_minutos,
    unidades: a.aulas_unidades,
    observacoes: `Reposição da aula de ${fmtData(a.data_aula)}.`
  });
}

$('#novaAula').onclick = () => novaAula();
$('#novaAulaAgenda').onclick = () => novaAula();
$('#fAula').onsubmit = async e => {
  e.preventDefault();
  $('#erroAula').classList.add('hide');
  const id = Number($('#aulaId').value || 0);
  const planId = Number($('#aulaPlanId').value || 0);
  const payload = {
    aluno_id: Number($('#aAluno').value),
    instrutor_id: Number($('#aInstrutor').value),
    veiculo_id: Number($('#aVeiculo').value),
    local_id: Number($('#aLocal').value),
    data_aula: $('#aData').value,
    hora_inicio: $('#aHora').value,
    duracao_minutos: Number($('#aDur').value),
    aulas_unidades: Number($('#aUnidades').value),
    status: $('#aStatus').value,
    observacoes: $('#aObs').value
  };

  try {
    if (id && planId && $('#aplicarProximas').checked) {
      const r = await api(`/api/aulas/${id}/serie`, { method: 'PUT', body: JSON.stringify(payload) });
      toast(`✅ Esta aula e mais ${Math.max(0, Number(r.alteradas || 1) - 1)} próximas foram alteradas.`);
    } else {
      await api(id ? '/api/aulas/' + id : '/api/aulas', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      toast(id ? '✅ Aula alterada.' : '✅ Aula salva no banco.');
    }
    const dataEscolhida = $('#aData').value;
    close('mAula');
    $('#filtroData').value = dataEscolhida;
    await load();
  } catch (x) {
    let msg = x.message;
    if (x.status === 409) msg = x.data?.error || '⚠️ Conflito de horário. Escolha outro horário.';
    $('#erroAula').textContent = msg;
    $('#erroAula').classList.remove('hide');
  }
};

// ========================= CONFIGURAÇÕES =========================
function novoInstrutor() {
  $('#fInstrutor').reset(); $('#instrutorId').value = ''; $('#iCategorias').value = 'AB';
  $('#tituloInstrutor').textContent = 'Novo instrutor'; $('#erroInstrutor').classList.add('hide'); open('mInstrutor');
}
function editarInstrutor(id) {
  const x = instrutores.find(v => Number(v.id) === id); if (!x) return;
  $('#instrutorId').value = x.id; $('#iNome').value = x.nome || ''; $('#iWhats').value = x.whatsapp || ''; $('#iEmail').value = x.email || ''; $('#iCategorias').value = x.categorias || 'AB';
  $('#tituloInstrutor').textContent = 'Editar instrutor'; $('#erroInstrutor').classList.add('hide'); open('mInstrutor');
}
$('#novoInstrutor').onclick = novoInstrutor;
$('#fInstrutor').onsubmit = async e => {
  e.preventDefault(); $('#erroInstrutor').classList.add('hide');
  const id = Number($('#instrutorId').value || 0);
  const payload = { nome: $('#iNome').value, whatsapp: $('#iWhats').value, email: $('#iEmail').value, categorias: $('#iCategorias').value };
  try { await api(id ? `/api/instrutores/${id}` : '/api/instrutores', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); close('mInstrutor'); toast(id ? '✅ Instrutor atualizado.' : '✅ Instrutor cadastrado.'); await load(); abrirTab('configuracoes'); }
  catch (x) { $('#erroInstrutor').textContent = x.message; $('#erroInstrutor').classList.remove('hide'); }
};

function novoVeiculo() {
  $('#fVeiculo').reset(); $('#veiculoId').value = ''; $('#vCategoria').value = 'B'; $('#tituloVeiculo').textContent = 'Novo veículo'; $('#erroVeiculo').classList.add('hide'); open('mVeiculo');
}
function editarVeiculo(id) {
  const x = veiculos.find(v => Number(v.id) === id); if (!x) return;
  $('#veiculoId').value = x.id; $('#vNome').value = x.nome || ''; $('#vPlaca').value = x.placa || ''; $('#vCategoria').value = x.categoria || 'B';
  $('#tituloVeiculo').textContent = 'Editar veículo'; $('#erroVeiculo').classList.add('hide'); open('mVeiculo');
}
$('#novoVeiculo').onclick = novoVeiculo;
$('#fVeiculo').onsubmit = async e => {
  e.preventDefault(); $('#erroVeiculo').classList.add('hide');
  const id = Number($('#veiculoId').value || 0);
  const payload = { nome: $('#vNome').value, placa: $('#vPlaca').value, categoria: $('#vCategoria').value };
  try { await api(id ? `/api/veiculos/${id}` : '/api/veiculos', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); close('mVeiculo'); toast(id ? '✅ Veículo atualizado.' : '✅ Veículo cadastrado.'); await load(); abrirTab('configuracoes'); }
  catch (x) { $('#erroVeiculo').textContent = x.message; $('#erroVeiculo').classList.remove('hide'); }
};

function novoLocal() {
  $('#fLocal').reset(); $('#localId').value = ''; $('#tituloLocal').textContent = 'Novo local'; $('#erroLocal').classList.add('hide'); open('mLocal');
}
function editarLocal(id) {
  const x = locais.find(v => Number(v.id) === id); if (!x) return;
  $('#localId').value = x.id; $('#lNome').value = x.nome || ''; $('#lEndereco').value = x.endereco || ''; $('#tituloLocal').textContent = 'Editar local'; $('#erroLocal').classList.add('hide'); open('mLocal');
}
$('#novoLocal').onclick = novoLocal;
$('#fLocal').onsubmit = async e => {
  e.preventDefault(); $('#erroLocal').classList.add('hide');
  const id = Number($('#localId').value || 0);
  const payload = { nome: $('#lNome').value, endereco: $('#lEndereco').value };
  try { await api(id ? `/api/locais/${id}` : '/api/locais', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); close('mLocal'); toast(id ? '✅ Local atualizado.' : '✅ Local cadastrado.'); await load(); abrirTab('configuracoes'); }
  catch (x) { $('#erroLocal').textContent = x.message; $('#erroLocal').classList.remove('hide'); }
};

function pedirExcluirRecurso(tipo, id) {
  const mapa = { instrutor: { lista: instrutores, nome: 'instrutor', rota: 'instrutores' }, veiculo: { lista: veiculos, nome: 'veículo', rota: 'veiculos' }, local: { lista: locais, nome: 'local', rota: 'locais' } };
  const cfg = mapa[tipo]; const x = cfg?.lista.find(v => Number(v.id) === id); if (!cfg || !x) return;
  confirmar(`Excluir ${cfg.nome}?`, `${x.nome} deixará de aparecer nas novas marcações. O histórico antigo será preservado.`, async () => {
    try { await api(`/api/${cfg.rota}/${id}`, { method: 'DELETE' }); toast(`✅ ${cfg.nome.charAt(0).toUpperCase() + cfg.nome.slice(1)} excluído.`); await load(); abrirTab('configuracoes'); }
    catch (e) { toast(e.message); }
  }, 'Excluir');
}

// ========================= PLANO AUTOMÁTICO =========================
function weekdayUTC(data) {
  if (!data) return null;
  const [y,m,d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function marcarDiaInicial() {
  const dia = weekdayUTC($('#pDataInicio').value);
  if (dia === null) return;
  const check = $(`input[name="pDia"][value="${dia}"]`);
  if (check && !$$('input[name="pDia"]:checked').length) check.checked = true;
}

function diasPlanoSelecionados() {
  return $$('input[name="pDia"]:checked').map(c => Number(c.value));
}

function aulasAindaProgramar(a) {
  const contratadas = Number(a.aulas_contratadas || 0);
  const realizadas = realizadasAluno(a);
  const agendadas = Number(a.aulas_agendadas || 0);
  return Math.max(0, contratadas - realizadas - agendadas);
}

function abrirSeletorNovoPlano() {
  preencherSelects();
  if (!alunos.length) {
    toast('Cadastre um aluno antes de criar um plano automático.');
    abrirTab('alunos');
    return;
  }
  $('#escolherAlunoPlano').value = String(alunos[0].id);
  open('mEscolherAlunoPlano');
}

$('#novoPlano').onclick = abrirSeletorNovoPlano;
$('#continuarNovoPlano').onclick = () => {
  const id = Number($('#escolherAlunoPlano').value);
  if (!id) return toast('Escolha um aluno.');
  close('mEscolherAlunoPlano');
  abrirPlano(id);
};

function abrirPlano(id) {
  const a = alunos.find(x => Number(x.id) === id);
  if (!a) return;
  if (!instrutores.length || !veiculos.length || !locais.length) {
    toast('Cadastre pelo menos um instrutor, um veículo e um local antes de criar um plano.');
    abrirTab('configuracoes');
    return;
  }
  $('#fPlano').reset();
  $('#pAlunoId').value = a.id;
  $('#pAlunoNome').textContent = a.nome;
  const ainda = aulasAindaProgramar(a);
  if (ainda <= 0) {
    toast('Este aluno não possui aulas disponíveis para um novo plano. Confira as aulas contratadas, realizadas e já agendadas.');
    return;
  }
  $('#pAlunoResumo').textContent = `${a.aulas_contratadas} contratadas · ${realizadasAluno(a)} realizadas · ${a.aulas_agendadas || 0} já agendadas · ${ainda} ainda a programar`;
  $('#pTotal').max = String(ainda);
  $('#pDataInicio').min = iso();
  $('#pDataInicio').value = iso();
  $('#pHora').value = '08:00';
  $('#pDuracao').value = '50';
  $('#pPorEncontro').value = '1';
  $('#pTotal').value = Math.max(1, ainda || 1);
  $('#previewBox').classList.add('hide');
  $('#confirmarPlano').classList.add('hide');
  $('#erroPlano').classList.add('hide');
  ultimoPreviewPlano = null;
  preencherSelects();
  marcarDiaInicial();
  open('mPlano');
}

function payloadPlano() {
  return {
    aluno_id: Number($('#pAlunoId').value),
    instrutor_id: Number($('#pInstrutor').value),
    veiculo_id: Number($('#pVeiculo').value),
    local_id: Number($('#pLocal').value),
    data_inicio: $('#pDataInicio').value,
    hora_inicio: $('#pHora').value,
    duracao_base_minutos: Number($('#pDuracao').value),
    aulas_por_encontro: Number($('#pPorEncontro').value),
    total_aulas: Number($('#pTotal').value),
    dias_semana: diasPlanoSelecionados(),
    observacoes: $('#pObs').value
  };
}

function renderPreviewPlano(p) {
  const box = $('#previewBox');
  const rows = p.ocorrencias.map((o, i) => {
    const conflito = o.conflito;
    const cls = conflito ? 'preview-row conflict' : 'preview-row ok';
    const extra = conflito
      ? `<span>⚠️ Conflito com ${esc(conflito.aluno_nome)} às ${hora(conflito.hora_inicio)}${o.sugestao_horario ? ` · sugestão: ${o.sugestao_horario}` : ''}</span>`
      : '<span>✅ Livre</span>';
    return `<div class="${cls}"><b>${i + 1}. ${fmtData(o.data_aula)} às ${hora(o.hora_inicio)}</b><small>${o.aulas_unidades} aula(s) · ${o.duracao_minutos} min</small>${extra}</div>`;
  }).join('');

  box.innerHTML = `<div class="preview-summary"><b>${p.total_encontros} encontros</b><span>${p.total_aulas} aulas serão programadas</span><span>${p.conflitos ? `⚠️ ${p.conflitos} conflito(s)` : '✅ Nenhum conflito'}</span></div>${rows}`;
  box.classList.remove('hide');
  $('#confirmarPlano').classList.toggle('hide', !p.ok);
}

$('#pDataInicio').onchange = () => {
  $$('input[name="pDia"]').forEach(c => c.checked = false);
  marcarDiaInicial();
  $('#confirmarPlano').classList.add('hide');
  $('#previewBox').classList.add('hide');
};

$('#previewPlano').onclick = async () => {
  $('#erroPlano').classList.add('hide');
  const payload = payloadPlano();
  if (!payload.dias_semana.length) return mostrarErroPlano('Selecione pelo menos um dia da semana.');
  if (!payload.total_aulas || payload.total_aulas < 1) return mostrarErroPlano('Informe quantas aulas deseja programar.');
  const alunoPlano = alunos.find(a => Number(a.id) === Number(payload.aluno_id));
  const disponiveis = alunoPlano ? aulasAindaProgramar(alunoPlano) : 0;
  if (payload.total_aulas > disponiveis) {
    return mostrarErroPlano(`Você pode programar no máximo ${disponiveis} aula(s) para este aluno.`);
  }

  try {
    $('#previewPlano').disabled = true;
    $('#previewPlano').textContent = 'Verificando...';
    ultimoPreviewPlano = await api('/api/planos/preview', { method: 'POST', body: JSON.stringify(payload) });
    renderPreviewPlano(ultimoPreviewPlano);
  } catch (e) {
    mostrarErroPlano(e.message);
  } finally {
    $('#previewPlano').disabled = false;
    $('#previewPlano').textContent = '👁️ Ver prévia';
  }
};

function mostrarErroPlano(msg) {
  $('#erroPlano').textContent = msg;
  $('#erroPlano').classList.remove('hide');
}

$('#confirmarPlano').onclick = async () => {
  const payload = payloadPlano();
  if (!ultimoPreviewPlano?.ok) return mostrarErroPlano('Gere uma prévia sem conflitos antes de confirmar.');
  try {
    $('#confirmarPlano').disabled = true;
    $('#confirmarPlano').textContent = 'Criando agenda...';
    const r = await api('/api/planos', { method: 'POST', body: JSON.stringify(payload) });
    close('mPlano');
    toast(`✅ Agenda criada: ${r.aulas.length} encontros programados.`);
    await load();
    if (r.aulas[0]?.data_aula) $('#filtroData').value = dataISO(r.aulas[0].data_aula);
    abrirTab('planos');
    render();
  } catch (e) {
    if (e.status === 409) mostrarErroPlano('Existem conflitos. Clique em Ver prévia novamente e ajuste o horário.');
    else mostrarErroPlano(e.message);
  } finally {
    $('#confirmarPlano').disabled = false;
    $('#confirmarPlano').textContent = '✅ Confirmar agenda';
  }
};

$('#fPlano').onsubmit = e => e.preventDefault();

// Qualquer mudança no plano invalida a prévia anterior.
$$('#fPlano input, #fPlano select, #fPlano textarea').forEach(el => {
  if (el.id === 'pAlunoId') return;
  el.addEventListener('input', () => {
    ultimoPreviewPlano = null;
    $('#confirmarPlano').classList.add('hide');
  });
  el.addEventListener('change', () => {
    ultimoPreviewPlano = null;
    $('#confirmarPlano').classList.add('hide');
  });
});

function pedirEncerrarPlano(id, cancelarFuturas = false) {
  const p = planos.find(x => Number(x.id) === id);
  if (!p) return;
  const texto = cancelarFuturas
    ? `O plano automático de ${p.aluno_nome} será encerrado e as aulas futuras ainda agendadas/confirmadas serão canceladas. O histórico passado será preservado.`
    : `O plano automático de ${p.aluno_nome} será encerrado, mas as aulas já geradas continuarão na agenda.`;

  confirmar(
    cancelarFuturas ? 'Encerrar e cancelar futuras?' : 'Encerrar plano?',
    texto,
    async () => {
      try {
        await api(`/api/planos/${id}/encerrar`, {
          method: 'PATCH',
          body: JSON.stringify({ cancelar_futuras: cancelarFuturas })
        });
        toast(cancelarFuturas
          ? '✅ Plano encerrado e aulas futuras canceladas.'
          : '✅ Plano encerrado. As aulas já criadas foram mantidas.');
        await load();
      } catch (e) { toast(e.message); }
    },
    cancelarFuturas ? 'Encerrar e cancelar' : 'Encerrar'
  );
}

// ========================= NAVEGAÇÃO / INICIALIZAÇÃO =========================
$('#filtroData').value = iso();
$('#filtroData').onchange = render;
$('#irAgenda').onclick = () => abrirTab('agenda');

$('#filtroSemana').value = iso();
$('#filtroSemana').onchange = renderSemana;
$('#filtroInstrutorSemana').onchange = renderSemana;
$('#semanaHoje').onclick = () => { $('#filtroSemana').value = iso(); renderSemana(); };
$('#semanaAnterior').onclick = () => { $('#filtroSemana').value = addDaysISO(inicioSemanaISO($('#filtroSemana').value || iso()), -7); renderSemana(); };
$('#semanaProxima').onclick = () => { $('#filtroSemana').value = addDaysISO(inicioSemanaISO($('#filtroSemana').value || iso()), 7); renderSemana(); };

health();
load();
