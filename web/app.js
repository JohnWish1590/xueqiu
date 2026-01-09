// app.js：时间线默认显示（所有用户），修复昵称与原图浮窗逻辑（强制 raw），并支持移动端顶部选择
(async function(){
  const $ = (sel)=>document.querySelector(sel);

  // 读取数据（禁止缓存，确保最新）
  const ts = Date.now();
  const dataResp = await fetch(`./data/index.json?v=${ts}`);
  const data = await dataResp.json();
  const byUser = data.byUser||{};
  const byTicker = data.byTicker||{};
  const timeline = data.timeline||[];

  // 更新时间（优先 build.json）
  let deployedAt = null;
  try { const build = await (await fetch(`./build.json?v=${ts}`)).json(); if(build && build.deployedAt) deployedAt = new Date(build.deployedAt); } catch{}
  if(!deployedAt){ const latest = timeline.reduce((m,i)=>{ const t=new Date(i.created_at).getTime(); return isNaN(t)?m:Math.max(m,t); },0); deployedAt = latest? new Date(latest): new Date(); }
  const inline = $('#lastUpdateInline'); if(inline) inline.textContent = `更新时间：${deployedAt.toLocaleString()}`;

  // 覆盖昵称（先用前端，再补数据，避免回退数字）
  let overrides = {};
  try { overrides = await (await fetch(`./nicknames.json?v=${ts}`)).json(); } catch{}
  const defaultOverrides = { "1936609590":"逸修1", "3350642636":"亲爱的阿兰", "7708198303":"星辰大海的边界" };
  overrides = { ...defaultOverrides, ...overrides };

  const idName = new Map();
  Object.keys(overrides).forEach(k=>{ const uid=Number(k); const nm=String(overrides[k]||'').trim(); if(nm) idName.set(uid, nm); });
  Object.keys(byUser).forEach(k=>{ const uid=Number(k); const arr=byUser[k]; const nm=arr && arr[0] && arr[0].user_name ? String(arr[0].user_name).trim(): ''; if(nm && !idName.has(uid)) idName.set(uid, nm); });
  timeline.forEach(it=>{ const uid=Number(it.user_id); const nm=it.user_name? String(it.user_name).trim(): ''; if(nm && !idName.has(uid)) idName.set(uid, nm); });
  const nameOf = (uid)=>{ const nm=idName.get(Number(uid)); return nm && nm.trim()? nm : `用户${uid}`; };

  // 顶部选择器与侧栏
  const userList = $('#userList');
  const userTpl = document.getElementById('userItemTpl');
  const users = Object.keys(byUser).map(k=>({ id:Number(k), name:nameOf(Number(k)) }))
                    .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(userList){ userList.innerHTML=''; users.forEach(u=>{ const node=userTpl.content.cloneNode(true); const a=node.querySelector('.nick'); a.textContent=u.name; a.href=`https://xueqiu.com/u/${u.id}`; a.addEventListener('click', e=>{ e.preventDefault(); render({ userId:u.id }); }); userList.appendChild(node); }); }
  const userSelect = $('#userSelect');
  if(userSelect){ userSelect.innerHTML = '<option value="all">全部用户</option>' + users.map(u=>`<option value="${u.id}">${u.name}</option>`).join(''); userSelect.addEventListener('change', ()=>{ const val=userSelect.value; render({ userId: val==='all'? null : Number(val)}); }); }

  // 时间线按钮：一键切回“所有用户”
  const timelineBtn = $('#timelineBtn');
  if(timelineBtn){ timelineBtn.addEventListener('click', ()=>{ if(userSelect){ userSelect.value='all'; } render({ userId:null }); }); }

  // 标的选择
  const tickers = Object.keys(byTicker).sort();
  const tickerSelect = $('#tickerSelect'); if(tickerSelect){ tickerSelect.innerHTML = '<option value="all">全部标的</option>' + tickers.map(t=>`<option value="${t}">${t}</option>`).join(''); }

  // 读/未读
  const storeKey='xq_read_hashes';
  const getRead = ()=> new Set(JSON.parse(localStorage.getItem(storeKey)||'[]'));
  const setRead = s => localStorage.setItem(storeKey, JSON.stringify(Array.from(s)));

  // imedao 链接：缩略图/原图（强制 raw）
  function getThumbAndRaw(u){
    try{
      const url = new URL(u);
      const isImedao = url.hostname.includes('xqimg.imedao.com');
      if(!isImedao) return { thumb:u, raw:u };
      const path = url.pathname; const excl = path.indexOf('!'); const base = excl>0? path.slice(0,excl): path;
      const thumbUrl = new URL(url); thumbUrl.pathname = `${base}!thumb.jpg`;
      const rawUrl   = new URL(url); rawUrl.pathname   = `${base}!raw.jpg`;
      return { thumb: thumbUrl.toString(), raw: rawUrl.toString() };
    }catch{
      const base = u.replace(/!(?:thumb|raw|large|\w+)(?:\.\w+)?$/, '');
      return { thumb: `${base}!thumb.jpg`, raw: `${base}!raw.jpg` };
    }
  }

  // 收集所有图片链接（正文文本、HTML、锚点、img[src]）
  function extractAllImageLinks(body){
    const urls = new Set();
    const html = body.innerHTML||'';
    const re = /(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png)(?:![\w.]+)?)/gi;
    let m; while((m=re.exec(html))){ urls.add(m[1]); }
    body.querySelectorAll('a').forEach(a=>{ const href=a.getAttribute('href')||''; if(/\.(jpg|jpeg|png)(!\w+\.\w+)?$/i.test(href) || href.includes('xqimg.imedao.com')) urls.add(href); });
    body.querySelectorAll('img').forEach(img=>{ const src=img.getAttribute('src')||''; if(src) urls.add(src); });
    return Array.from(urls);
  }

  // 引用灰底块
  function wrapQuotes(body){ let html = body.innerHTML; html = html.replace(/(回复@[^：<]+：[^
<]*)(<br\s*\/?|$)/g, '<div class="quote">$1</div>$2'); body.innerHTML = html; }

  // 浮窗
  const lightbox = $('#lightbox'); const lightboxContent = $('#lightboxContent');
  const closeLightbox = ()=>{ lightbox.classList.remove('active'); lightboxContent.innerHTML=''; currentImgs=[]; curIdx=0; };
  $('#lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e=>{ if(e.target===lightbox) closeLightbox(); });
  let currentImgs=[]; let curIdx=0; const showImg = (idx)=>{ lightboxContent.innerHTML = `<img src="${currentImgs[idx]}" alt="image">`; };
  const openLightbox = (imgs)=>{ currentImgs=imgs; curIdx=0; showImg(0); lightbox.classList.add('active'); };
  document.addEventListener('keydown', e=>{ if(!lightbox.classList.contains('active')) return; if(e.key==='Escape') return closeLightbox(); if(e.key==='ArrowRight'){ curIdx=(curIdx+1)%currentImgs.length; showImg(curIdx);} if(e.key==='ArrowLeft'){ curIdx=(curIdx-1+currentImgs.length)%currentImgs.length; showImg(curIdx);} });

  function render({ userId=null }={}){
    // 顶部选择优先生效；默认时间线（所有用户）
    const topSel = $('#userSelect'); if(userId===null && topSel && topSel.value && topSel.value!=='all'){ userId = Number(topSel.value); }
    const kw = ($('#kw').value||'').trim().toLowerCase();
    const tSel = $('#tickerSelect')? $('#tickerSelect').value : 'all';
    const dSel = $('#dateSelect')? $('#dateSelect').value : 'all';
    const now = Date.now(); const day=86400000;
    const inRange = t=>{ if(dSel==='all') return true; const ts=new Date(t.created_at).getTime(); if(dSel==='1d') return (now-ts)<=day; if(dSel==='7d') return (now-ts)<=day*7; if(dSel==='30d') return (now-ts)<=day*30; return true; };

    const list = (userId? (byUser[userId]||[]) : timeline)
      .filter(i=> (tSel==='all' || (i.tickers||[]).includes(tSel)))
      .filter(i=> inRange(i))
      .filter(i=> !kw || ((i.text||'').toLowerCase().includes(kw) || (i.title||'').toLowerCase().includes(kw) || nameOf(i.user_id).toLowerCase().includes(kw)))
      .sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));

    const tl = $('#timeline'); tl.innerHTML='';
    const tpl = document.getElementById('cardTpl');
    const read = getRead();

    list.forEach(item=>{
      const node = tpl.content.cloneNode(true);
      const art = node.querySelector('.card');
      const nick=node.querySelector('.nick'); nick.textContent = nameOf(item.user_id); nick.href = `https://xueqiu.com/u/${item.user_id}`;
      node.querySelector('.time').textContent = new Date(item.created_at).toLocaleString();

      const body = node.querySelector('.card-body'); body.innerHTML = (item.text||item.title||'');
      wrapQuotes(body);

      // 收集图片并附加缩略图；点击/链接一律开原图
      const links = extractAllImageLinks(body);
      links.forEach(href=>{ const pair=getThumbAndRaw(href); const img=document.createElement('img'); img.className='inline-img'; img.src=pair.thumb; img.addEventListener('click', ()=> openLightbox([pair.raw])); body.appendChild(img); });
      body.querySelectorAll('a').forEach(a=>{ const href=a.getAttribute('href')||''; if(href.includes('xqimg.imedao.com')){ const pair=getThumbAndRaw(href); a.addEventListener('click', (e)=>{ e.preventDefault(); openLightbox([pair.raw]); }); }});

      const origin=node.querySelector('.origin'); origin.href = item.url||`https://xueqiu.com/u/${item.user_id}`;
      const readComments=node.querySelector('.read-comments'); readComments.href = (item.url||`https://xueqiu.com/u/${item.user_id}`);

      const counts=node.querySelector('.counts'); const cc=Number(item.comments_count||0), lc=Number(item.likes_count||0); if(cc+lc>0){ counts.innerHTML = `<span class="icon">💬 ${cc}</span><span class="icon">👍 ${lc}</span>`; }

      const isRead = read.has(item.hash); art.classList.add(isRead? 'read':'unread');
      art.addEventListener('click', (e)=>{ if(!(e.target.closest('a')||e.target.closest('img.inline-img'))){ const s=getRead(); s.add(item.hash); setRead(s); art.classList.remove('unread'); art.classList.add('read'); } });
      origin.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });
      readComments.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });

      tl.appendChild(node);
    });
  }

  if($('#tickerSelect')) $('#tickerSelect').addEventListener('change', ()=> render({}));
  if($('#dateSelect')) $('#dateSelect').addEventListener('change',  ()=> render({}));
  if($('#kw'))          $('#kw').addEventListener('input',      ()=> render({}));

  // 默认显示：时间线（所有用户）
  render({ userId:null });
})();
