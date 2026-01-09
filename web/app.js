// 调整前端逻辑：移除清除按钮与“标记已读”按钮；
// Gmail风格：未读项加粗，点击卡片或“查看原帖”后即标记为已读。

(async function(){
  const $ = sel => document.querySelector(sel);
  const data = await (await fetch('./data/index.json')).json();
  const byUser = data.byUser||{}; const byTicker = data.byTicker||{}; const timeline = data.timeline||[];

  // 构建用户侧栏
  const userList = $('#userList');
  const userTpl = document.getElementById('userItemTpl');
  const users = Object.keys(byUser).map(id => ({ id: Number(id), name: (byUser[id][0]?.user_name)||String(id) }))
                              .sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  users.forEach(u => {
    const node = userTpl.content.cloneNode(true);
    const a = node.querySelector('.nick');
    a.textContent = u.name; a.href = `https://xueqiu.com/u/${u.id}`;
    a.addEventListener('click', e => { e.preventDefault(); render({ userId: u.id }); });
    userList.appendChild(node);
  });

  // 构建标的下拉
  const tickerSelect = $('#tickerSelect');
  const tickers = Object.keys(byTicker).sort();
  tickerSelect.innerHTML = '<option value="all">全部标的</option>' + tickers.map(t=>`<option value="${t}">${t}</option>`).join('');

  // 读/未读本地存储
  const storeKey = 'xq_read_hashes';
  const getRead = () => new Set(JSON.parse(localStorage.getItem(storeKey)||'[]'));
  const setRead = s => localStorage.setItem(storeKey, JSON.stringify(Array.from(s)));

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
      const nick = node.querySelector('.nick'); nick.textContent = item.user_name||String(item.user_id); nick.href = `https://xueqiu.com/u/${item.user_id}`;
      node.querySelector('.time').textContent = new Date(item.created_at).toLocaleString();
      node.querySelector('.type').textContent = item.type;
      node.querySelector('.card-body').textContent = item.text||item.title||'';
      const origin = node.querySelector('.origin'); origin.href = item.url||`https://xueqiu.com/u/${item.user_id}`;

      const isRead = read.has(item.hash);
      art.classList.add(isRead? 'read' : 'unread');

      // 点击卡片或原帖链接即标记已读
      art.addEventListener('click', (e)=>{
        // 避免点击昵称跳转导致阻塞：仅当点击区域不是链接时标记
        if(!(e.target.closest('a'))){ const s=getRead(); s.add(item.hash); setRead(s); art.classList.remove('unread'); art.classList.add('read'); }
      });
      origin.addEventListener('click', ()=>{ const s=getRead(); s.add(item.hash); setRead(s); });

      tl.appendChild(node);
    });
  }

  // 交互事件
  $('#tickerSelect').addEventListener('change', ()=> render({}));
  $('#dateSelect').addEventListener('change', ()=> render({}));
  $('#kw').addEventListener('input', ()=> render({}));

  // 初始渲染
  render({});
})();
