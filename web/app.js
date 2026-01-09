// 简单前端：根据当前页面选择不同视图渲染
(async function(){
  const page = location.pathname.split('/').pop();
  const data = await (await fetch('./data/index.json')).json();
  const el = document.getElementById('content');
  function card(item){
    const div = document.createElement('div'); div.className='card';
    const meta = `${item.user_name} · ${new Date(item.created_at).toLocaleString()} · ${item.type}`;
    div.innerHTML = `<div class="meta">${meta}</div><div>${item.text||item.title||''}</div><div><a target="_blank" href="${item.url}">查看原帖</a></div>`;
    return div;
  }
  if(page==='index.html'){ (data.timeline||[]).forEach(i=> el.appendChild(card(i))); }
  else if(page==='users.html'){
    const users = Object.keys(data.byUser||{});
    users.forEach(uid=>{ const h = document.createElement('h3'); h.textContent=uid; el.appendChild(h);
      (data.byUser[uid]||[]).forEach(i=> el.appendChild(card(i))); });
  } else if(page==='tickers.html'){
    const tks = Object.keys(data.byTicker||{});
    tks.forEach(t=>{ const h = document.createElement('h3'); h.textContent=t; el.appendChild(h);
      (data.byTicker[t]||[]).forEach(i=> el.appendChild(card(i))); });
  } else { (data.timeline||[]).forEach(i=> el.appendChild(card(i))); }
})();
