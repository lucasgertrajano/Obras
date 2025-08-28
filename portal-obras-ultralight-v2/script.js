/* ================== Portal de Obras — JS (frontend) ==================
   - Cache local leve (metadados + miniaturas comprimidas)
   - Envia JSON + arquivos (capa e extras) ao Apps Script Web App
   ------------------------------------------------------------------ */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const LS_KEY = "portal_obras_items_v2";
const state = { items: [], filtered: [], editingId: null, lb: { albumIndex:-1, photoIndex:0 } };

const fmtDate = iso => new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(new Date(iso));
const byCompletionDesc = (a,b) => (b.completion||0) - (a.completion||0);
const byPhotoDateDesc  = (a,b) => new Date(b.takenAt||b.createdAt||0) - new Date(a.takenAt||a.createdAt||0);

/* ========= BACKEND (Apps Script Web App) =========
   Use exatamente os valores do seu deploy /exec e o MESMO SECRET do Code.gs. */
const BACKEND = {
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyq7dctE71LGLq3mRG9ttf0zwrBm4QI4jYx6l0lzQ-08j97EGlKZCk6ucXz2TVqcV5H4g/exec',
  SECRET:      'OBRAS_2025_PROD'
};
/* ================================================ */

/* ---------- utilidades ---------- */

// Comprime imagem para miniatura (dataURL) – poupa localStorage
async function shrinkImage(file, maxW = 1024, maxH = 1024, quality = 0.72) {
  if (!file || !file.type?.startsWith('image/')) return null;
  const img = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
  let { width:w, height:h } = img;
  const ratio = Math.min(maxW / w, maxH / h, 1); w = Math.round(w*ratio); h = Math.round(h*ratio);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

// Salva versão “leve” no localStorage (evita estourar quota)
function safeSaveLocal(items){
  const lightweight = items.map(it => ({
    id: it.id, title: it.title, engineer: it.engineer, location: it.location,
    startDate: it.startDate, endDate: it.endDate, status: it.status, completion: it.completion,
    cover: it.cover && it.cover.startsWith('data:') ? it.cover : '',
    photos: (it.photos||[]).map(p => ({ src: (p.src?.startsWith('data:') ? p.src : ''), alt: p.alt || '', takenAt: p.takenAt || new Date().toISOString() }))
  }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(lightweight)); }
  catch (err) {
    console.warn('Cache local cheio; salvando versão mínima.', err);
    const minimal = lightweight.map(it => ({...it, cover:'', photos: []}));
    try { localStorage.setItem(LS_KEY, JSON.stringify(minimal)); } catch {}
  }
}

function hydrateLocal(){ try{ const raw = localStorage.getItem(LS_KEY); if(raw) state.items = JSON.parse(raw);}catch{} }

/* ---------- carga inicial ---------- */
async function loadInitial(){
  try{
    const res  = await fetch('data/albums.json');
    const demo = await res.json();
    hydrateLocal();
    const map = new Map(demo.map(d=>[d.id||d.title,d]));
    for(const it of state.items){ map.set(it.id||it.title, it); }
    state.items = [...map.values()];
  }catch{ hydrateLocal(); }
  normalize(); fillYears(); render();
}

/* ---------- normalização e filtros ---------- */
function normalize(){
  for(const it of state.items){
    it.photos = (it.photos||[]).map(p=>({...p, takenAt: p.takenAt || new Date().toISOString()})).sort(byPhotoDateDesc);
  }
  state.items.sort(byCompletionDesc);
}

function fillYears(){
  const years = new Set(state.items.map(i => new Date(i.startDate).getFullYear()).filter(y=>!Number.isNaN(y)));
  $('#yearFilter').innerHTML =
    `<option value="all">Todos os anos</option>` +
    [...years].sort((a,b)=>b-a).map(v=>`<option>${v}</option>`).join('');
}

function render(){
  const y = $('#yearFilter').value, s = $('#statusFilter').value, q = $('#searchInput').value.trim().toLowerCase();
  state.filtered = state.items.filter(it=>{
    const okY = y==='all' || String(new Date(it.startDate).getFullYear())===y;
    const okS = s==='all' || it.status===s;
    const t = `${it.title||''} ${it.engineer||''} ${it.location||''}`.toLowerCase();
    return okY && okS && (!q || t.includes(q));
  });

  const wrap = $('#timeline'); wrap.innerHTML='';
  if(!state.filtered.length){ $('#empty').hidden=false; return; } else $('#empty').hidden=true;

  const tpl = $('#tplCard');
  state.filtered.forEach((it, idx)=>{
    const n = tpl.content.cloneNode(true);
    const img = n.querySelector('.card__img');
    img.src = it.cover || it.photos?.[0]?.src || 'images/placeholder.jpg';
    img.alt = it.title || 'Obra';

    n.querySelector('.overlay').style.opacity = Math.min(1, Math.max(0, (it.completion||0)/100));
    n.querySelector('.badge').textContent = `${it.status||'—'} • ${it.completion||0}%`;
    n.querySelector('.title').textContent = it.title || 'Sem título';
    n.querySelector('.sub').textContent   = it.engineer || '—';
    n.querySelector('.loc').textContent   = it.location || '—';
    n.querySelector('.start').textContent = it.startDate ? fmtDate(it.startDate) : '—';
    n.querySelector('.end').textContent   = it.endDate ? fmtDate(it.endDate) : '—';

    n.querySelectorAll('[data-action="open-album"]').forEach(b=> b.addEventListener('click',()=>openAlbum(idx)));
    n.querySelector('[data-action="edit"]').addEventListener('click',()=>openModal(it.id));
    wrap.appendChild(n);
  });
  reveal();
}

function reveal(){
  const io=new IntersectionObserver(es=>{
    for(const e of es){ if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target);} }
  },{threshold:.12});
  $$('.card.reveal').forEach(el=>io.observe(el));
}

/* ---------- Álbum (lightbox) ---------- */
function openAlbum(filteredIndex){
  const it = state.filtered[filteredIndex]; if(!it || !(it.photos||[]).length) return;
  state.lb.albumIndex=filteredIndex; state.lb.photoIndex=0;
  renderLightbox(); $('#lightbox').hidden=false; document.body.style.overflow='hidden'; document.body.classList.add('album-open');
}
function renderLightbox(){
  const it=state.filtered[state.lb.albumIndex]; const p=it.photos[state.lb.photoIndex];
  $('#lbImg').src=p.src || 'images/placeholder.jpg';
  $('#lbTitle').textContent=it.title || 'Sem título';
  $('#lbInfo').innerHTML = `
    <div><strong>Engenheiro:</strong> ${it.engineer||'—'}</div>
    <div><strong>Local:</strong> ${it.location||'—'}</div>
    <div><strong>Status:</strong> ${it.status||'—'} • ${it.completion||0}%</div>
    <div><strong>Início:</strong> ${it.startDate?fmtDate(it.startDate):'—'}</div>
    <div><strong>Prev. Término:</strong> ${it.endDate?fmtDate(it.endDate):'—'}</div>`;
  $('#lbDate').textContent = p.takenAt ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(p.takenAt)) : '';
  const th=$('#thumbs'); th.innerHTML='';
  it.photos.forEach((ph,i)=>{
    const b=document.createElement('button'); b.className='thumb'+(i===state.lb.photoIndex?' active':'');
    const im=document.createElement('img'); im.src=ph.src || 'images/placeholder.jpg'; im.alt=ph.alt||it.title||'';
    b.appendChild(im); b.addEventListener('click',()=>{ state.lb.photoIndex=i; renderLightbox();});
    th.appendChild(b);
  });
}
function closeLightbox(){ $('#lightbox').hidden=true; document.body.style.overflow=''; document.body.classList.remove('album-open'); }
function navLightbox(d){ const it=state.filtered[state.lb.albumIndex]; const n=it.photos.length; state.lb.photoIndex=(state.lb.photoIndex+d+n)%n; renderLightbox(); }

/* ---------- Modal ---------- */
function openModal(id=null){
  $('#modal').hidden=false; document.body.style.overflow='hidden';
  $('#modalTitle').textContent = id?'Editar obra':'Nova obra'; state.editingId=id;
  const f=$('#workForm'); f.reset();
  if(id){
    const it=state.items.find(x=>x.id===id);
    if(it){
      f.title.value=it.title||''; f.engineer.value=it.engineer||''; f.location.value=it.location||'';
      f.startDate.value=(it.startDate||'').slice(0,10); f.endDate.value=(it.endDate||'').slice(0,10);
      f.status.value=it.status||'Em andamento'; f.completion.value=it.completion??0;
    }
  }
}
function closeModal(){ $('#modal').hidden=true; document.body.style.overflow=''; state.editingId=null; }

/* ---------- Envio ao BACKEND ---------- */
async function sendToBackend(payload, coverFile, extraFiles=[]){
  if (!BACKEND.WEB_APP_URL || !BACKEND.SECRET) { console.warn('BACKEND não configurado. Pulei o envio.'); return { ok:false, skipped:true }; }
  const form = new FormData();
  form.append("secret", BACKEND.SECRET);
  form.append('id', payload.id); form.append('title', payload.title);
  form.append('engineer', payload.engineer); form.append('location', payload.location);
  form.append('startDate', payload.startDate); form.append('endDate', payload.endDate);
  form.append('status', payload.status); form.append('completion', String(payload.completion));
  if (coverFile) form.append('cover', coverFile, coverFile.name || 'capa.jpg');
  extraFiles.forEach((f,i)=> form.append(`extra${i}`, f, f.name || `foto_${String(i+1).padStart(2,'0')}.jpg`));
  const res = await fetch(BACKEND.WEB_APP_URL, { method:'POST', body:form });
  if (!res.ok) throw new Error('Falha no backend: '+res.status);
  return await res.json();
}

/* ---------- Submit ---------- */
$('#workForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f=e.currentTarget;
  const payload = {
    id: state.editingId || ('obra-'+Math.random().toString(36).slice(2,8)),
    title: f.title.value.trim(), engineer: f.engineer.value.trim(), location: f.location.value.trim(),
    startDate: f.startDate.value, endDate: f.endDate.value, status: f.status.value,
    completion: Math.max(0,Math.min(100,Number(f.completion.value)||0)), photos: []
  };

  let coverPreviewDataURL = null;
  const extrasFiles = [...f.extraFiles.files];

  if(!state.editingId){
    if(f.coverFile.files.length){
      coverPreviewDataURL = await shrinkImage(f.coverFile.files[0]);
      payload.cover = coverPreviewDataURL || '';
      payload.photos.push({ src: coverPreviewDataURL || '', alt: payload.title+' (capa)', takenAt:new Date().toISOString() });
    } else { alert('Selecione a foto principal.'); return; }
  } else {
    const it=state.items.find(x=>x.id===state.editingId);
    if(it){ payload.cover=it.cover||''; payload.photos=(it.photos||[]).slice(); }
  }

  for (const file of extrasFiles){
    const thumb = await shrinkImage(file);
    payload.photos.push({ src: thumb || '', alt: payload.title, takenAt:new Date().toISOString() });
  }
  payload.photos.sort(byPhotoDateDesc);

  // Atualiza UI + cache leve
  const idx=state.items.findIndex(x=>x.id===payload.id);
  if(idx>=0) state.items[idx]={...state.items[idx],...payload}; else state.items.push(payload);
  normalize(); safeSaveLocal(state.items); closeModal(); render();

  try{
    const result = await sendToBackend(payload, f.coverFile.files[0] || null, extrasFiles);
    if (result?.ok) { console.log('Backend OK:', result); }
    else if (!result?.skipped) { console.warn('Backend retornou erro:', result); alert('Obra salva localmente. Não foi possível enviar ao Drive agora (veja o console).'); }
  }catch(err){
    console.error('Erro ao enviar para o backend:', err);
    alert('Obra salva localmente. Houve um problema ao enviar para o Drive (veja o console).');
  }
});

/* ---------- Eventos gerais ---------- */
$('#btnNew').addEventListener('click',()=>openModal(null));
$('#cancel').addEventListener('click',closeModal);
$('#modalClose').addEventListener('click',closeModal);

$('#lbClose').addEventListener('click',closeLightbox);
$('#lbPrev').addEventListener('click',()=>navLightbox(-1));
$('#lbNext').addEventListener('click',()=>navLightbox(1));

$('#yearFilter').addEventListener('change',render);
$('#statusFilter').addEventListener('change',render);
$('#searchInput').addEventListener('input',render);
$('#btnTop').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));

document.addEventListener('click',(e)=>{ if(e.target.id==='lightbox' || e.target.id==='modal'){ closeLightbox(); closeModal(); window.scrollTo({top:0,behavior:'smooth'}); }});
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closeLightbox(); closeModal(); } if(!$('#lightbox').hidden){ if(e.key==='ArrowRight') navLightbox(1); if(e.key==='ArrowLeft') navLightbox(-1); }});

loadInitial();
