// JS：进一步对齐雪球样式；
// - 图片浮窗支持左右切换与缩放、Esc关闭
// - counts 区域显示评论与点赞（有数据时）
// - 统一昵称显示（优先 user_name，否则“用户+ID”）

(async function(){
  const $ = sel => document.querySelector(sel);
  const dataResp = await fetch('./data/index.json');
  const data = await dataResp.json();
  const byUser = data.byUser||{}; const byTicker = data.byTicker||{}; const timeline = data.timeline||[];

  // 更新时间
  const latest = timeline.reduce((max,i)=>{ const t=new Date(i.created_at).getTime(); return isNaN(t)?max:Math.max(max,t); },0);
  $('#lastUpdate').textContent = `更新时间：${ (latest? new Date(latest): new Date()).toLocaleString() }`;

  // id->昵称 映射
  const idName = new Map();
  Object.keys(byUser).forEach(id => { const arr=byUser[id]; const nm=arr&&arr[0]&&arr[0].user_name?arr[0].user_name:null; if(nm) idName.set(Number(id), nm); });
  timeline.forEach(it => { if(it.user_id && it.user_name && !idName.has(it.user_id)) idName.set(it.user_id, it.user_name); });
  const nameOf = uid => { const nm=idName.get(uid); return (nm&&nm.trim())? nm : `用户${uid}`; };

  // 侧栏用户
  const userList = $('#userList');
  const userTpl = document.getElementById('userItemTpl');
  const users = Object.keys(byUser).map(id => ({ id:Number(id), name:nameOf(Number(id)) }))
                    .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  userList.innerHTML='';
  users.forEach(u => { const node=userTpl.content.cloneNode(true); const a=node.querySelector('.nick'); a.textContent=u.name; a.href=`https://xueqiu.com/u/${u.id}`; a.addEventListener('click', e=>{ e.preventDefault(); render({ userId:u.id }); }); userList.appendChild(node); });

  // 标的下拉
  const tickerSelect = $('#tickerSelect');
  const tickers = Object.keys(byTicker).sort();
  tickerSelect.innerHTML = '<option value="all">全部标的</option>' + tickers.map(t=>`<option value="${t}">${t}</option>`).join('');

  // 读/未读
  const storeKey='xq_read_hashes';
  const getRead = () => new Set(JSON.parse(localStorage.getItem(storeKey)||'[]'));
  const setRead = s => localStorage.setItem(storeKey, JSON.stringify(Array.from(s)));

  // 图片浮窗
  const lightbox = $('#lightbox');
  const lightboxContent = $('#lightboxContent');
  const closeLightbox = () => { lightbox.classList.remove('active'); lightboxContent.innerHTML=''; currentImgs=[]; curIdx=0; };
  $('#lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e=>{ if(e.target===lightbox) closeLightbox(); });
  let currentImgs = []; let curIdx = 0;
  function showImg(idx){
    lightboxContent.innerHTML = `<img src="${currentImgs[idx]}" alt="image">`;
  }
  function openLightbox(imgs){ currentImgs=imgs; curIdx=0; showImg(0); lightbox.classList.add('active'); }
  document.addEventListener('keydown', e=>{
    if(!lightbox.classList.contains('active')) return;
    if(e.key==='Escape') return closeLightbox();
    if(e.key==='ArrowRight'){ curIdx=(curIdx+1)%currentImgs.length; showImg(curIdx); }
    if(e.key==='ArrowLeft'){ curIdx=(curIdx-1+currentImgs.length)%currentImgs.length; showImg(curIdx); }
    if(e.key==='+'){ const img=lightboxContent.querySelector('img'); if(img){ img.classList.toggle('zoom'); } }
  });

  // 提取图片链接
  function extractImages(text){
    if(!text) return [];
    const urls=[]; const re=/(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png)(?:![\w.]+)?)/gi; let m; while((m=re.exec(text))){ urls.push(m[1]); }
    return Array.from(new Set(urls));
  }

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
      node.querySelector('.card-body').innerHTML = (item.text||item.title||'');
      const origin = node.querySelector('.origin'); origin.href = item.url||`https://xueqiu.com/u/${item.user_id}`;
      const readComments = node.querySelector('.read-comments'); readComments.href = (item.url||`https://xueqiu.com/u/${item.user_id}`);

      // 图片按钮
      const imgs = extractImages(item.text||item.title||'');
      const imgBtn = node.querySelector('.img-count');
      if(imgs.length){ imgBtn.style.display='inline-block'; imgBtn.textContent='图片'; imgBtn.addEventListener('click', ()=> openLightbox(imgs)); }

      // 评论/点赞计数（靠近雪球行内样式）
      const counts = node.querySelector('.counts');
      const cc = Number(item.comments_count||0); const lc = Number(item.likes_count||0);
      if(cc+lc>0){ counts.innerHTML = `<span class="icon">💬 ${cc}</span><span class="icon">👍 ${lc}</span>`; }

      // 读/未读切换
      const isRead = read.has(item.hash);
      art.classList.add(isRead? 'read' : 'unread');
      art.addEventListener('click', (e)=>{ if(!(e.target.closest('a'))){ const s=getRead(); s.add(item.hash); setRead(s); art.classList.remove('unread'); art.classList.add('read'); } });
      origin.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });
      readComments.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });

      tl.appendChild(node);
    });
  }

  // 交互事件
  $('#tickerSelect').addEventListener('change', ()=> render({}));
  $('#dateSelect').addEventListener('change', ()=> render({}));
  $('#kw').addEventListener('input', ()=> render({}));

  render({});
})();
