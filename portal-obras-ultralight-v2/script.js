/* ================== Portal de Obras — JS (frontend) ==================
   - Cache local leve (metadados + miniaturas comprimidas)
   - Envia JSON + arquivos (capa e extras) ao Apps Script Web App
   ------------------------------------------------------------------ */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const LS_KEY = "portal_obras_items_v2";
const MAX_LOCAL_PHOTOS = 12; // limite por obra no cache leve

const state = { items: [], filtered: [], editingId: null, lb: { albumIndex:-1, photoIndex:0 } };

const fmtDate = iso => new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(new Date(iso));
const byCompletionDesc = (a,b) => (b.completion||0) - (a.completion||0);
const byPhotoDateDesc  = (a,b) => new Date(b.takenAt||b.createdAt||0) - new Date(a.takenAt||a.createdAt||0);

// Placeholder inline (evita 404)
const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
      <rect width="100%" height="100%" fill="#e9ecef"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        style="fill:#6c757d;font-family:Inter,Arial,sans-serif;font-size:28px">Sem imagem</text>
    </svg>`
  );

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
  const ratio = Math.min(maxW / w, maxH / h, 1);
  w = Math.round(w*ratio); h = Math.round(h*ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

// Arquivo -> dataURL (para fallback base64)
function fileToDataURL(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Salva versão “leve” no localStorage (evita estourar quota)
function safeSaveLocal(items){
  const lightweight = items.map(it => {
    const photos = (it.photos||[]).slice(0, MAX_LOCAL_PHOTOS).map(p => ({
      src: (p.src && p.src.startsWith('data:')) ? p.src : '',
      alt: p.alt || '',
      takenAt: p.takenAt || new Date().toISOString()
    }));
    return {
      id: it.id, title: it.title, engineer: it.engineer, location: it.location,
      startDate: it.startDate, endDate: it.endDate, status: it.status, completion: it.completion,
      cover: (it.cover && it.cover.startsWith('data:')) ? it.cover : '',
      photos
    };
  });

  try { localStorage.setItem(LS_KEY, JSON.stringify(lightweight)); }
  catch (err) {
    console.warn('Cache local cheio; salvando versão mínima.', err);
    const minimal = lightweight.map(it => ({...it, cover:'', photos: []}));
    try { localStorage.setItem(LS_KEY, JSON.stringify(minimal)); } catch {}
  }
}

function hydrateLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) state.items = JSON.parse(raw);
  }catch{}
}

/* ---------- carga inicial ---------- */
async function loadInitial(){
  try{
    const res  = await fetch('data/albums.json', {cache:'no-store'});
    if (res.ok) {
      const demo = await res.json();
      hydrateLocal();
      const map = new Map((demo||[]).map(d=>[d.id||d.title,d]));
      for(const it of state.items){ map.set(it.id||it.title, it); }
      state.items = [...map.values()];
    } else {
      hydrateLocal();
    }
  }catch{
    hydrateLocal();
  }
  normalize();
  fillYears();
  render();
}

/* ---------- normalização e filtros ---------- */
function normalize(){
  for(const it of state.items){
    it.photos = (it.photos||[]).map(p=>({
      ...p, takenAt: p.takenAt || new Date().toISOString()
    })).sort(byPhotoDateDesc);
  }
  state.items.sort(byCompletionDesc);
}

function fillYears(){
  const years = new Set(state.items
    .map(i => new Date(i.startDate).getFullYear())
    .filter(y => !Number.isNaN(y)));
  $('#yearFilter').innerHTML =
    `<option value="all">Todos os anos</option>` +
    [...years].sort((a,b)=>b-a).map(v=>`<option>${v}</option>`).join('');
}

function render(){
  const y = $('#yearFilter').value;
  const s = $('#statusFilter').value;
  const q = $('#searchInput').value.trim().toLowerCase();

  state.filtered = state.items.filter(it=>{
    const okY = y==='all' || String(new Date(it.startDate).getFullYear())===y;
    const okS = s==='all' || it.status===s;
    const t = `${it.title||''} ${it.engineer||''} ${it.location||''}`.toLowerCase();
    return okY && okS && (!q || t.includes(q));
  });

  const wrap = $('#timeline');
  wrap.innerHTML = '';
  if(!state.filtered.length){
    $('#empty').hidden = false;
    return;
  }
  $('#empty').hidden = true;

  const tpl = $('#tplCard');
  state.filtered.forEach((it, idx)=>{
    const n = tpl.content.cloneNode(true);
    const img = n.querySelector('.card__img');
    img.src = it.cover || it.photos?.[0]?.src || PLACEHOLDER;
    img.alt = it.title || 'Obra';

    n.querySelector('.overlay').style.opacity = Math.min(1, Math.max(0, (it.completion||0)/100));
    n.querySelector('.badge').textContent = `${it.status||'—'} • ${it.completion||0}%`;
    n.querySelector('.title').textContent = it.title || 'Sem título';
    n.querySelector('.sub').textContent   = it.engineer || '—';
    n.querySelector('.loc').textContent   = it.location || '—';
    n.querySelector('.start').textContent = it.startDate ? fmtDate(it.startDate) : '—';
    n.querySelector('.end').textContent   = it.endDate ? fmtDate(it.endDate) : '—';

    n.querySelectorAll('[data-action="open-album"]').forEach(b =>
      b.addEventListener('click',()=>openAlbum(idx))
    );
    n.querySelector('[data-action="edit"]').addEventListener('click',()=>openModal(it.id));
    wrap.appendChild(n);
  });

  reveal();
}

function reveal(){
  const io = new IntersectionObserver(es=>{
    for(const e of es){
      if(e.isIntersecting){
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    }
  },{threshold:.12});
  $$('.card.reveal').forEach(el=>io.observe(el));
}

/* ---------- Álbum (lightbox) ---------- */
function openAlbum(filteredIndex){
  const it = state.filtered[filteredIndex];
  if(!it || !(it.photos||[]).length) return;
  state.lb.albumIndex = filteredIndex;
  state.lb.photoIndex = 0;
  renderLightbox();
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  document.body.classList.add('album-open');
}
function renderLightbox(){
  const it = state.filtered[state.lb.albumIndex];
  const p  = it.photos[state.lb.photoIndex];
  $('#lbImg').src = p.src || PLACEHOLDER;
  $('#lbTitle').textContent = it.title || 'Sem título';
  $('#lbInfo').innerHTML = `
    <div><strong>Engenheiro:</strong> ${it.engineer||'—'}</div>
    <div><strong>Local:</strong> ${it.location||'—'}</div>
    <div><strong>Status:</strong> ${it.status||'—'} • ${it.completion||0}%</div>
    <div><strong>Início:</strong> ${it.startDate?fmtDate(it.startDate):'—'}</div>
    <div><strong>Prev. Término:</strong> ${it.endDate?fmtDate(it.endDate):'—'}</div>`;
  $('#lbDate').textContent = p.takenAt
    ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(p.takenAt))
    : '';
  const th = $('#thumbs');
  th.innerHTML = '';
  it.photos.forEach((ph,i)=>{
    const b  = document.createElement('button');
    b.className = 'thumb' + (i===state.lb.photoIndex ? ' active' : '');
    const im = document.createElement('img');
    im.src = ph.src || PLACEHOLDER;
    im.alt = ph.alt || it.title || '';
    b.appendChild(im);
    b.addEventListener('click',()=>{ state.lb.photoIndex = i; renderLightbox(); });
    th.appendChild(b);
  });
}
function closeLightbox(){
  $('#lightbox').hidden = true;
  document.body.style.overflow = '';
  document.body.classList.remove('album-open');
}
function navLightbox(d){
  const it = state.filtered[state.lb.albumIndex];
  const n  = it.photos.length;
  state.lb.photoIndex = (state.lb.photoIndex + d + n) % n;
  renderLightbox();
}

/* ---------- Modal ---------- */
function openModal(id=null){
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#modalTitle').textContent = id ? 'Editar obra' : 'Nova obra';
  state.editingId = id;
  const f = $('#workForm');
  f.reset();
  if(id){
    const it = state.items.find(x=>x.id===id);
    if(it){
      f.title.value      = it.title||'';
      f.engineer.value   = it.engineer||'';
      f.location.value   = it.location||'';
      f.startDate.value  = (it.startDate||'').slice(0,10);
      f.endDate.value    = (it.endDate||'').slice(0,10);
      f.status.value     = it.status||'Em andamento';
      f.completion.value = it.completion ?? 0;
    }
  }
}
function closeModal(){
  $('#modal').hidden = true;
  document.body.style.overflow = '';
  state.editingId = null;
}

/* ---------- Envio ao BACKEND ---------- */

// 1) tentativa: envia arquivos reais (FormData)
// 2) fallback: reenvia como campos *_b64 (base64) caso a 1ª falhe OU
//    se a resposta vier ok:true mas sem files (indicando que não salvou fotos).
async function sendToBackend(payload, coverFile, extraFiles=[]){
  if (!BACKEND.WEB_APP_URL || !BACKEND.SECRET) {
    console.warn('BACKEND não configurado. Pulei o envio.');
    return { ok:false, skipped:true };
  }

  const triedFilesCount = (coverFile ? 1 : 0) + extraFiles.length;

  // -------- tentativa principal (arquivos) --------
  const form1 = new FormData();
  form1.append('secret', BACKEND.SECRET);
  form1.append('id', payload.id);
  form1.append('title', payload.title);
  form1.append('engineer', payload.engineer);
  form1.append('location', payload.location);
  form1.append('startDate', payload.startDate);
  form1.append('endDate', payload.endDate);
  form1.append('status', payload.status);
  form1.append('completion', String(payload.completion));

  if (coverFile) form1.append('cover', coverFile, coverFile.name || 'capa.jpg');
  extraFiles.forEach((f,i)=> form1.append(`extra${i}`, f, f.name || `foto_${String(i+1).padStart(2,'0')}.jpg`));

  try{
    const res = await fetch(BACKEND.WEB_APP_URL, { method:'POST', body: form1 });
    if (res.ok) {
      const json = await res.json();
      console.log('[Upload arquivo] resp:', json);
      if (triedFilesCount > 0 && (!Array.isArray(json.files) || json.files.length === 0)) {
        console.warn('Backend respondeu ok, mas sem arquivos. Acionando fallback base64…');
        return await sendAsBase64(payload, coverFile, extraFiles);
      }
      return json;
    }
    console.warn('Upload com arquivos falhou:', res.status, res.statusText);
  } catch(err){
    console.warn('Falha de rede no upload com arquivos:', err);
  }

  if (triedFilesCount === 0) {
    return { ok:false, error:'upload_skipped_no_files' };
  }

  // -------- fallback (base64) --------
  return await sendAsBase64(payload, coverFile, extraFiles);
}

async function sendAsBase64(payload, coverFile, extraFiles){
  try{
    const form2 = new FormData();
    form2.append('secret', BACKEND.SECRET);
    form2.append('id', payload.id);
    form2.append('title', payload.title);
    form2.append('engineer', payload.engineer);
    form2.append('location', payload.location);
    form2.append('startDate', payload.startDate);
    form2.append('endDate', payload.endDate);
    form2.append('status', payload.status);
    form2.append('completion', String(payload.completion));

    if (coverFile) form2.append('cover_b64', await fileToDataURL(coverFile));
    for (let i=0;i<extraFiles.length;i++){
      form2.append(`extra${i}_b64`, await fileToDataURL(extraFiles[i]));
    }

    const res2 = await fetch(BACKEND.WEB_APP_URL, { method:'POST', body: form2 });
    if (res2.ok) {
      const json2 = await res2.json();
      console.log('[Upload base64] resp:', json2);
      return json2;
    }
    console.warn('Fallback base64 falhou:', res2.status, res2.statusText);
    return { ok:false, error:`backend_failed_${res2.status}` };
  }catch(err2){
    console.error('Erro no fallback base64:', err2);
    return { ok:false, error:String(err2) };
  }
}

/* ---------- Submit ---------- */
$('#workForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f = e.currentTarget;

  const payload = {
    id: state.editingId || ('obra-'+Math.random().toString(36).slice(2,8)),
    title: f.title.value.trim(),
    engineer: f.engineer.value.trim(),
    location: f.location.value.trim(),
    startDate: f.startDate.value,
    endDate: f.endDate.value,
    status: f.status.value,
    completion: Math.max(0, Math.min(100, Number(f.completion.value)||0)),
    photos: []
  };

  const extrasFiles = [...f.extraFiles.files];
  let coverFileToSend = null;

  if(!state.editingId){
    if(f.coverFile.files.length){
      coverFileToSend = f.coverFile.files[0];
      const coverThumb = await shrinkImage(coverFileToSend);
      payload.cover = coverThumb || '';
      payload.photos.push({ src: coverThumb || '', alt: payload.title+' (capa)', takenAt:new Date().toISOString() });
    } else {
      alert('Selecione a foto principal.');
      return;
    }
  } else {
    if (f.coverFile.files.length) coverFileToSend = f.coverFile.files[0];
    const it = state.items.find(x=>x.id===state.editingId);
    if(it){ payload.cover = it.cover||''; payload.photos = (it.photos||[]).slice(); }
  }

  for (const file of extrasFiles){
    const thumb = await shrinkImage(file);
    payload.photos.push({ src: thumb || '', alt: payload.title, takenAt:new Date().toISOString() });
  }
  payload.photos.sort(byPhotoDateDesc);

  // Atualiza UI + cache leve
  const idx = state.items.findIndex(x=>x.id===payload.id);
  if(idx>=0) state.items[idx] = {...state.items[idx], ...payload};
  else       state.items.push(payload);

  normalize();
  safeSaveLocal(state.items);
  closeModal();
  render();

  // Envia ao backend
  try{
    const result = await sendToBackend(payload, coverFileToSend, extrasFiles);
    if (result?.ok) {
      console.log('Backend OK:', result);
    } else if (!result?.skipped) {
      console.warn('Backend retornou erro:', result);
      alert('Obra salva localmente. Não foi possível enviar ao Drive agora (veja o console).');
    }
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
$('#btnTop').addEventListener('click',()=>window.scrollTo({ top:0, behavior:'smooth' }));

document.addEventListener('click',(e)=>{
  if(e.target.id==='lightbox' || e.target.id==='modal'){
    closeLightbox();
    closeModal();
    window.scrollTo({ top:0, behavior:'smooth' });
  }
});
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){ closeLightbox(); closeModal(); }
  if(!$('#lightbox').hidden){
    if(e.key==='ArrowRight') navLightbox(1);
    if(e.key==='ArrowLeft')  navLightbox(-1);
  }
});

/* --------- bootstrap ---------- */
loadInitial();
