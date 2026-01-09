// app.js: fix image handling for xqimg.imedao.com
// - Inline thumbnail uses !thumb.jpg
// - Lightbox shows !raw.jpg (full size), not base jpg
// - Keep nickname overrides working

(async function(){
  const $ = sel => document.querySelector(sel);

  // Load data
  const dataResp = await fetch('./data/index.json');
  const data = await dataResp.json();
  const byUser = data.byUser||{}; const byTicker = data.byTicker||{}; const timeline = data.timeline||[];

  // Build timestamp from build.json
  let deployedAt = null;
  try { const build = await (await fetch('./build.json')).json(); if(build && build.deployedAt) deployedAt = new Date(build.deployedAt); } catch {}
  if (!deployedAt) {
    const latest = timeline.reduce((max,i)=>{ const t=new Date(i.created_at).getTime(); return isNaN(t)?max:Math.max(max,t); },0);
    deployedAt = latest ? new Date(latest) : new Date();
  }
  const inline = $('#lastUpdateInline');
  if (inline) inline.textContent = `更新时间：${ deployedAt.toLocaleString() }`;

  // Nickname overrides
  let overrides = {};
  try { overrides = await (await fetch('./nicknames.json')).json(); } catch {}
  // Built-in defaults (user provided)
  const defaultOverrides = {
    "1936609590": "逸修1",
    "3350642636": "亲爱的阿兰",
    "7708198303": "星辰大海的边界"
  };
  overrides = { ...defaultOverrides, ...overrides };

  // id -> name map
  const idName = new Map();
  Object.keys(byUser).forEach(id => { const arr=byUser[id]; const nm=arr&&arr[0]&&arr[0].user_name?arr[0].user_name:null; if(nm) idName.set(Number(id), nm); });
  timeline.forEach(it => { if(it.user_id && it.user_name && !idName.has(it.user_id)) idName.set(it.user_id, it.user_name); });
  Object.keys(overrides).forEach(k => { const uid=Number(k); const nm=overrides[k]; if(nm && nm.trim()) idName.set(uid, nm.trim()); });
  const nameOf = uid => { const nm=idName.get(uid); return (nm&&nm.trim())? nm : `用户${uid}`; };

  // Sidebar
  const userList = $('#userList');
  const userTpl = document.getElementById('userItemTpl');
  const users = Object.keys(byUser).map(id => ({ id:Number(id), name:nameOf(Number(id)) }))
                    .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  userList.innerHTML='';
  users.forEach(u => { const node=userTpl.content.cloneNode(true); const a=node.querySelector('.nick'); a.textContent=u.name; a.href=`https://xueqiu.com/u/${u.id}`; a.addEventListener('click', e=>{ e.preventDefault(); render({ userId:u.id }); }); userList.appendChild(node); });

  // Tickers
  const tickerSelect = $('#tickerSelect');
  const tickers = Object.keys(byTicker).sort();
  tickerSelect.innerHTML = '<option value="all">全部标的</option>' + tickers.map(t=>`<option value="${t}">${t}</option>`).join('');

  // Read/unread
  const storeKey='xq_read_hashes';
  const getRead = () => new Set(JSON.parse(localStorage.getItem(storeKey)||'[]'));
  const setRead = s => localStorage.setItem(storeKey, JSON.stringify(Array.from(s)));

  // Image URL helpers for imedao
  function getThumbAndRaw(u){
    try {
      const url = new URL(u);
      const isImedao = url.hostname.includes('xqimg.imedao.com');
      if(!isImedao) return { thumb:u, raw:u };
      // Strip any existing !suffix
      const path = url.pathname;
      const excl = path.indexOf('!');
      const base = excl>0 ? path.slice(0, excl) : path;
      const raw = `${base}!raw.jpg`;
      const thumb = `${base}!thumb.jpg`;
      url.pathname = thumb; const thumbFull = url.toString();
      const rawUrl = new URL(url); rawUrl.pathname = raw; const rawFull = rawUrl.toString();
      return { thumb: thumbFull, raw: rawFull };
    } catch {
      // Fallback simple regex
      const base = u.replace(/!(?:thumb|raw|large|\w+)(?:\.\w+)?$/, '');
      return { thumb: `${base}!thumb.jpg`, raw: `${base}!raw.jpg` };
    }
  }

  function extractImages(text){
    if(!text) return [];
    const urls=[]; const re=/(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png)(?:![\w.]+)?)/gi; let m; while((m=re.exec(text))){ urls.push(m[1]); }
    return Array.from(new Set(urls));
  }

  // Lightbox
  const lightbox = $('#lightbox');
  const lightboxContent = $('#lightboxContent');
  const closeLightbox = () => { lightbox.classList.remove('active'); lightboxContent.innerHTML=''; currentImgs=[]; curIdx=0; };
  $('#lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e=>{ if(e.target===lightbox) closeLightbox(); });
  let currentImgs = []; let curIdx = 0;
  function showImg(idx){ lightboxContent.innerHTML = `<img src="${currentImgs[idx]}" alt="image">`; }
  function openLightbox(imgs){ currentImgs=imgs; curIdx=0; showImg(0); lightbox.classList.add('active'); }
  document.addEventListener('keydown', e=>{
    if(!lightbox.classList.contains('active')) return;
    if(e.key==='Escape') return closeLightbox();
    if(e.key==='ArrowRight'){ curIdx=(curIdx+1)%currentImgs.length; showImg(curIdx); }
    if(e.key==='ArrowLeft'){ curIdx=(curIdx-1+currentImgs.length)%currentImgs.length; showImg(curIdx); }
  });

  function render({ userId=null }={}){
    const kw = ($('#kw').value||'').trim().toLowerCase();
    const tSel = $('#tickerSelect').value||'all';
    const dSel = $('#dateSelect').value||'all';
    const now = Date.now();
    const inRange = t => { if(dSel==='all') return true; const ts=new Date(t.created_at).getTime(); const day=86400000; if(dSel==='1d') return (now-ts)<=day; if(dSel==='7d') return (now-ts)<=day*7; if(dSel==='30d') return (now-ts)<=day*30; return true; };
    const list = (userId? (byUser[userId]||[]) : timeline)
      .filter(i => (tSel==='all' || (i.tickers||[]).includes(tSel)))
      .filter(i => inRange(i))
      .filter(i => !kw || ((i.text||'').toLowerCase().includes(kw) || (i.title||'').toLowerCase().includes(kw) || nameOf(i.user_id).toLowerCase().includes(kw)))
      .sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));

    const tl = $('#timeline'); tl.innerHTML='';
    const tpl = document.getElementById('cardTpl');
    const read = getRead();
    list.forEach(item => {
      const node = tpl.content.cloneNode(true);
      const art = node.querySelector('.card');
      const nick = node.querySelector('.nick'); nick.textContent = nameOf(item.user_id); nick.href = `https://xueqiu.com/u/${item.user_id}`;
      node.querySelector('.time').textContent = new Date(item.created_at).toLocaleString();

      const body = node.querySelector('.card-body');
      body.innerHTML = (item.text||item.title||'');
      const urls = extractImages(body.innerText || body.innerHTML);
      if(urls.length){
        const rawList = []; // For lightbox
        urls.forEach(u=>{ const pair = getThumbAndRaw(u); rawList.push(pair.raw); const img=document.createElement('img'); img.className='inline-img'; img.src=pair.thumb; img.addEventListener('click', ()=> openLightbox(rawList)); body.appendChild(img); });
      }

      const origin = node.querySelector('.origin'); origin.href = item.url||`https://xueqiu.com/u/${item.user_id}`;
      const readComments = node.querySelector('.read-comments'); readComments.href = (item.url||`https://xueqiu.com/u/${item.user_id}`);

      const counts = node.querySelector('.counts'); const cc=Number(item.comments_count||0), lc=Number(item.likes_count||0); if(cc+lc>0){ counts.innerHTML = `<span class="icon">💬 ${cc}</span><span class="icon">👍 ${lc}</span>`; }

      const isRead = read.has(item.hash); art.classList.add(isRead? 'read' : 'unread');
      art.addEventListener('click', (e)=>{ if(!(e.target.closest('a')||e.target.closest('img.inline-img'))){ const s=getRead(); s.add(item.hash); setRead(s); art.classList.remove('unread'); art.classList.add('read'); } });
      origin.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });
      readComments.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });

      tl.appendChild(node);
    });
  }

  $('#tickerSelect').addEventListener('change', ()=> render({}));
  $('#dateSelect').addEventListener('change', ()=> render({}));
  $('#kw').addEventListener('input', ()=> render({}));

  render({});
})();
