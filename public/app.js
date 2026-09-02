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
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(u, o = {}) {
  const r = await fetch(u, { headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, ...o });
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
  return Math.max(Number(a.aulas_realizadas || 0), Number(a.realizadas_sistema || 0));
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
    ${p.ativo ? `<div class="actions-row"><button type="button" class="mini delete" data-encerrar-plano="${p.id}">⏹️ Encerrar plano</button></div>` : ''}
  </article>`;
}

function render() {
  $('#sAlunos').textContent = alunos.length;
  const h = iso();
  const ah = aulas.filter(a => dataISO(a.data_aula) === h && a.status !== 'CANCELADA');
  $('#sHoje').textContent = ah.length;
  $('#sAgendadas').textContent = aulas.filter(a => ['AGENDADA','CONFIRMADA'].includes(a.status)).reduce((s, a) => s + Number(a.aulas_unidades || 1), 0);
  $('#sPlanos').textContent = planos.filter(p => p.ativo).length;

  $('#listaAlunos').innerHTML = alunos.length ? alunos.map(studentHtml).join('') : '<div class="empty">Nenhum aluno cadastrado.</div>';
  $('#hoje').innerHTML = ah.length ? ah.map(a => aulaHtml(a, false)).join('') : '<div class="empty">Nenhuma aula hoje.</div>';

  const f = $('#filtroData').value;
  const fa = aulas.filter(a => dataISO(a.data_aula) === f);
  $('#listaAgenda').innerHTML = fa.length ? fa.map(a => aulaHtml(a, true)).join('') : '<div class="empty">Nenhuma aula nesta data.</div>';
  $('#listaPlanos').innerHTML = planos.length ? planos.map(planoHtml).join('') : '<div class="empty">Nenhum plano automático criado ainda.</div>';

  preencherSelects();
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
}

function bindDynamic() {
  $$('[data-edit-aluno]').forEach(b => b.onclick = () => editarAluno(Number(b.dataset.editAluno)));
  $$('[data-del-aluno]').forEach(b => b.onclick = () => pedirExcluirAluno(Number(b.dataset.delAluno)));
  $$('[data-plan-aluno]').forEach(b => b.onclick = () => abrirPlano(Number(b.dataset.planAluno)));
  $$('[data-edit-aula]').forEach(b => b.onclick = () => editarAula(Number(b.dataset.editAula)));
  $$('[data-del-aula]').forEach(b => b.onclick = () => pedirExcluirAula(Number(b.dataset.delAula)));
  $$('[data-repor-aula]').forEach(b => b.onclick = () => reporAula(Number(b.dataset.reporAula)));
  $$('[data-encerrar-plano]').forEach(b => b.onclick = () => pedirEncerrarPlano(Number(b.dataset.encerrarPlano)));
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
    await api('/api/health');
    $('#db').textContent = '🟢 Banco conectado — alunos, aulas e planos automáticos serão salvos.';
    $('#db').className = 'db ok';
  } catch {
    $('#db').textContent = '🔴 Banco não conectado. Configure DATABASE_URL no Render.';
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
  $('#realizadas').value = realizadasAluno(a);
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
      await api('/api/alunos/' + id, { method: 'DELETE' });
      toast('✅ Aluno excluído.');
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
    aulas_realizadas: Number($('#realizadas').value),
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

// ========================= PLANO AUTOMÁTICO =========================
function weekdayUTC(data) {
  if (!data) return null;
  const [y,m,d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function marcarDiaInicial() {
  const dia = weekdayUTC($('#pDataInicio').value);
  if (dia === null || dia === 0) return;
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

function abrirPlano(id) {
  const a = alunos.find(x => Number(x.id) === id);
  if (!a) return;
  $('#fPlano').reset();
  $('#pAlunoId').value = a.id;
  $('#pAlunoNome').textContent = a.nome;
  const ainda = aulasAindaProgramar(a);
  $('#pAlunoResumo').textContent = `${a.aulas_contratadas} contratadas · ${realizadasAluno(a)} realizadas · ${a.aulas_agendadas || 0} já agendadas · ${ainda} ainda a programar`;
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
    abrirTab('agenda');
    if (r.aulas[0]?.data_aula) $('#filtroData').value = dataISO(r.aulas[0].data_aula);
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

function pedirEncerrarPlano(id) {
  const p = planos.find(x => Number(x.id) === id);
  if (!p) return;
  confirmar('Encerrar plano?', `O plano automático de ${p.aluno_nome} será encerrado. As aulas que já foram geradas continuarão na agenda.`, async () => {
    try {
      await api(`/api/planos/${id}/encerrar`, { method: 'PATCH', body: JSON.stringify({ cancelar_futuras: false }) });
      toast('✅ Plano encerrado. As aulas já criadas foram mantidas.');
      await load();
    } catch (e) { toast(e.message); }
  }, 'Encerrar');
}

// ========================= NAVEGAÇÃO / INICIALIZAÇÃO =========================
$('#filtroData').value = iso();
$('#filtroData').onchange = render;
$('#irAgenda').onclick = () => abrirTab('agenda');

health();
load();
