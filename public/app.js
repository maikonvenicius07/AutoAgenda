const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let alunos=[],instrutores=[],veiculos=[],locais=[],aulas=[];
let confirmAction=null;

const iso=()=>{const d=new Date(),o=d.getTimezoneOffset();return new Date(d-o*60000).toISOString().slice(0,10)};
const hora=h=>h?h.slice(0,5):'';
const dataISO=d=>String(d||'').slice(0,10);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(u,o={}){const r=await fetch(u,{headers:{'Content-Type':'application/json',...(o.headers||{})},...o});let d={};try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error||'Erro');e.status=r.status;e.data=d;throw e}return d}
function toast(t){$('#toast').textContent=t;$('#toast').classList.remove('hide');clearTimeout(window.__t);window.__t=setTimeout(()=>$('#toast').classList.add('hide'),2800)}
function open(id){$('#'+id).classList.remove('hide')}
function close(id){$('#'+id).classList.add('hide')}

$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab))});
$$('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));

function statusLabel(s){return({AGENDADA:'⏳ Agendada',CONFIRMADA:'✅ Confirmada',REALIZADA:'🏁 Realizada',REMARCADA:'🔄 Remarcada',CANCELADA:'❌ Cancelada',FALTOU:'🚫 Faltou'})[s]||s}

function studentHtml(a){
  const restantes=Math.max(0,Number(a.aulas_contratadas||0)-Number(a.aulas_realizadas||0));
  return `<article class="student">
    <h3>${esc(a.nome)}</h3>
    <p>📲 ${esc(a.whatsapp)}</p>
    <p>📧 ${esc(a.email||'Sem e-mail')}</p>
    <p>Categoria ${esc(a.categoria)} · <b>${a.aulas_realizadas}</b> realizadas · <b>${restantes}</b> restantes</p>
    <div class="actions-row">
      <button type="button" class="mini edit" data-edit-aluno="${a.id}">✏️ Editar</button>
      <button type="button" class="mini delete" data-del-aluno="${a.id}">🗑️ Excluir</button>
    </div>
  </article>`;
}

function aulaHtml(x,comAcoes=false){
  return `<div class="lesson">
    <div class="lesson-main">
      <b>${hora(x.hora_inicio)} — ${esc(x.aluno_nome)}</b>
      <small>👨‍🏫 ${esc(x.instrutor_nome)} · 🚗 ${esc(x.veiculo_nome)} ${esc(x.veiculo_placa||'')}</small>
      <small>📍 ${esc(x.local_nome)} · ${statusLabel(x.status)}</small>
    </div>
    ${comAcoes?`<div class="actions-row lesson-actions"><button type="button" class="mini edit" data-edit-aula="${x.id}">✏️ Alterar</button><button type="button" class="mini delete" data-del-aula="${x.id}">🗑️ Excluir</button></div>`:''}
  </div>`;
}

function render(){
  $('#sAlunos').textContent=alunos.length;
  const h=iso(),ah=aulas.filter(a=>dataISO(a.data_aula)===h && a.status!=='CANCELADA');
  $('#sHoje').textContent=ah.length;
  $('#listaAlunos').innerHTML=alunos.length?alunos.map(studentHtml).join(''):'<p>Nenhum aluno cadastrado.</p>';
  $('#hoje').innerHTML=ah.length?ah.map(a=>aulaHtml(a,false)).join(''):'<p>Nenhuma aula hoje.</p>';
  const f=$('#filtroData').value;
  const fa=aulas.filter(a=>dataISO(a.data_aula)===f);
  $('#listaAgenda').innerHTML=fa.length?fa.map(a=>aulaHtml(a,true)).join(''):'<p>Nenhuma aula nesta data.</p>';
  $('#aAluno').innerHTML=alunos.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('#aInstrutor').innerHTML=instrutores.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('#aVeiculo').innerHTML=veiculos.map(x=>`<option value="${x.id}">${esc(x.nome)}${x.placa?' - '+esc(x.placa):''}</option>`).join('');
  $('#aLocal').innerHTML=locais.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  bindDynamic();
}

function bindDynamic(){
  $$('[data-edit-aluno]').forEach(b=>b.onclick=()=>editarAluno(Number(b.dataset.editAluno)));
  $$('[data-del-aluno]').forEach(b=>b.onclick=()=>pedirExcluirAluno(Number(b.dataset.delAluno)));
  $$('[data-edit-aula]').forEach(b=>b.onclick=()=>editarAula(Number(b.dataset.editAula)));
  $$('[data-del-aula]').forEach(b=>b.onclick=()=>pedirExcluirAula(Number(b.dataset.delAula)));
}

async function load(){try{[alunos,instrutores,veiculos,locais,aulas]=await Promise.all([api('/api/alunos'),api('/api/instrutores'),api('/api/veiculos'),api('/api/locais'),api('/api/aulas')]);render()}catch(e){console.error(e);toast('Erro ao carregar dados')}}
async function health(){try{await api('/api/health');$('#db').textContent='🟢 Banco conectado — os cadastros serão salvos.';$('#db').className='db ok'}catch{$('#db').textContent='🔴 Banco não conectado. Configure DATABASE_URL no Render.';$('#db').className='db fail'}}

function novoAluno(){
  $('#fAluno').reset();$('#alunoId').value='';$('#contratadas').value=20;$('#realizadas').value=0;$('#tituloAluno').textContent='Novo aluno';$('#salvarAluno').textContent='Salvar aluno';$('#erroAluno').classList.add('hide');open('mAluno');
}

function editarAluno(id){
  const a=alunos.find(x=>Number(x.id)===id);if(!a)return;
  $('#alunoId').value=a.id;$('#nome').value=a.nome||'';$('#whats').value=a.whatsapp||'';$('#email').value=a.email||'';$('#cat').value=a.categoria||'B';$('#contratadas').value=a.aulas_contratadas||20;$('#realizadas').value=a.aulas_realizadas||0;$('#obs').value=a.observacoes||'';
  $('#tituloAluno').textContent='Editar aluno';$('#salvarAluno').textContent='Salvar alterações';$('#erroAluno').classList.add('hide');open('mAluno');
}

function confirmar(titulo,texto,acao){$('#confirmTitulo').textContent=titulo;$('#confirmTexto').textContent=texto;confirmAction=acao;open('confirm')}
$('#confirmNao').onclick=()=>{confirmAction=null;close('confirm')};
$('#confirmSim').onclick=async()=>{const fn=confirmAction;confirmAction=null;close('confirm');if(fn)await fn()};

function pedirExcluirAluno(id){const a=alunos.find(x=>Number(x.id)===id);if(!a)return;confirmar('Excluir aluno?',`O aluno ${a.nome} deixará de aparecer na lista. As aulas antigas vinculadas a ele serão preservadas.`,async()=>{try{await api('/api/alunos/'+id,{method:'DELETE'});toast('✅ Aluno excluído.');await load()}catch(e){toast(e.message)}})}

function novaAula(){
  if(!alunos.length)return toast('Cadastre um aluno primeiro.');
  $('#fAula').reset();$('#aulaId').value='';$('#aData').value=$('#filtroData').value||iso();$('#aHora').value='08:00';$('#aDur').value='50';$('#aStatus').value='AGENDADA';$('#tituloAula').textContent='Nova aula';$('#salvarAula').textContent='Agendar aula';$('#erroAula').classList.add('hide');render();open('mAula');
}

function editarAula(id){
  const a=aulas.find(x=>Number(x.id)===id);if(!a)return;
  render();
  $('#aulaId').value=a.id;$('#aAluno').value=a.aluno_id;$('#aInstrutor').value=a.instrutor_id;$('#aVeiculo').value=a.veiculo_id;$('#aLocal').value=a.local_id;$('#aData').value=dataISO(a.data_aula);$('#aHora').value=hora(a.hora_inicio);$('#aDur').value=String(a.duracao_minutos||50);$('#aStatus').value=a.status||'AGENDADA';$('#aObs').value=a.observacoes||'';
  $('#tituloAula').textContent='Alterar aula';$('#salvarAula').textContent='Salvar alterações';$('#erroAula').classList.add('hide');open('mAula');
}

function pedirExcluirAula(id){
  const a=aulas.find(x=>Number(x.id)===id);if(!a)return;
  confirmar('Excluir aula?',`Excluir definitivamente a aula de ${a.aluno_nome} em ${dataISO(a.data_aula).split('-').reverse().join('/')} às ${hora(a.hora_inicio)}?`,async()=>{try{await api('/api/aulas/'+id,{method:'DELETE'});toast('✅ Aula excluída.');await load()}catch(e){toast(e.message)}})
}

$('#novoAluno').onclick=novoAluno;
$('#novaAula').onclick=novaAula;

$('#fAluno').onsubmit=async e=>{
  e.preventDefault();$('#erroAluno').classList.add('hide');
  const id=Number($('#alunoId').value||0);
  const payload={nome:$('#nome').value,whatsapp:$('#whats').value,email:$('#email').value,categoria:$('#cat').value,aulas_contratadas:Number($('#contratadas').value),aulas_realizadas:Number($('#realizadas').value),observacoes:$('#obs').value};
  try{
    await api(id?'/api/alunos/'+id:'/api/alunos',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    close('mAluno');toast(id?'✅ Aluno atualizado.':'✅ Aluno salvo no banco.');await load();
  }catch(x){$('#erroAluno').textContent=x.message;$('#erroAluno').classList.remove('hide')}
};

$('#fAula').onsubmit=async e=>{
  e.preventDefault();$('#erroAula').classList.add('hide');
  const id=Number($('#aulaId').value||0);
  const payload={aluno_id:Number($('#aAluno').value),instrutor_id:Number($('#aInstrutor').value),veiculo_id:Number($('#aVeiculo').value),local_id:Number($('#aLocal').value),data_aula:$('#aData').value,hora_inicio:$('#aHora').value,duracao_minutos:Number($('#aDur').value),status:$('#aStatus').value,observacoes:$('#aObs').value};
  try{
    await api(id?'/api/aulas/'+id:'/api/aulas',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    const dataEscolhida=$('#aData').value;close('mAula');$('#filtroData').value=dataEscolhida;toast(id?'✅ Aula alterada.':'✅ Aula salva no banco.');await load();
  }catch(x){$('#erroAula').textContent=x.status===409?'⚠️ Conflito de horário. Escolha outro horário.':x.message;$('#erroAula').classList.remove('hide')}
};

$('#filtroData').value=iso();$('#filtroData').onchange=render;
health();load();
