// 增强前端：
// - 左侧与时间线统一显示“雪球昵称”（从数据中的 user_name 推断；若缺失，用 id 占位）
// - 文本里解析图片链接，显示“图片(n)”并浮窗预览
// - 阅读评论按钮直链到雪球原帖（item.url）

(async function(){
  const $ = sel => document.querySelector(sel);
  const data = await (await fetch('./data/index.json')).json();
  const byUser = data.byUser||{}; const byTicker = data.byTicker||{}; const timeline = data.timeline||[];

  // 建立 id->昵称 映射（优先按用户聚合中的首条，再回退到时间线中的匹配项）
  const idName = new Map();
  Object.keys(byUser).forEach(id => {
    const arr = byUser[id];
    const nm = (arr && arr[0] && arr[0].user_name) ? arr[0].user_name : String(id);
    idName.set(Number(id), nm);
  });
  timeline.forEach(it => {
    if(it.user_id && it.user_name && !idName.has(it.user_id)) idName.set(it.user_id, it.user_name);
  });

  // 侧栏用户（显示昵称并链接到雪球主页）
  const userList = $('#userList');
  const userTpl = document.getElementById('userItemTpl');
  const users = Object.keys(byUser).map(id => ({ id: Number(id), name: idName.get(Number(id)) || String(id) }))
                              .sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  users.forEach(u => {
    const node = userTpl.content.cloneNode(true);
    const a = node.querySelector('.nick');
    a.textContent = u.name; a.href = `https://xueqiu.com/u/${u.id}`;
    a.addEventListener('click', e => { e.preventDefault(); render({ userId: u.id }); });
    userList.appendChild(node);
  });

  // 标的下拉
  const tickerSelect = $('#tickerSelect');
  const tickers = Object.keys(byTicker).sort();
  tickerSelect.innerHTML = '<option value="all">全部标的</option>' + tickers.map(t=>`<option value="${t}">${t}</option>`).join('');

  // 读/未读存储（Gmail风格）
  const storeKey = 'xq_read_hashes';
  const getRead = () => new Set(JSON.parse(localStorage.getItem(storeKey)||'[]'));
  const setRead = s => localStorage.setItem(storeKey, JSON.stringify(Array.from(s)));

  // 文本中的图片链接解析（支持 xqimg.imedao.com 与常见 jpg/png/jpeg，含 !thumb 后缀）
  function extractImages(text){
    if(!text) return [];
    const urls = [];
    const re = /(https?:\/\/[\w.-]+\/(?:[\w\/-]+)\.(?:jpg|jpeg|png)(?:![\w.]+)?)/gi;
    let m; while((m = re.exec(text))){ urls.push(m[1]); }
    // 去重
    return Array.from(new Set(urls));
  }

  // 图片浮窗
  const lightbox = $('#lightbox');
  const lightboxContent = $('#lightboxContent');
  $('#lightboxClose').addEventListener('click', ()=>{ lightbox.classList.remove('active'); lightboxContent.innerHTML=''; });
  lightbox.addEventListener('click', (e)=>{ if(e.target===lightbox) { lightbox.classList.remove('active'); lightboxContent.innerHTML=''; } });
  function openLightbox(imgs){
    lightboxContent.innerHTML = imgs.map(u=>`<img src="${u}" alt="image"/>`).join('');
    lightbox.classList.add('active');
  }

  // 渲染时间线
  function render({ userId=null }={}){
    const kw = ($('#kw').value||'').trim().toLowerCase();
    const tSel = $('#tickerSelect').value||'all';
    const dSel = $('#dateSelect').value||'all';
    const now = Date.now();
    const inRange = t => {
      if(dSel==='all') return true;
      const ts = new Date(t.created_at).getTime();
      const day = 86400000;
      if(dSel==='1d') return (now - ts) <= day;
      if(dSel==='7d') return (now - ts) <= day*7;
      if(dSel==='30d') return (now - ts) <= day*30;
      return true;
    };
    const list = (userId? (byUser[userId]||[]) : timeline)
      .filter(i => (tSel==='all' || (i.tickers||[]).includes(tSel)))
      .filter(i => inRange(i))
      .filter(i => !kw || ((i.text||'').toLowerCase().includes(kw) || (i.title||'').toLowerCase().includes(kw) || (i.user_name||'').toLowerCase().includes(kw)) )
      .sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));

    const tl = $('#timeline'); tl.innerHTML = '';
    const tpl = document.getElementById('cardTpl');
    const read = getRead();
    list.forEach(item => {
      const node = tpl.content.cloneNode(true);
      const art = node.querySelector('.card');
      const nick = node.querySelector('.nick');
      const name = item.user_name || idName.get(item.user_id) || String(item.user_id);
      nick.textContent = name; nick.href = `https://xueqiu.com/u/${item.user_id}`;
      node.querySelector('.time').textContent = new Date(item.created_at).toLocaleString();
      node.querySelector('.type').textContent = item.type;
      node.querySelector('.card-body').innerHTML = (item.text||item.title||'');

      const origin = node.querySelector('.origin'); origin.href = item.url||`https://xueqiu.com/u/${item.user_id}`;
      const readComments = node.querySelector('.read-comments'); readComments.href = (item.url||`https://xueqiu.com/u/${item.user_id}`);

      // 图片
      const imgs = extractImages(item.text||item.title||'');
      const imgBtn = node.querySelector('.img-count');
      if(imgs.length){
        imgBtn.style.display = 'inline-block';
        imgBtn.textContent = `图片(${imgs.length})`;
        imgBtn.addEventListener('click', ()=> openLightbox(imgs));
      }

      const isRead = read.has(item.hash);
      art.classList.add(isRead? 'read' : 'unread');
      art.addEventListener('click', (e)=>{
        if(!(e.target.closest('a'))){ const s=getRead(); s.add(item.hash); setRead(s); art.classList.remove('unread'); art.classList.add('read'); }
      });
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
