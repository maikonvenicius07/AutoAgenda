const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ========================= V2.3.6 — MODO ESCURO =========================
const AUTOAGENDA_THEME_KEY = 'autoagenda-theme';

function temaAtual() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function atualizarBotaoTema() {
  const botao = $('#alternarTema');
  if (!botao) return;
  const escuro = temaAtual() === 'dark';
  botao.textContent = escuro ? '☀️ Modo claro' : '🌙 Modo escuro';
  botao.setAttribute('aria-pressed', String(escuro));
  botao.title = escuro ? 'Voltar para o modo claro' : 'Ativar o modo escuro';
}

function aplicarTema(tema, salvar = true) {
  const valor = tema === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = valor;
  if (salvar) {
    try { localStorage.setItem(AUTOAGENDA_THEME_KEY, valor); } catch (_) {}
  }
  atualizarBotaoTema();
}

function alternarTema() {
  aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
}

let alunos = [], alunosTodos = [], instrutores = [], veiculos = [], locais = [], aulas = [], aulasHoje = [], aulasSemana = [], planos = [];
let resumoDashboard = {};
let configInstrutores = [], configVeiculos = [], configLocais = [];
let configFuncionamento = {
  dias_funcionamento: [0,1,2,3,4,5,6],
  hora_abertura: '07:00',
  hora_encerramento: '20:00',
  duracao_padrao_minutos: 50,
  intervalo_minutos: 0
};
let mostrarInativosConfig = false;
let mostrarInativosAlunos = false;
let confirmAction = null;
let ultimoPreviewPlano = null;
let aulaEdicaoAtual = null;
let historicoWhatsAppPorAula = new Map();

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

const soDigitos = v => String(v || '').replace(/\D/g, '');
const formatCpf = v => {
  const d = soDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
};
const cpfMascarado = v => {
  const d = soDigitos(v);
  return d.length === 11 ? `***.***.***-${d.slice(-2)}` : 'Não informado';
};

// ========================= V2.3 — WHATSAPP SIMPLES (wa.me) =========================
function numeroWhatsApp(v) {
  let d = soDigitos(v);
  if (!d) return '';

  // Aceita formatos brasileiros comuns: +55 (69)..., 55 69..., (69)... e 069...
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);

  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return '';
}

function localizarAulaParaWhatsApp(id) {
  const n = Number(id);
  if (aulaEdicaoAtual && Number(aulaEdicaoAtual.id) === n) return aulaEdicaoAtual;
  if (historicoWhatsAppPorAula.has(n)) return historicoWhatsAppPorAula.get(n);
  return [...aulas, ...aulasHoje, ...aulasSemana].find(x => Number(x.id) === n) || null;
}

function localizarAlunoDaAula(aula) {
  const alunoId = Number(aula?.aluno_id || 0);
  return alunosTodos.find(x => Number(x.id) === alunoId)
    || alunos.find(x => Number(x.id) === alunoId)
    || null;
}

function podeEnviarWhatsAppAula(aula) {
  return ['AGENDADA', 'CONFIRMADA'].includes(String(aula?.status || '').toUpperCase()) && !aula?.arquivada;
}

function mensagemWhatsAppAula(aula, aluno) {
  const nome = aula?.aluno_nome || aluno?.nome || 'aluno';
  const data = fmtData(aula?.data_aula);
  const horario = hora(aula?.hora_inicio);
  const instrutor = aula?.instrutor_nome || 'a definir';
  const local = aula?.local_nome || 'a definir';
  return `Olá, ${nome}! Seguem os dados da sua aula prática:

📅 Data: ${data}
🕐 Horário: ${horario}
👨‍🏫 Instrutor: ${instrutor}
📍 Local: ${local}

Até lá!`;
}

function linkWhatsAppAula(aula) {
  if (!aula || !podeEnviarWhatsAppAula(aula)) return '';
  const aluno = localizarAlunoDaAula(aula);
  const telefone = numeroWhatsApp(aula.aluno_whatsapp || aluno?.whatsapp || '');
  if (!telefone) return '';
  const texto = mensagemWhatsAppAula(aula, aluno);
  return `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
}

function whatsappHtmlAula(aula, textoBotao = '📲 WhatsApp') {
  if (!podeEnviarWhatsAppAula(aula)) return '';
  const id = Number(aula?.id || 0);
  if (!id) return '';
  // Link para o próprio AutoAgenda. O servidor consulta o telefone no banco e faz
  // um HTTP 302 para wa.me. Assim não dependemos de popup, cache de aluno ou window.open().
  return `<a class="mini secondary" href="/whatsapp/aula/${id}" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800">${textoBotao}</a>`;
}

function abrirWhatsAppAula(id) {
  const aula = localizarAulaParaWhatsApp(id);
  if (!aula) return alert('Não foi possível localizar esta aula para enviar o WhatsApp.');
  if (!podeEnviarWhatsAppAula(aula)) return alert('O WhatsApp de lembrete só está disponível para aulas agendadas ou confirmadas.');
  const n = Number(id || 0);
  if (!n) return alert('Aula inválida.');
  // Navegação direta e mesma origem: máxima compatibilidade com Chrome/Edge/mobile.
  window.location.assign(`/whatsapp/aula/${n}`);
}

const minHora = h => {
  const [hh, mm] = hora(h).split(':').map(Number);
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
};
const horaMin = min => `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`;

function diaSemanaISO(data) {
  const [y,m,d] = dataISO(data).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function diasFuncionamento() {
  return (Array.isArray(configFuncionamento?.dias_funcionamento)
    ? configFuncionamento.dias_funcionamento
    : [0,1,2,3,4,5,6]).map(Number);
}

function proximaDataFuncionamento(dataBase = iso()) {
  let data = dataISO(dataBase) || iso();
  const dias = diasFuncionamento();
  for (let i = 0; i < 14; i++) {
    if (dias.includes(diaSemanaISO(data))) return data;
    data = addDaysISO(data, 1);
  }
  return dataISO(dataBase) || iso();
}

function horarioPermitidoFront(data, horario, duracao = null) {
  const dia = diaSemanaISO(data);
  if (!diasFuncionamento().includes(dia)) return { ok: false, motivo: 'Dia sem funcionamento' };
  const ini = minHora(horario);
  const abre = minHora(configFuncionamento.hora_abertura || '07:00');
  const fecha = minHora(configFuncionamento.hora_encerramento || '20:00');
  const dur = Number(duracao || configFuncionamento.duracao_padrao_minutos || 50);
  if (ini < abre || ini + dur > fecha) return { ok: false, motivo: 'Fora do horário' };
  return { ok: true };
}

function resumoFuncionamento() {
  const dias = diasFuncionamento().map(d => nomesDias[Number(d)]).join(', ');
  const intervalo = Number(configFuncionamento.intervalo_minutos || 0);
  return `${dias} · ${hora(configFuncionamento.hora_abertura)}–${hora(configFuncionamento.hora_encerramento)} · ${Number(configFuncionamento.duracao_padrao_minutos || 50)} min${intervalo ? ` + ${intervalo} min intervalo` : ''}`;
}

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
  if (id === 'semana') carregarAulasSemana();
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
    FALTOU: '🚫 Faltou — aula perdida'
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
  const faltasPerdidas = Math.max(0, Number(a.faltas_unidades || 0));
  const consumidas = realizadas + faltasPerdidas;
  const agendadas = Number(a.aulas_agendadas || 0);
  const aindaProgramar = Math.max(0, contratadas - consumidas - agendadas);
  const restantes = Math.max(0, contratadas - consumidas);
  const pct = contratadas ? Math.min(100, Math.round(consumidas / contratadas * 100)) : 0;
  const ativo = a.ativo !== false;
  const cpfExibicao = a.cpf_mascarado || cpfMascarado(a.cpf);

  return `<article class="student ${ativo ? '' : 'inactive'}">
    <div class="student-top">
      <div>
        <h3>${esc(a.nome)}</h3>
        <p>🪪 CPF ${esc(cpfExibicao || 'Não informado')}</p>
        <p>📲 ${esc(a.whatsapp)}</p>
        <p>📧 ${esc(a.email || 'Sem e-mail')}</p>
        <p>🚘 Categoria ${esc(a.categoria)}</p>
      </div>
      <span class="remaining-badge">${ativo ? `${restantes} restantes` : 'Inativo'}</span>
    </div>

    <div class="student-numbers">
      <div><span>Contratadas</span><b>${contratadas}</b></div>
      <div><span>Realizadas</span><b>${realizadas}</b></div>
      <div><span>Agendadas</span><b>${agendadas}</b></div>
      <div><span>A programar</span><b>${aindaProgramar}</b></div>
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <small class="progress-text">${realizadas} realizada(s)${faltasPerdidas ? ` · ${faltasPerdidas} perdida(s) por falta sem justificativa` : ''} · ${contratadas} contratada(s)</small>

    <div class="actions-row">
      ${ativo ? `
        <button type="button" class="mini history-button" data-history-aluno="${a.id}">📚 Histórico</button>
        <button type="button" class="mini secondary" data-find-slot-aluno="${a.id}">🔎 Horário livre</button>
        <button type="button" class="mini plan" data-plan-aluno="${a.id}">📅 Montar agenda</button>
        <button type="button" class="mini edit" data-edit-aluno="${a.id}">✏️ Editar</button>
        <button type="button" class="mini delete" data-del-aluno="${a.id}">⏸️ Desativar</button>
      ` : `
        <button type="button" class="mini history-button" data-history-aluno="${a.id}">📚 Histórico</button>
        <button type="button" class="mini plan" data-reactivate-aluno="${a.id}">▶️ Reativar aluno</button>
      `}
    </div>
  </article>`;
}

function aulaHtml(x, comAcoes = false) {
  const plano = x.plan_id ? `<span class="plan-badge">🔁 Plano ${x.numero_plano || ''}${x.excecao_plano ? ' • alterada' : ''}</span>` : '';
  const unidades = Number(x.aulas_unidades || 1);
  const unidadeTxt = unidades > 1 ? ` · ${unidades} aulas consecutivas` : '';
  const jaTemReposicao = Number(x.reposicao_id_ativa || 0) > 0;
  const reposicao = comAcoes && x.status === 'CANCELADA'
    ? (jaTemReposicao
      ? `<span class="plan-badge">↪️ Reposição agendada</span>`
      : `<button type="button" class="mini plan" data-repor-aula="${x.id}">↪️ Repor</button>`)
    : '';
  const badgeReposicao = x.reposicao_de_id
    ? `<span class="plan-badge replacement-badge">↪️ Reposição${x.reposicao_data_original ? ` da aula de ${fmtData(x.reposicao_data_original)}` : ''}</span>`
    : '';
  const podeArquivar = comAcoes && !['REALIZADA','FALTOU'].includes(x.status);
  const whatsapp = whatsappHtmlAula(x);

  return `<div class="lesson ${String(x.status || '').toLowerCase()}">
    <div class="lesson-time">${hora(x.hora_inicio)}</div>
    <div class="lesson-main">
      <b>${esc(x.aluno_nome)}</b>
      <small>👨‍🏫 ${esc(x.instrutor_nome)} · 🚗 ${esc(x.veiculo_nome)} ${esc(x.veiculo_placa || '')}</small>
      <small>📍 ${esc(x.local_nome)} · ${statusLabel(x.status)}${unidadeTxt}</small>
      ${plano}
      ${badgeReposicao}
    </div>
    ${comAcoes ? `<div class="actions-row lesson-actions">
      ${reposicao}
      ${whatsapp}
      <button type="button" class="mini edit" data-edit-aula="${x.id}">✏️ Alterar</button>
      ${podeArquivar ? `<button type="button" class="mini delete" data-del-aula="${x.id}">🗃️ Arquivar</button>` : ''}
    </div>` : (whatsapp ? `<div class="actions-row lesson-actions">${whatsapp}</div>` : '')}
  </div>`;
}

const nomesDias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function planoHtml(p) {
  const dias = (Array.isArray(p.dias_semana) ? p.dias_semana : []).map(d => nomesDias[Number(d)]).join(', ');
  const whatsappPlano = `<a class="mini secondary" href="/whatsapp/plano/${Number(p.id)}" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800">📲 Enviar plano completo</a>`;
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
    <div class="actions-row">
      ${whatsappPlano}
      ${p.ativo ? `
        <button type="button" class="mini secondary" data-encerrar-plano="${p.id}">⏹️ Encerrar e manter aulas</button>
        <button type="button" class="mini delete" data-encerrar-cancelar="${p.id}">🗑️ Encerrar e cancelar futuras</button>` : ''}
    </div>
  </article>`;
}

function resumoDisponibilidadeInstrutor(x) {
  if (!x?.disponibilidade_personalizada) return '🕒 Usa o horário geral da autoescola';
  const dias = (Array.isArray(x.dias_trabalho) ? x.dias_trabalho : [])
    .map(d => nomesDias[Number(d)]).join(', ');
  const periodo = `${hora(x.hora_inicio)}–${hora(x.hora_fim)}`;
  const intervalo = x.intervalo_inicio && x.intervalo_fim
    ? ` · intervalo ${hora(x.intervalo_inicio)}–${hora(x.intervalo_fim)}`
    : '';
  return `🗓️ ${dias || 'Sem dias'} · ${periodo}${intervalo}`;
}

function totalHistoricoRecurso(x) {
  return Number(x.planos_total || 0) + Number(x.aulas_total || 0);
}

function configItemHtml(tipo, x) {
  const ativo = x.ativo !== false;
  const usoAtual = `${Number(x.planos_ativos || 0)} plano(s) ativo(s) · ${Number(x.aulas_futuras || 0)} aula(s) futura(s)`;
  const historico = `${Number(x.planos_total || 0)} plano(s) no histórico · ${Number(x.aulas_total || 0)} aula(s) no histórico`;
  const status = `<span class="resource-status ${ativo ? 'active' : 'inactive'}">${ativo ? 'Ativo' : 'Inativo'}</span>`;
  const acaoSituacao = ativo
    ? `<button type="button" class="mini secondary" title="Desativar" data-toggle-recurso="${tipo}" data-toggle-id="${x.id}" data-toggle-ativo="0">⏸️</button>`
    : `<button type="button" class="mini plan" title="Reativar" data-toggle-recurso="${tipo}" data-toggle-id="${x.id}" data-toggle-ativo="1">▶️</button>`;
  const exclusao = !ativo
    ? (totalHistoricoRecurso(x) === 0
        ? `<button type="button" class="mini delete" title="Excluir definitivamente" data-delete-recurso="${tipo}" data-delete-id="${x.id}">🗑️</button>`
        : `<button type="button" class="mini history-lock" disabled title="Possui histórico e não pode ser excluído definitivamente">🔒</button>`)
    : '';

  let detalhes = '';
  let editAttr = '';
  if (tipo === 'instrutor') {
    const folgas = Number(x.indisponibilidades_futuras || 0);
    detalhes = `${esc(x.categorias || 'AB')} · ${esc(x.whatsapp || 'Sem WhatsApp')}<br>${esc(resumoDisponibilidadeInstrutor(x))}${folgas ? `<br>🏖️ ${folgas} indisponibilidade(s) futura(s)` : ''}`;
    editAttr = `data-edit-instrutor="${x.id}"`;
  } else if (tipo === 'veiculo') {
    const situacaoVeiculo = x.ativo === false ? 'INATIVO' : String(x.situacao || 'DISPONIVEL').toUpperCase();
    const nomesSituacao = { DISPONIVEL:'✅ Disponível', MANUTENCAO:'🔧 Manutenção', INDISPONIVEL:'⛔ Indisponível', INATIVO:'⏸️ Inativo' };
    const bloqueios = Number(x.indisponibilidades_futuras || 0);
    detalhes = `${esc(x.placa || 'Sem placa')} · Categoria ${esc(x.categoria || 'B')}<br>${esc(nomesSituacao[situacaoVeiculo] || situacaoVeiculo)}${bloqueios ? `<br>📅 ${bloqueios} período(s) futuro(s) bloqueado(s)` : ''}`;
    editAttr = `data-edit-veiculo="${x.id}"`;
  } else {
    detalhes = esc(x.endereco || 'Sem endereço informado');
    editAttr = `data-edit-local="${x.id}"`;
  }

  return `<div class="config-item ${ativo ? '' : 'inactive'}">
    <div>
      <div class="resource-title"><b>${esc(x.nome)}</b>${status}</div>
      <small>${detalhes}</small>
      <small>${usoAtual}</small>
      <small class="resource-history">${historico}</small>
    </div>
    <div class="config-actions">
      <button type="button" class="mini edit" title="Editar" ${editAttr}>✏️</button>
      ${acaoSituacao}
      ${exclusao}
    </div>
  </div>`;
}

function renderFuncionamento() {
  const cfg = configFuncionamento || {};
  $$('input[name="cfgDia"]').forEach(c => {
    c.checked = diasFuncionamento().includes(Number(c.value));
  });
  if ($('#cfgHoraAbertura')) $('#cfgHoraAbertura').value = hora(cfg.hora_abertura || '07:00');
  if ($('#cfgHoraEncerramento')) $('#cfgHoraEncerramento').value = hora(cfg.hora_encerramento || '20:00');
  if ($('#cfgDuracaoPadrao')) $('#cfgDuracaoPadrao').value = String(Number(cfg.duracao_padrao_minutos || 50));
  if ($('#cfgIntervalo')) $('#cfgIntervalo').value = String(Number(cfg.intervalo_minutos || 0));
  if ($('#cfgFuncionamentoResumo')) $('#cfgFuncionamentoResumo').textContent = `${hora(cfg.hora_abertura)}–${hora(cfg.hora_encerramento)}`;
  if ($('#weekHorarioInfo')) $('#weekHorarioInfo').textContent = `Funcionamento: ${resumoFuncionamento()}. Aulas antigas fora da regra continuam visíveis.`;

  const abertura = hora(cfg.hora_abertura || '07:00');
  const encerramento = hora(cfg.hora_encerramento || '20:00');
  ['#aHora','#pHora'].forEach(sel => {
    const el = $(sel);
    if (el) {
      el.min = abertura;
      el.max = encerramento;
    }
  });

  // No plano automático, dias fechados não podem ser selecionados.
  $$('input[name="pDia"]').forEach(c => {
    const aberto = diasFuncionamento().includes(Number(c.value));
    c.disabled = !aberto;
    if (!aberto) c.checked = false;
    c.closest('label')?.classList.toggle('day-disabled', !aberto);
  });
}

function renderConfiguracoes() {
  renderFuncionamento();
  const inativosInstrutores = configInstrutores.filter(x => x.ativo === false).length;
  const inativosVeiculos = configVeiculos.filter(x => x.ativo === false).length;
  const inativosLocais = configLocais.filter(x => x.ativo === false).length;
  const totalInativos = inativosInstrutores + inativosVeiculos + inativosLocais;

  $('#cfgQtdInstrutores').textContent = instrutores.length;
  $('#cfgQtdVeiculos').textContent = veiculos.length;
  $('#cfgQtdLocais').textContent = locais.length;

  const filtrar = lista => lista.filter(x => mostrarInativosConfig || x.ativo !== false);
  const listaI = filtrar(configInstrutores);
  const listaV = filtrar(configVeiculos);
  const listaL = filtrar(configLocais);

  $('#listaInstrutoresConfig').innerHTML = listaI.length
    ? listaI.map(x => configItemHtml('instrutor', x)).join('')
    : '<div class="empty small-empty">Nenhum instrutor para mostrar.</div>';
  $('#listaVeiculosConfig').innerHTML = listaV.length
    ? listaV.map(x => configItemHtml('veiculo', x)).join('')
    : '<div class="empty small-empty">Nenhum veículo para mostrar.</div>';
  $('#listaLocaisConfig').innerHTML = listaL.length
    ? listaL.map(x => configItemHtml('local', x)).join('')
    : '<div class="empty small-empty">Nenhum local para mostrar.</div>';

  const botao = $('#toggleInativosConfig');
  if (botao) {
    botao.textContent = mostrarInativosConfig ? 'Ocultar inativos' : `Mostrar inativos (${totalInativos})`;
    botao.disabled = !mostrarInativosConfig && totalInativos === 0;
  }

  const info = $('#cfgInativosInfo');
  if (info) {
    info.textContent = `${inativosInstrutores} instrutor(es), ${inativosVeiculos} veículo(s) e ${inativosLocais} local(is) inativo(s).`;
  }
}

function aulaSemanaHtml(a) {
  const cls = String(a.status || '').toLowerCase();
  return `<div class="week-lesson ${cls}" data-week-edit="${a.id}" title="Clique para editar">
    <div class="week-lesson-time">${hora(a.hora_inicio)}</div>
    <b>${esc(a.aluno_nome)}</b>
    <small>👨‍🏫 ${esc(a.instrutor_nome)}</small>
    <small>🚗 ${esc(a.veiculo_nome)}${a.veiculo_placa ? ' · ' + esc(a.veiculo_placa) : ''}</small>
    <small>📍 ${esc(a.local_nome || 'Local não informado')}</small>
    <small>${statusLabel(a.status)}</small>
  </div>`;
}

function slotsAgendaSemanal(lista) {
  const slots = new Set();
  const abre = minHora(configFuncionamento.hora_abertura || '07:00');
  const fecha = minHora(configFuncionamento.hora_encerramento || '20:00');
  const duracao = Math.max(10, Number(configFuncionamento.duracao_padrao_minutos || 50));
  const passo = Math.max(5, duracao + Math.max(0, Number(configFuncionamento.intervalo_minutos || 0)));

  for (let m = abre; m + duracao <= fecha; m += passo) slots.add(horaMin(m));

  // Preserva a visualização de aulas antigas ou excepcionais fora da nova grade.
  lista.forEach(a => {
    const h = hora(a.hora_inicio);
    if (h) slots.add(h);
  });
  return [...slots].sort((a, b) => minHora(a) - minHora(b));
}

async function carregarAulasSemana(silencioso = false) {
  const ref = $('#filtroSemana')?.value || iso();
  const inicio = inicioSemanaISO(ref);
  const fim = addDaysISO(inicio, 6);
  try {
    aulasSemana = await api(`/api/aulas?data_inicio=${encodeURIComponent(inicio)}&data_fim=${encodeURIComponent(fim)}`);
    renderSemana();
  } catch (e) {
    console.error(e);
    if (!silencioso) toast('Não foi possível carregar a agenda semanal.');
    // Mantém uma alternativa visual com os dados já carregados.
    aulasSemana = aulas.filter(a => {
      const d = dataISO(a.data_aula);
      return d >= inicio && d <= fim;
    });
    renderSemana();
  }
}

function renderSemana() {
  const ref = $('#filtroSemana')?.value || iso();
  const inicio = inicioSemanaISO(ref);
  const fim = addDaysISO(inicio, 6);
  if ($('#periodoSemana')) $('#periodoSemana').textContent = `${fmtData(inicio)} a ${fmtData(fim)}`;

  const filtroInstrutor = Number($('#filtroInstrutorSemana')?.value || 0);
  const filtroVeiculo = Number($('#filtroVeiculoSemana')?.value || 0);
  const diasLongos = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
  const hoje = iso();

  const origemSemana = aulasSemana.length
    ? aulasSemana
    : aulas.filter(a => {
        const d = dataISO(a.data_aula);
        return d >= inicio && d <= fim;
      });

  const visiveis = origemSemana.filter(a =>
    (!filtroInstrutor || Number(a.instrutor_id) === filtroInstrutor) &&
    (!filtroVeiculo || Number(a.veiculo_id) === filtroVeiculo)
  );

  const datas = Array.from({ length: 7 }, (_, i) => addDaysISO(inicio, i));
  const slots = slotsAgendaSemanal(visiveis);

  const cabecalho = `
    <div class="week-corner">Horário</div>
    ${datas.map((data, i) => `
      <div class="week-column-head ${data === hoje ? 'today' : ''}">
        <b>${diasLongos[i]}</b>
        <span>${fmtData(data)}</span>
      </div>`).join('')}
  `;

  const linhas = slots.map(slot => {
    const cells = datas.map(data => {
      const doSlot = visiveis.filter(a => dataISO(a.data_aula) === data && hora(a.hora_inicio) === slot);
      const permitido = horarioPermitidoFront(data, slot, Number(configFuncionamento.duracao_padrao_minutos || 50));
      const diaAberto = diasFuncionamento().includes(diaSemanaISO(data));
      const conteudo = doSlot.length
        ? doSlot.map(aulaSemanaHtml).join('')
        : permitido.ok
          ? `<button type="button" class="week-empty-slot" data-new-week-slot="1" data-week-date="${data}" data-week-time="${slot}" title="Criar aula em ${fmtData(data)} às ${slot}">
               <span>＋</span><small>Livre</small>
             </button>`
          : `<div class="week-closed-slot" title="${esc(permitido.motivo)}"><span>—</span><small>${diaAberto ? 'Fora do horário' : 'Fechado'}</small></div>`;
      return `<div class="week-slot ${data === hoje ? 'today' : ''} ${permitido.ok ? '' : 'closed'}" data-slot-date="${data}" data-slot-time="${slot}">${conteudo}</div>`;
    }).join('');
    return `<div class="week-time">${slot}</div>${cells}`;
  }).join('');

  $('#agendaSemanal').innerHTML = cabecalho + linhas;

  $$('[data-new-week-slot]').forEach(b => b.onclick = () => novaAula({
    data: b.dataset.weekDate,
    hora: b.dataset.weekTime,
    instrutor_id: filtroInstrutor || undefined,
    veiculo_id: filtroVeiculo || undefined
  }));
  $$('[data-week-edit]').forEach(b => b.onclick = () => editarAula(Number(b.dataset.weekEdit)));
}

function render() {
  $('#sAlunos').textContent = Number(resumoDashboard.alunos_ativos ?? alunos.length);
  $('#sHoje').textContent = Number(resumoDashboard.aulas_hoje ?? aulasHoje.length);
  $('#sAgendadas').textContent = Number(resumoDashboard.aulas_agendadas ?? 0);
  $('#sPlanos').textContent = Number(resumoDashboard.planos_ativos ?? planos.filter(p => p.ativo).length);

  const h = iso();
  const ah = aulasHoje.filter(a => dataISO(a.data_aula) === h && a.status !== 'CANCELADA');
  const alunosExibidos = mostrarInativosAlunos ? alunosTodos : alunos;
  $('#listaAlunos').innerHTML = alunosExibidos.length ? alunosExibidos.map(studentHtml).join('') : '<div class="empty">Nenhum aluno cadastrado.</div>';
  const toggleAlunos = $('#toggleInativosAlunos');
  if (toggleAlunos) toggleAlunos.textContent = mostrarInativosAlunos ? 'Ocultar inativos' : 'Mostrar inativos';

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

  const filtroVeiculoSemana = $('#filtroVeiculoSemana');
  if (filtroVeiculoSemana) {
    const atual = filtroVeiculoSemana.value;
    filtroVeiculoSemana.innerHTML = '<option value="">Todos os veículos</option>' + optsVeiculo;
    if ([...filtroVeiculoSemana.options].some(o => o.value === atual)) filtroVeiculoSemana.value = atual;
  }
}

function bindDynamic() {
  $$('[data-edit-aluno]').forEach(b => b.onclick = () => editarAluno(Number(b.dataset.editAluno)));
  $$('[data-history-aluno]').forEach(b => b.onclick = () => abrirHistoricoAluno(Number(b.dataset.historyAluno)));
  $$('[data-del-aluno]').forEach(b => b.onclick = () => pedirExcluirAluno(Number(b.dataset.delAluno)));
  $$('[data-reactivate-aluno]').forEach(b => b.onclick = () => reativarAluno(Number(b.dataset.reactivateAluno)));
  $$('[data-plan-aluno]').forEach(b => b.onclick = () => abrirPlano(Number(b.dataset.planAluno)));
  $$('[data-find-slot-aluno]').forEach(b => b.onclick = () => abrirBuscaHorario({ aluno_id:Number(b.dataset.findSlotAluno) }));
  $$('[data-edit-aula]').forEach(b => b.onclick = () => editarAula(Number(b.dataset.editAula)));
  $$('[data-del-aula]').forEach(b => b.onclick = () => pedirExcluirAula(Number(b.dataset.delAula)));
  $$('[data-repor-aula]').forEach(b => b.onclick = () => reporAula(Number(b.dataset.reporAula)));
  $$('[data-encerrar-plano]').forEach(b => b.onclick = () => pedirEncerrarPlano(Number(b.dataset.encerrarPlano), false));
  $$('[data-encerrar-cancelar]').forEach(b => b.onclick = () => pedirEncerrarPlano(Number(b.dataset.encerrarCancelar), true));
  $$('[data-edit-instrutor]').forEach(b => b.onclick = () => editarInstrutor(Number(b.dataset.editInstrutor)));
  $$('[data-edit-veiculo]').forEach(b => b.onclick = () => editarVeiculo(Number(b.dataset.editVeiculo)));
  $$('[data-edit-local]').forEach(b => b.onclick = () => editarLocal(Number(b.dataset.editLocal)));
  $$('[data-toggle-recurso]').forEach(b => b.onclick = () => pedirAlterarAtivoRecurso(
    b.dataset.toggleRecurso,
    Number(b.dataset.toggleId),
    b.dataset.toggleAtivo === '1'
  ));
  $$('[data-delete-recurso]').forEach(b => b.onclick = () => pedirExcluirRecursoPermanente(
    b.dataset.deleteRecurso,
    Number(b.dataset.deleteId)
  ));
}

async function load() {
  try {
    const dataSelecionada = $('#filtroData').value || iso();
    const hoje = iso();
    [alunos, instrutores, veiculos, locais, aulas, aulasHoje, planos, configInstrutores, configVeiculos, configLocais, configFuncionamento, resumoDashboard] = await Promise.all([
      api('/api/alunos'),
      api('/api/instrutores'),
      api('/api/veiculos'),
      api('/api/locais'),
      api(`/api/aulas?data_inicio=${encodeURIComponent(dataSelecionada)}&data_fim=${encodeURIComponent(dataSelecionada)}`),
      api(`/api/aulas?data_inicio=${encodeURIComponent(hoje)}&data_fim=${encodeURIComponent(hoje)}`),
      api('/api/planos'),
      api('/api/instrutores?incluir_inativos=1'),
      api('/api/veiculos?incluir_inativos=1'),
      api('/api/locais?incluir_inativos=1'),
      api('/api/configuracoes/funcionamento'),
      api('/api/dashboard/resumo')
    ]);
    if (mostrarInativosAlunos) alunosTodos = await api('/api/alunos?incluir_inativos=1');
    render();
    await carregarAulasSemana(true);
  } catch (e) {
    console.error(e);
    toast(e.status === 503 ? 'Configure a proteção de acesso no Render.' : 'Erro ao carregar dados');
  }
}

async function health() {
  try {
    const h = await api('/api/health');
    const seguranca = h.security_ready ? ' · 🔒 acesso protegido' : ' · ⛔ proteção precisa ser configurada';
    $('#db').textContent = `🟢 Banco conectado — AutoAgenda V${h.version || '2.3.1'}${seguranca}.`;
    $('#db').className = h.security_ready ? 'db ok' : 'db fail';
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

async function editarAluno(id) {
  try {
    const a = await api('/api/alunos/' + id);
    $('#alunoId').value = a.id;
    $('#nome').value = a.nome || '';
    $('#cpf').value = formatCpf(a.cpf || '');
    $('#whats').value = a.whatsapp || '';
    $('#email').value = a.email || '';
    $('#cat').value = a.categoria || 'B';
    $('#contratadas').value = a.aulas_contratadas || 20;
    $('#realizadas').value = Number(a.aulas_realizadas_anteriores ?? a.aulas_realizadas ?? 0);
    $('#obs').value = a.observacoes || '';
    $('#tituloAluno').textContent = 'Editar aluno';
    $('#salvarAluno').textContent = 'Salvar alterações';
    $('#erroAluno').classList.add('hide');
    open('mAluno');
  } catch (e) { toast(e.message); }
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
  confirmar('Desativar aluno?', `O aluno ${a.nome} ficará inativo. Planos ativos serão encerrados e aulas futuras ainda agendadas serão canceladas. O histórico será preservado.`, async () => {
    try {
      const r = await api('/api/alunos/' + id + '/ativo', { method: 'PATCH', body: JSON.stringify({ ativo:false }) });
      const extras = Number(r.aulas_futuras_canceladas || 0) ? ` · ${r.aulas_futuras_canceladas} aula(s) futura(s) cancelada(s)` : '';
      toast(`✅ Aluno desativado${extras}.`);
      await load();
    } catch (e) { toast(e.message); }
  }, 'Desativar');
}

async function reativarAluno(id) {
  try {
    await api('/api/alunos/' + id + '/ativo', { method:'PATCH', body:JSON.stringify({ ativo:true }) });
    toast('✅ Aluno reativado.');
    await load();
  } catch (e) { toast(e.message); }
}

async function alternarInativosAlunos() {
  mostrarInativosAlunos = !mostrarInativosAlunos;
  try {
    if (mostrarInativosAlunos) alunosTodos = await api('/api/alunos?incluir_inativos=1');
    render();
  } catch (e) {
    mostrarInativosAlunos = false;
    toast(e.message);
  }
}

$('#novoAluno').onclick = novoAluno;
$('#toggleInativosAlunos').onclick = alternarInativosAlunos;
$('#cpf').addEventListener('input', e => {
  e.target.value = formatCpf(e.target.value);
});
$('#fAluno').onsubmit = async e => {
  e.preventDefault();
  $('#erroAluno').classList.add('hide');
  const id = Number($('#alunoId').value || 0);
  const payload = {
    nome: $('#nome').value,
    cpf: soDigitos($('#cpf').value),
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



// ========================= V2.2 — HISTÓRICO COMPLETO DO ALUNO =========================
function historicoMetricHtml(rotulo, valor, detalhe = '') {
  return `<div class="history-metric"><span>${esc(rotulo)}</span><b>${esc(valor)}</b>${detalhe ? `<small>${esc(detalhe)}</small>` : ''}</div>`;
}

function historicoPlanoHtml(p) {
  const dias = (Array.isArray(p.dias_semana) ? p.dias_semana : [])
    .map(d => nomesDias[Number(d)] || d).join(', ');
  return `<div class="history-plan ${p.ativo ? '' : 'inactive'}">
    <div>
      <b>🔁 Plano #${p.id}</b>
      <small>${esc(dias || 'Dia fixo')} às ${esc(hora(p.hora_inicio))} · início ${esc(fmtData(p.data_inicio))}</small>
      <small>👨‍🏫 ${esc(p.instrutor_nome)} · 🚗 ${esc(p.veiculo_nome)} ${esc(p.veiculo_placa || '')} · 📍 ${esc(p.local_nome)}</small>
      ${p.observacoes ? `<small>📝 ${esc(p.observacoes)}</small>` : ''}
    </div>
    <div class="history-plan-side">
      <span class="resource-status ${p.ativo ? 'active' : 'inactive'}">${p.ativo ? 'Ativo' : 'Encerrado'}</span>
      <small>${Number(p.aulas_geradas || 0)} aula(s) gerada(s)</small>
    </div>
  </div>`;
}

function historicoAulaHtml(a) {
  const unidades = Number(a.aulas_unidades || 1);
  const origem = a.reposicao_de_id
    ? `<span class="plan-badge replacement-badge">↪️ Reposição da aula de ${esc(fmtData(a.reposicao_data_original))}${a.reposicao_hora_original ? ` às ${esc(hora(a.reposicao_hora_original))}` : ''}</span>`
    : '';
  const gerou = Number(a.reposicoes_geradas || 0) > 0
    ? `<span class="plan-badge">↪️ ${Number(a.reposicoes_geradas)} reposição(ões) vinculada(s)</span>`
    : '';
  const plano = a.plan_id ? `<span class="plan-badge">🔁 Plano ${a.numero_plano || ''}${a.excecao_plano ? ' · alterada' : ''}</span>` : '';
  const arquivada = a.arquivada ? `<span class="history-archived">🗃️ Arquivada</span>` : '';
  return `<div class="history-event ${String(a.status || '').toLowerCase()} ${a.arquivada ? 'archived' : ''}">
    <div class="history-date">
      <b>${esc(fmtData(a.data_aula))}</b>
      <strong>${esc(hora(a.hora_inicio))}</strong>
    </div>
    <div class="history-event-main">
      <div class="history-event-title">
        <b>${esc(statusLabel(a.status))}</b>
        <span>${unidades} aula${unidades === 1 ? '' : 's'} · ${Number(a.duracao_minutos || 0)} min</span>
      </div>
      <small>👨‍🏫 ${esc(a.instrutor_nome)} · 🚗 ${esc(a.veiculo_nome)} ${esc(a.veiculo_placa || '')}</small>
      <small>📍 ${esc(a.local_nome)}</small>
      <div class="history-badges">${plano}${origem}${gerou}${arquivada}</div>
      ${a.observacoes ? `<div class="history-note">📝 ${esc(a.observacoes).replace(/\n/g, '<br>')}</div>` : ''}
      ${podeEnviarWhatsAppAula(a) ? `<div class="actions-row">${whatsappHtmlAula(a, '📲 Enviar WhatsApp')}</div>` : ''}
    </div>
  </div>`;
}

async function abrirHistoricoAluno(id) {
  $('#historicoTitulo').textContent = '📚 Histórico do aluno';
  $('#historicoSubtitulo').textContent = 'Carregando informações...';
  $('#historicoSituacao').textContent = '—';
  $('#historicoResumo').innerHTML = '<div class="empty small-empty">Carregando resumo...</div>';
  $('#historicoPlanos').innerHTML = '<div class="empty small-empty">Carregando planos...</div>';
  $('#historicoAulas').innerHTML = '<div class="empty small-empty">Carregando aulas...</div>';
  $('#historicoPlanosQtd').textContent = '0';
  $('#historicoAulasQtd').textContent = '0';
  $('#erroHistoricoAluno').classList.add('hide');
  open('mHistoricoAluno');

  try {
    const h = await api(`/api/alunos/${id}/historico`);
    const a = h.aluno || {};
    const r = h.resumo || {};
    const planosHistorico = Array.isArray(h.planos) ? h.planos : [];
    const aulasHistorico = Array.isArray(h.aulas) ? h.aulas : [];
    historicoWhatsAppPorAula = new Map(aulasHistorico.map(x => [Number(x.id), {
      ...x,
      aluno_id: Number(a.id),
      aluno_nome: a.nome,
      aluno_whatsapp: a.whatsapp
    }]));

    $('#historicoTitulo').textContent = `📚 Histórico — ${a.nome || 'Aluno'}`;
    $('#historicoSubtitulo').textContent = `Categoria ${a.categoria || '—'} · CPF ${a.cpf_mascarado || 'não informado'} · ${a.whatsapp || 'sem WhatsApp'}`;
    $('#historicoSituacao').textContent = a.ativo ? 'Ativo' : 'Inativo';
    $('#historicoSituacao').className = `remaining-badge ${a.ativo ? '' : 'history-inactive-badge'}`;

    $('#historicoResumo').innerHTML = [
      historicoMetricHtml('Contratadas', Number(r.contratadas || 0)),
      historicoMetricHtml('Realizadas', Number(r.realizadas || 0), Number(r.realizadas_anteriores || 0) ? `${Number(r.realizadas_anteriores)} anteriores ao AutoAgenda` : ''),
      historicoMetricHtml('Aulas futuras', Number(r.futuras || 0)),
      historicoMetricHtml('Saldo restante', Number(r.restantes || 0), 'desconta realizadas e faltas sem justificativa'),
      historicoMetricHtml('A programar', Number(r.a_programar || 0), 'descontando também as aulas futuras'),
      historicoMetricHtml('Faltas / aulas perdidas', Number(r.faltas_unidades ?? r.faltas ?? 0), `${Number(r.faltas || 0)} ocorrência(s) registrada(s)`),
      historicoMetricHtml('Cancelamentos', Number(r.cancelamentos || 0)),
      historicoMetricHtml('Reposições', Number(r.reposicoes || 0)),
      historicoMetricHtml('Planos', Number(r.planos_total || 0), `${Number(r.planos_ativos || 0)} ativo(s)`),
      historicoMetricHtml('Primeira aula', r.primeira_aula ? fmtData(r.primeira_aula) : '—'),
      historicoMetricHtml('Última no histórico', r.ultima_aula ? fmtData(r.ultima_aula) : '—'),
      historicoMetricHtml('Última realizada', r.ultima_realizada ? fmtData(r.ultima_realizada) : '—')
    ].join('');

    $('#historicoPlanosQtd').textContent = String(planosHistorico.length);
    $('#historicoPlanos').innerHTML = planosHistorico.length
      ? planosHistorico.map(historicoPlanoHtml).join('')
      : '<div class="empty small-empty">Nenhum plano registrado para este aluno.</div>';

    $('#historicoAulasQtd').textContent = String(aulasHistorico.length);
    $('#historicoAulas').innerHTML = aulasHistorico.length
      ? aulasHistorico.map(historicoAulaHtml).join('')
      : '<div class="empty small-empty">Nenhuma aula registrada para este aluno.</div>';
  } catch (e) {
    $('#erroHistoricoAluno').textContent = e.message || 'Erro ao carregar histórico.';
    $('#erroHistoricoAluno').classList.remove('hide');
    $('#historicoResumo').innerHTML = '';
    $('#historicoPlanos').innerHTML = '';
    $('#historicoAulas').innerHTML = '';
  }
}

// ========================= V2.1 — ENCONTRAR HORÁRIO LIVRE / REAGENDAMENTO =========================
function preencherBuscaHorario() {
  $('#hAluno').innerHTML = alunos.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('#hInstrutor').innerHTML = instrutores.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('#hVeiculo').innerHTML = veiculos.map(x => `<option value="${x.id}">${esc(x.nome)}${x.placa ? ' · ' + esc(x.placa) : ''}</option>`).join('');
  $('#hLocal').innerHTML = locais.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
}

function abrirBuscaHorario(prefill = {}) {
  if (!alunos.length) return toast('Cadastre um aluno primeiro.');
  if (!instrutores.length || !veiculos.length || !locais.length) {
    toast('Cadastre pelo menos um instrutor, um veículo e um local em Configurações.');
    abrirTab('configuracoes');
    return;
  }
  const modoReposicao = Number(prefill.origem_aula_id || 0) > 0;
  $('#hOrigemAulaId').value = modoReposicao ? String(prefill.origem_aula_id) : '';
  $('#tituloHorarioLivre').textContent = modoReposicao ? '↪️ Reagendamento inteligente' : '🔎 Encontrar horário livre';
  $('#textoHorarioLivre').textContent = modoReposicao
    ? 'O AutoAgenda vai sugerir até 5 horários para repor a aula, preservando a aula original no histórico.'
    : 'O AutoAgenda procura os próximos horários compatíveis com aluno, instrutor, veículo, funcionamento, folgas, manutenção e aulas já existentes.';
  $('#buscarHorariosLivres').textContent = modoReposicao ? '🔎 Procurar horários para reposição' : '🔎 Procurar os 5 próximos horários';
  preencherBuscaHorario();
  $('#hDataInicio').value = prefill.data || proximaDataFuncionamento(iso());
  $('#hDuracao').value = String(prefill.duracao || Number(configFuncionamento.duracao_padrao_minutos || 50));
  $('#hUnidades').value = String(prefill.unidades || 1);
  if (prefill.aluno_id) $('#hAluno').value = String(prefill.aluno_id);
  if (prefill.instrutor_id) $('#hInstrutor').value = String(prefill.instrutor_id);
  if (prefill.veiculo_id) $('#hVeiculo').value = String(prefill.veiculo_id);
  if (prefill.local_id) $('#hLocal').value = String(prefill.local_id);
  $('#erroHorarioLivre').classList.add('hide');
  $('#resultadoHorariosLivres').innerHTML = '<div class="empty small-empty">Escolha os dados e clique em procurar.</div>';
  open('mHorarioLivre');
}

async function procurarHorariosLivres() {
  const params = new URLSearchParams({
    aluno_id: $('#hAluno').value,
    instrutor_id: $('#hInstrutor').value,
    veiculo_id: $('#hVeiculo').value,
    local_id: $('#hLocal').value,
    data_inicio: $('#hDataInicio').value,
    duracao_minutos: $('#hDuracao').value,
    aulas_unidades: $('#hUnidades').value,
    limite: '5',
    dias_busca: '30'
  });
  $('#erroHorarioLivre').classList.add('hide');
  $('#resultadoHorariosLivres').innerHTML = '<div class="empty small-empty">🔎 Procurando horários...</div>';
  $('#buscarHorariosLivres').disabled = true;
  try {
    const r = await api('/api/horarios-livres?' + params.toString());
    if (!r.resultados?.length) {
      $('#resultadoHorariosLivres').innerHTML = `<div class="empty"><b>Nenhum horário livre encontrado nos próximos ${Number(r.dias_busca || 30)} dias.</b><br><small>Tente outro instrutor, veículo ou data inicial.</small></div>`;
      return;
    }
    $('#resultadoHorariosLivres').innerHTML = `
      <div class="free-slot-summary">✅ ${r.encontrados} horário(s) encontrado(s) · saldo do aluno: <b>${Number(r.saldo?.disponiveis || 0)}</b> aula(s)</div>
      ${r.resultados.map((x, idx) => `<button type="button" class="free-slot-option" data-free-slot-index="${idx}">
        <span><b>${fmtData(x.data_aula)}</b><small>${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][diaSemanaISO(x.data_aula)]}</small></span>
        <strong>${hora(x.hora_inicio)}</strong>
        <em>Agendar →</em>
      </button>`).join('')}`;
    $$('[data-free-slot-index]').forEach(b => b.onclick = () => {
      const x = r.resultados[Number(b.dataset.freeSlotIndex)];
      const origemAulaId = Number($('#hOrigemAulaId').value || 0);
      const prefill = {
        aluno_id: Number($('#hAluno').value),
        instrutor_id: Number($('#hInstrutor').value),
        veiculo_id: Number($('#hVeiculo').value),
        local_id: Number($('#hLocal').value),
        data: x.data_aula,
        hora: x.hora_inicio,
        duracao: Number(x.duracao_minutos),
        unidades: Number(x.aulas_unidades),
        reposicao: origemAulaId > 0,
        reposicao_de_id: origemAulaId || null
      };
      close('mHorarioLivre');
      novaAula(prefill);
    });
  } catch (e) {
    $('#erroHorarioLivre').textContent = e.message;
    $('#erroHorarioLivre').classList.remove('hide');
    $('#resultadoHorariosLivres').innerHTML = '';
  } finally {
    $('#buscarHorariosLivres').disabled = false;
  }
}

$('#encontrarHorarioHeader').onclick = () => abrirBuscaHorario();
$('#encontrarHorarioAgenda').onclick = () => abrirBuscaHorario({ data: $('#filtroData').value || iso() });
$('#buscarHorariosLivres').onclick = procurarHorariosLivres;

// ========================= AULA MANUAL / EDIÇÃO =========================
function novaAula(prefill = null) {
  if (!alunos.length) return toast('Cadastre um aluno primeiro.');
  if (!instrutores.length || !veiculos.length || !locais.length) {
    toast('Cadastre pelo menos um instrutor, um veículo e um local em Configurações.');
    abrirTab('configuracoes');
    return;
  }
  $('#fAula').reset();
  aulaEdicaoAtual = null;
  $('#whatsappAula').classList.add('hide');
  $('#aulaId').value = '';
  $('#aulaPlanId').value = '';
  $('#aulaReposicaoDeId').value = prefill?.reposicao_de_id || '';
  $('#aulaStatusOriginal').value = '';
  $('#aAluno').disabled = false;
  const dataBase = prefill?.data || $('#filtroData').value || iso();
  $('#aData').value = prefill?.data ? dataBase : proximaDataFuncionamento(dataBase);
  $('#aHora').value = prefill?.hora || hora(configFuncionamento.hora_abertura || '07:00');
  $('#aDur').value = String(prefill?.duracao || Number(configFuncionamento.duracao_padrao_minutos || 50));
  $('#aUnidades').value = String(prefill?.unidades || 1);
  $('#aStatus').value = 'AGENDADA';
  $('#tituloAula').textContent = prefill?.reposicao ? '↪️ Agendar reposição' : 'Nova aula';
  $('#salvarAula').textContent = prefill?.reposicao ? 'Agendar reposição' : 'Agendar aula';
  $('#reposicaoBox').classList.toggle('hide', !prefill?.reposicao);
  $('#reposicaoOrigemTexto').textContent = prefill?.reposicao
    ? 'A nova aula ficará vinculada à aula original. A aula cancelada/faltada continuará preservada no histórico.'
    : '';
  $('#erroAula').classList.add('hide');
  $('#serieBox').classList.add('hide');
  $('#aplicarProximas').checked = false;
  preencherSelects();
  if (prefill?.aluno_id) $('#aAluno').value = prefill.aluno_id;
  if (prefill?.instrutor_id) $('#aInstrutor').value = prefill.instrutor_id;
  if (prefill?.veiculo_id) $('#aVeiculo').value = prefill.veiculo_id;
  if (prefill?.local_id) $('#aLocal').value = prefill.local_id;
  if (prefill?.reposicao_de_id) $('#aAluno').disabled = true;
  $('#aObs').value = prefill?.observacoes || '';
  open('mAula');
}

async function editarAula(id) {
  try {
    const a = await api('/api/aulas/' + id);
    if (a.arquivada) return toast('Esta aula está arquivada.');
    aulaEdicaoAtual = a;
    $('#whatsappAula').classList.toggle('hide', !podeEnviarWhatsAppAula(a));
    preencherSelects();
    $('#aulaId').value = a.id;
    $('#aulaPlanId').value = a.plan_id || '';
    $('#aulaReposicaoDeId').value = a.reposicao_de_id || '';
    $('#aulaStatusOriginal').value = a.status || '';
    $('#aAluno').disabled = false;
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
    $('#tituloAula').textContent = a.reposicao_de_id ? 'Alterar reposição' : 'Alterar aula';
    $('#salvarAula').textContent = 'Salvar alterações';
    $('#reposicaoBox').classList.toggle('hide', !a.reposicao_de_id);
    $('#reposicaoOrigemTexto').textContent = a.reposicao_de_id
      ? `Esta aula é uma reposição${a.reposicao_data_original ? ` da aula de ${fmtData(a.reposicao_data_original)}` : ''}. O vínculo histórico será preservado.`
      : '';
    $('#erroAula').classList.add('hide');
    $('#aplicarProximas').checked = false;
    $('#serieBox').classList.toggle('hide', !a.plan_id);
    open('mAula');
  } catch (e) { toast(e.message); }
}

function pedirExcluirAula(id) {
  const a = aulas.find(x => Number(x.id) === id);
  if (!a) return;
  confirmar('Arquivar aula?', `A aula de ${a.aluno_nome} em ${fmtData(a.data_aula)} às ${hora(a.hora_inicio)} será cancelada e retirada da agenda, mas continuará preservada no PostgreSQL para o histórico.`, async () => {
    try {
      await api('/api/aulas/' + id, { method:'DELETE' });
      toast('✅ Aula arquivada. O histórico foi preservado.');
      await load();
    } catch (e) { toast(e.message); }
  }, 'Arquivar');
}

async function reporAula(id) {
  try {
    let a = aulas.find(x => Number(x.id) === Number(id));
    if (!a) a = await api('/api/aulas/' + id);
    if (!['CANCELADA','FALTOU'].includes(String(a.status || '').toUpperCase())) {
      return toast('A reposição só pode ser criada para uma aula cancelada ou com falta.');
    }
    if (Number(a.reposicao_id_ativa || 0) > 0) {
      return toast('Esta aula já possui uma reposição ativa.');
    }
    abrirBuscaHorario({
      origem_aula_id: Number(a.id),
      aluno_id: Number(a.aluno_id),
      instrutor_id: Number(a.instrutor_id),
      veiculo_id: Number(a.veiculo_id),
      local_id: Number(a.local_id),
      data: iso(),
      duracao: Number(a.duracao_minutos || configFuncionamento.duracao_padrao_minutos || 50),
      unidades: Number(a.aulas_unidades || 1)
    });
  } catch (e) { toast(e.message); }
}

$('#novaAula').onclick = () => novaAula();
$('#novaAulaAgenda').onclick = () => novaAula();
$('#whatsappAula').onclick = () => {
  const id = Number($('#aulaId').value || 0);
  if (id) abrirWhatsAppAula(id);
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-whatsapp-aula]');
  if (!b) return;
  abrirWhatsAppAula(Number(b.dataset.whatsappAula));
});

$('#fAula').onsubmit = async e => {
  e.preventDefault();
  $('#erroAula').classList.add('hide');
  const id = Number($('#aulaId').value || 0);
  const planId = Number($('#aulaPlanId').value || 0);
  const reposicaoDeId = Number($('#aulaReposicaoDeId').value || 0);
  const statusOriginal = $('#aulaStatusOriginal').value || '';
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
    let resposta = null;
    if (id && planId && $('#aplicarProximas').checked) {
      resposta = await api(`/api/aulas/${id}/serie`, { method: 'PUT', body: JSON.stringify(payload) });
      toast(`✅ Esta aula e mais ${Math.max(0, Number(resposta.alteradas || 1) - 1)} próximas foram alteradas.`);
    } else if (!id && reposicaoDeId) {
      resposta = await api(`/api/aulas/${reposicaoDeId}/reposicao`, { method:'POST', body:JSON.stringify(payload) });
      toast('✅ Reposição agendada e vinculada ao histórico.');
    } else {
      resposta = await api(id ? '/api/aulas/' + id : '/api/aulas', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      toast(id ? '✅ Aula alterada.' : '✅ Aula salva no banco.');
    }
    const dataEscolhida = $('#aData').value;
    const oferecerReposicao = id > 0
      && String(statusOriginal).toUpperCase() !== 'CANCELADA'
      && String(payload.status).toUpperCase() === 'CANCELADA';
    close('mAula');
    $('#aAluno').disabled = false;
    $('#filtroData').value = dataEscolhida;
    await load();
    if (oferecerReposicao) {
      confirmar(
        '↪️ Encontrar reposição?',
        'A aula original foi preservada no histórico. Deseja que o AutoAgenda procure agora os próximos horários disponíveis para a reposição?',
        () => reporAula(id),
        'Procurar horários'
      );
    }
  } catch (x) {
    let msg = x.message;
    if (x.status === 409) msg = x.data?.error || '⚠️ Conflito de horário. Escolha outro horário.';
    $('#erroAula').textContent = msg;
    $('#erroAula').classList.remove('hide');
  }
};

// ========================= CONFIGURAÇÕES =========================
function aplicarModoDisponibilidadeInstrutor() {
  const usarGeral = $('#iUsarHorarioGeral').checked;
  $('#iDisponibilidadeBox').classList.toggle('hide', usarGeral);
  if (!usarGeral) {
    const marcados = $$('input[name="iDia"]:checked');
    if (!marcados.length) {
      $$('input[name="iDia"]').forEach(c => c.checked = diasFuncionamento().includes(Number(c.value)));
    }
    if (!$('#iHoraInicio').value) $('#iHoraInicio').value = hora(configFuncionamento.hora_abertura || '07:00');
    if (!$('#iHoraFim').value) $('#iHoraFim').value = hora(configFuncionamento.hora_encerramento || '20:00');
  }
}

function preencherDisponibilidadeInstrutor(x = null) {
  const personalizada = x?.disponibilidade_personalizada === true;
  $('#iUsarHorarioGeral').checked = !personalizada;
  const dias = personalizada && Array.isArray(x?.dias_trabalho)
    ? x.dias_trabalho.map(Number)
    : diasFuncionamento();
  $$('input[name="iDia"]').forEach(c => {
    const aberto = diasFuncionamento().includes(Number(c.value));
    c.disabled = !aberto;
    c.checked = dias.includes(Number(c.value)) && aberto;
    c.closest('label')?.classList.toggle('day-disabled', !aberto);
  });
  $('#iHoraInicio').value = hora(x?.hora_inicio || configFuncionamento.hora_abertura || '07:00');
  $('#iHoraFim').value = hora(x?.hora_fim || configFuncionamento.hora_encerramento || '20:00');
  $('#iIntervaloInicio').value = hora(x?.intervalo_inicio || '');
  $('#iIntervaloFim').value = hora(x?.intervalo_fim || '');
  aplicarModoDisponibilidadeInstrutor();
}

async function carregarFolgasInstrutor(id) {
  const box = $('#iListaFolgas');
  if (!id) {
    $('#iFolgasArea').classList.add('hide');
    box.innerHTML = '';
    return;
  }
  $('#iFolgasArea').classList.remove('hide');
  box.innerHTML = '<div class="empty small-empty">Carregando...</div>';
  try {
    const lista = await api(`/api/instrutores/${id}/indisponibilidades`);
    box.innerHTML = lista.length ? lista.map(f => {
      const ini = dataISO(f.data_inicio);
      const fim = dataISO(f.data_fim);
      const periodo = ini === fim ? fmtData(ini) : `${fmtData(ini)} a ${fmtData(fim)}`;
      return `<div class="availability-item">
        <div><b>${periodo}</b><small>${esc(f.motivo || 'Indisponível')}</small></div>
        <button type="button" class="mini delete" data-del-folga="${f.id}" title="Excluir indisponibilidade">🗑️</button>
      </div>`;
    }).join('') : '<div class="empty small-empty">Nenhuma folga ou indisponibilidade futura cadastrada.</div>';
    $$('[data-del-folga]').forEach(b => b.onclick = async () => {
      try {
        await api(`/api/instrutores/${id}/indisponibilidades/${Number(b.dataset.delFolga)}`, { method:'DELETE' });
        toast('✅ Indisponibilidade removida.');
        await carregarFolgasInstrutor(id);
        await load();
      } catch (e) { toast(e.message); }
    });
  } catch (e) {
    box.innerHTML = `<div class="erro">${esc(e.message)}</div>`;
  }
}

function novoInstrutor() {
  $('#fInstrutor').reset();
  $('#instrutorId').value = '';
  $('#iCategorias').value = 'AB';
  $('#tituloInstrutor').textContent = 'Novo instrutor';
  $('#erroInstrutor').classList.add('hide');
  $('#iFolgasArea').classList.add('hide');
  $('#iListaFolgas').innerHTML = '';
  preencherDisponibilidadeInstrutor(null);
  open('mInstrutor');
}

async function editarInstrutor(id) {
  const x = configInstrutores.find(v => Number(v.id) === id); if (!x) return;
  $('#instrutorId').value = x.id;
  $('#iNome').value = x.nome || '';
  $('#iWhats').value = x.whatsapp || '';
  $('#iEmail').value = x.email || '';
  $('#iCategorias').value = x.categorias || 'AB';
  preencherDisponibilidadeInstrutor(x);
  $('#tituloInstrutor').textContent = x.ativo === false ? 'Editar instrutor inativo' : 'Editar instrutor';
  $('#erroInstrutor').classList.add('hide');
  open('mInstrutor');
  await carregarFolgasInstrutor(id);
}

$('#iUsarHorarioGeral').onchange = aplicarModoDisponibilidadeInstrutor;
$('#novoInstrutor').onclick = novoInstrutor;

$('#iAdicionarFolga').onclick = async () => {
  const id = Number($('#instrutorId').value || 0);
  if (!id) return toast('Salve o instrutor antes de cadastrar folgas.');
  const inicio = $('#iFolgaInicio').value;
  const fim = $('#iFolgaFim').value || inicio;
  if (!inicio) return toast('Informe a data da indisponibilidade.');
  try {
    const r = await api(`/api/instrutores/${id}/indisponibilidades`, {
      method:'POST',
      body:JSON.stringify({
        data_inicio: inicio,
        data_fim: fim,
        motivo: $('#iFolgaMotivo').value
      })
    });
    $('#iFolgaInicio').value = '';
    $('#iFolgaFim').value = '';
    $('#iFolgaMotivo').value = '';
    const afetadas = Number(r.aulas_futuras_no_periodo || 0);
    toast(afetadas
      ? `✅ Indisponibilidade cadastrada. ⚠️ ${afetadas} aula(s) futura(s) já existente(s) foram preservadas e precisam ser revisadas.`
      : '✅ Indisponibilidade cadastrada.');
    await carregarFolgasInstrutor(id);
    await load();
  } catch (e) { toast(e.message); }
};

$('#fInstrutor').onsubmit = async e => {
  e.preventDefault();
  $('#erroInstrutor').classList.add('hide');
  const id = Number($('#instrutorId').value || 0);
  const personalizada = !$('#iUsarHorarioGeral').checked;
  const payload = {
    nome: $('#iNome').value,
    whatsapp: $('#iWhats').value,
    email: $('#iEmail').value,
    categorias: $('#iCategorias').value,
    disponibilidade_personalizada: personalizada,
    dias_trabalho: personalizada ? $$('input[name="iDia"]:checked').map(c => Number(c.value)) : [],
    hora_inicio: personalizada ? $('#iHoraInicio').value : null,
    hora_fim: personalizada ? $('#iHoraFim').value : null,
    intervalo_inicio: personalizada ? $('#iIntervaloInicio').value : null,
    intervalo_fim: personalizada ? $('#iIntervaloFim').value : null
  };
  try {
    const r = await api(id ? `/api/instrutores/${id}` : '/api/instrutores', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    close('mInstrutor');
    const fora = Number(r.aulas_futuras_fora_disponibilidade || 0);
    toast(fora
      ? `✅ Instrutor atualizado. ⚠️ ${fora} aula(s) futura(s) antiga(s) ficaram fora da nova disponibilidade e foram preservadas.`
      : (id ? '✅ Instrutor atualizado.' : '✅ Instrutor cadastrado.'));
    await load();
    abrirTab('configuracoes');
  } catch (x) {
    $('#erroInstrutor').textContent = x.message;
    $('#erroInstrutor').classList.remove('hide');
  }
};

function novoVeiculo() {
  $('#fVeiculo').reset();
  $('#veiculoId').value = '';
  $('#vCategoria').value = 'B';
  $('#vSituacao').value = 'DISPONIVEL';
  $('#tituloVeiculo').textContent = 'Novo veículo';
  $('#erroVeiculo').classList.add('hide');
  $('#vIndisponibilidadesArea').classList.add('hide');
  $('#vListaIndisp').innerHTML = '';
  open('mVeiculo');
}

async function carregarIndisponibilidadesVeiculo(id) {
  const box = $('#vListaIndisp');
  if (!id) {
    $('#vIndisponibilidadesArea').classList.add('hide');
    box.innerHTML = '';
    return;
  }
  $('#vIndisponibilidadesArea').classList.remove('hide');
  box.innerHTML = '<div class="empty small-empty">Carregando...</div>';
  try {
    const lista = await api(`/api/veiculos/${id}/indisponibilidades`);
    box.innerHTML = lista.length ? lista.map(f => {
      const ini = dataISO(f.data_inicio);
      const fim = dataISO(f.data_fim);
      const periodo = ini === fim ? fmtData(ini) : `${fmtData(ini)} a ${fmtData(fim)}`;
      const tipo = String(f.tipo || '').toUpperCase() === 'MANUTENCAO' ? '🔧 Manutenção' : '⛔ Indisponível';
      return `<div class="availability-item">
        <div><b>${periodo}</b><small>${tipo}${f.motivo ? ' · ' + esc(f.motivo) : ''}</small></div>
        <button type="button" class="mini delete" data-del-vindisp="${f.id}" title="Excluir período">🗑️</button>
      </div>`;
    }).join('') : '<div class="empty small-empty">Nenhuma manutenção ou indisponibilidade futura cadastrada.</div>';

    $$('[data-del-vindisp]').forEach(b => b.onclick = async () => {
      try {
        await api(`/api/veiculos/${id}/indisponibilidades/${Number(b.dataset.delVindisp)}`, { method:'DELETE' });
        toast('✅ Período removido.');
        await carregarIndisponibilidadesVeiculo(id);
        await load();
      } catch (e) { toast(e.message); }
    });
  } catch (e) {
    box.innerHTML = `<div class="erro">${esc(e.message)}</div>`;
  }
}

async function editarVeiculo(id) {
  const x = configVeiculos.find(v => Number(v.id) === id); if (!x) return;
  $('#veiculoId').value = x.id;
  $('#vNome').value = x.nome || '';
  $('#vPlaca').value = x.placa || '';
  $('#vCategoria').value = x.categoria || 'B';
  $('#vSituacao').value = x.ativo === false ? 'INATIVO' : (x.situacao || 'DISPONIVEL');
  $('#tituloVeiculo').textContent = x.ativo === false ? 'Editar veículo inativo' : 'Editar veículo';
  $('#erroVeiculo').classList.add('hide');
  open('mVeiculo');
  await carregarIndisponibilidadesVeiculo(id);
}

$('#novoVeiculo').onclick = novoVeiculo;

$('#vAdicionarIndisp').onclick = async () => {
  const id = Number($('#veiculoId').value || 0);
  if (!id) return toast('Salve o veículo antes de cadastrar manutenção/indisponibilidade.');
  const inicio = $('#vIndispInicio').value;
  const fim = $('#vIndispFim').value || inicio;
  if (!inicio) return toast('Informe a data inicial.');
  try {
    const r = await api(`/api/veiculos/${id}/indisponibilidades`, {
      method:'POST',
      body:JSON.stringify({
        tipo: $('#vIndispTipo').value,
        data_inicio: inicio,
        data_fim: fim,
        motivo: $('#vIndispMotivo').value
      })
    });
    $('#vIndispInicio').value = '';
    $('#vIndispFim').value = '';
    $('#vIndispMotivo').value = '';
    const afetadas = Number(r.aulas_futuras_no_periodo || 0);
    toast(afetadas
      ? `✅ Período cadastrado. ⚠️ ${afetadas} aula(s) futura(s) já existente(s) foram preservadas e precisam ser revisadas.`
      : '✅ Período cadastrado.');
    await carregarIndisponibilidadesVeiculo(id);
    await load();
  } catch (e) { toast(e.message); }
};

$('#fVeiculo').onsubmit = async e => {
  e.preventDefault();
  $('#erroVeiculo').classList.add('hide');
  const id = Number($('#veiculoId').value || 0);
  const payload = {
    nome: $('#vNome').value,
    placa: $('#vPlaca').value,
    categoria: $('#vCategoria').value,
    situacao: $('#vSituacao').value
  };
  try {
    const r = await api(id ? `/api/veiculos/${id}` : '/api/veiculos', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    close('mVeiculo');
    const afetadas = Number(r.aulas_futuras_afetadas || 0);
    toast(afetadas
      ? `✅ Veículo atualizado. ⚠️ ${afetadas} aula(s) futura(s) já existente(s) usam este veículo e foram preservadas.`
      : (id ? '✅ Veículo atualizado.' : '✅ Veículo cadastrado.'));
    await load();
    abrirTab('configuracoes');
  } catch (x) {
    $('#erroVeiculo').textContent = x.message;
    $('#erroVeiculo').classList.remove('hide');
  }
};

function novoLocal() {
  $('#fLocal').reset(); $('#localId').value = '';
  $('#tituloLocal').textContent = 'Novo local'; $('#erroLocal').classList.add('hide'); open('mLocal');
}
function editarLocal(id) {
  const x = configLocais.find(v => Number(v.id) === id); if (!x) return;
  $('#localId').value = x.id; $('#lNome').value = x.nome || ''; $('#lEndereco').value = x.endereco || '';
  $('#tituloLocal').textContent = x.ativo === false ? 'Editar local inativo' : 'Editar local';
  $('#erroLocal').classList.add('hide'); open('mLocal');
}
$('#novoLocal').onclick = novoLocal;
$('#fLocal').onsubmit = async e => {
  e.preventDefault(); $('#erroLocal').classList.add('hide');
  const id = Number($('#localId').value || 0);
  const payload = { nome: $('#lNome').value, endereco: $('#lEndereco').value };
  try {
    await api(id ? `/api/locais/${id}` : '/api/locais', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close('mLocal'); toast(id ? '✅ Local atualizado.' : '✅ Local cadastrado.');
    await load(); abrirTab('configuracoes');
  } catch (x) {
    $('#erroLocal').textContent = x.message;
    $('#erroLocal').classList.remove('hide');
  }
};

function dadosRecursoConfig(tipo, id) {
  const mapa = {
    instrutor: { lista: configInstrutores, nome: 'instrutor', rota: 'instrutores' },
    veiculo: { lista: configVeiculos, nome: 'veículo', rota: 'veiculos' },
    local: { lista: configLocais, nome: 'local', rota: 'locais' }
  };
  const cfg = mapa[tipo];
  if (!cfg) return null;
  return { cfg, item: cfg.lista.find(v => Number(v.id) === id) };
}

function pedirAlterarAtivoRecurso(tipo, id, novoAtivo) {
  const dados = dadosRecursoConfig(tipo, id);
  if (!dados?.item) return;
  const { cfg, item } = dados;

  if (novoAtivo) {
    confirmar(
      `Reativar ${cfg.nome}?`,
      `${item.nome} voltará a aparecer nas novas aulas e nos planos automáticos.`,
      async () => {
        try {
          await api(`/api/${cfg.rota}/${id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo: true }) });
          toast(`✅ ${cfg.nome.charAt(0).toUpperCase() + cfg.nome.slice(1)} reativado.`);
          await load(); abrirTab('configuracoes');
        } catch (e) { toast(e.message); }
      },
      'Reativar'
    );
    return;
  }

  confirmar(
    `Desativar ${cfg.nome}?`,
    `${item.nome} deixará de aparecer em novas aulas e novos planos. O histórico será preservado. Se houver plano ativo ou aula futura vinculada, o AutoAgenda bloqueará a desativação.`,
    async () => {
      try {
        await api(`/api/${cfg.rota}/${id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo: false }) });
        toast(`✅ ${cfg.nome.charAt(0).toUpperCase() + cfg.nome.slice(1)} desativado.`);
        await load(); abrirTab('configuracoes');
      } catch (e) { toast(e.message); }
    },
    'Desativar'
  );
}

function pedirExcluirRecursoPermanente(tipo, id) {
  const dados = dadosRecursoConfig(tipo, id);
  if (!dados?.item) return;
  const { cfg, item } = dados;

  if (item.ativo !== false) return toast('Desative o cadastro antes de excluir definitivamente.');
  if (totalHistoricoRecurso(item) > 0) return toast('Este cadastro possui histórico e deve permanecer inativo.');

  confirmar(
    `Excluir definitivamente ${cfg.nome}?`,
    `${item.nome} nunca foi usado em aulas ou planos. Esta exclusão é permanente e não poderá ser desfeita.`,
    async () => {
      try {
        await api(`/api/${cfg.rota}/${id}/permanente`, { method: 'DELETE' });
        toast(`✅ ${cfg.nome.charAt(0).toUpperCase() + cfg.nome.slice(1)} excluído definitivamente.`);
        await load(); abrirTab('configuracoes');
      } catch (e) { toast(e.message); }
    },
    'Excluir definitivamente'
  );
}

$('#toggleInativosConfig').onclick = () => {
  mostrarInativosConfig = !mostrarInativosConfig;
  renderConfiguracoes();
  bindDynamic();
};

$('#fFuncionamento').onsubmit = async e => {
  e.preventDefault();
  $('#erroFuncionamento').classList.add('hide');

  const payload = {
    dias_funcionamento: $$('input[name="cfgDia"]:checked').map(c => Number(c.value)),
    hora_abertura: $('#cfgHoraAbertura').value,
    hora_encerramento: $('#cfgHoraEncerramento').value,
    duracao_padrao_minutos: Number($('#cfgDuracaoPadrao').value),
    intervalo_minutos: Number($('#cfgIntervalo').value || 0)
  };

  try {
    $('#salvarFuncionamento').disabled = true;
    $('#salvarFuncionamento').textContent = 'Salvando...';
    const r = await api('/api/configuracoes/funcionamento', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    configFuncionamento = r;
    renderFuncionamento();
    renderSemana();
    const fora = Number(r.aulas_futuras_fora_do_horario || 0);
    toast(fora
      ? `✅ Funcionamento salvo. ⚠️ ${fora} aula(s) futura(s) antiga(s) ficaram fora da nova regra e foram preservadas.`
      : '✅ Horário de funcionamento salvo.');
  } catch (x) {
    $('#erroFuncionamento').textContent = x.message;
    $('#erroFuncionamento').classList.remove('hide');
  } finally {
    $('#salvarFuncionamento').disabled = false;
    $('#salvarFuncionamento').textContent = '💾 Salvar funcionamento';
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
  $('#pDataInicio').value = proximaDataFuncionamento(iso());
  $('#pHora').value = hora(configFuncionamento.hora_abertura || '07:00');
  $('#pDuracao').value = String(Number(configFuncionamento.duracao_padrao_minutos || 50));
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
$('#filtroData').onchange = async () => {
  try {
    const d = $('#filtroData').value || iso();
    aulas = await api(`/api/aulas?data_inicio=${encodeURIComponent(d)}&data_fim=${encodeURIComponent(d)}`);
    render();
  } catch (e) { toast(e.message); }
};
$('#irAgenda').onclick = () => abrirTab('agenda');

$('#filtroSemana').value = iso();
$('#filtroSemana').onchange = () => carregarAulasSemana();
$('#filtroInstrutorSemana').onchange = renderSemana;
$('#filtroVeiculoSemana').onchange = renderSemana;
$('#semanaHoje').onclick = () => { $('#filtroSemana').value = iso(); carregarAulasSemana(); };
$('#semanaAnterior').onclick = () => {
  $('#filtroSemana').value = addDaysISO(inicioSemanaISO($('#filtroSemana').value || iso()), -7);
  carregarAulasSemana();
};
$('#semanaProxima').onclick = () => {
  $('#filtroSemana').value = addDaysISO(inicioSemanaISO($('#filtroSemana').value || iso()), 7);
  carregarAulasSemana();
};

const botaoTema = $('#alternarTema');
if (botaoTema) botaoTema.onclick = alternarTema;
atualizarBotaoTema();

health();
load();
