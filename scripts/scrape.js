// 抓取时间线改为纯 API 请求优先，避免页面导航导致 ERR_CONNECTION_RESET。
// 使用 Playwright APIRequestContext，设置 UA/Referer/Cookie 头，并加入重试与退避。

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { request } from 'playwright';

function buildHeaders(cookie){
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://xueqiu.com/',
    'Cookie': cookie,
  };
}

function toISOZ(ts){
  try { const d = new Date(ts); if(!isNaN(d.getTime())) return d.toISOString(); } catch {};
  return new Date().toISOString();
}

function extractSymbolsFromText(txt){
  const tickers = new Set(); const symbols_meta = [];
  (txt.match(/\$[A-Z]{1,6}/g) || []).forEach(raw => { tickers.add(raw.slice(1)); symbols_meta.push({ raw, market:'US' }); });
  (txt.match(/S[HZ]\d{6}/g) || []).forEach(raw => { tickers.add(raw); symbols_meta.push({ raw, market:'CN' }); });
  (txt.match(/HK\d{5}/g) || []).forEach(raw => { tickers.add(raw); symbols_meta.push({ raw, market:'HK' }); });
  (txt.match(/\b0\d{4}\b/g) || []).forEach(num => { const raw = `HK${num}`; tickers.add(raw); symbols_meta.push({ raw, market:'HK' }); });
  return { tickers: Array.from(tickers), symbols_meta };
}

async function fetchJson(ctx, url, retries=3){
  let lastErr = null;
  for(let i=0;i<retries;i++){
    try{
      const res = await ctx.get(url, { timeout: 15000 });
      if(res.ok()) return await res.json();
      lastErr = new Error('HTTP '+res.status());
    }catch(e){ lastErr = e; }
    await new Promise(r=>setTimeout(r, 1000*(i+1)));
  }
  throw lastErr || new Error('fetchJson failed');
}

async function main(){
  const COOKIE = process.env.XUEQIU_COOKIE || '';
  const cfg = yaml.parse(fs.readFileSync(path.join(process.cwd(), 'config.yml'), 'utf8'));
  let users = cfg?.xueqiu?.target_users || [];
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const hour = new Date().toISOString().slice(0,13);
  const snap = path.join(dataDir, `${hour}.json`);

  const ctx = await request.newContext({ baseURL: 'https://xueqiu.com', extraHTTPHeaders: buildHeaders(COOKIE) });
  const all = [];
  try{
    // 若 users 为空，尝试读取分组作为兜底（不强制，仅尽力）
    if(!users.length){
      try{
        const groups = await fetchJson(ctx, '/friendships/groups.json');
        if(groups && Array.isArray(groups.groups)){
          for(const g of groups.groups){
            const isSpecial = (g.name||'').includes('特别关注');
            if(!isSpecial) continue;
            (g.users||[]).forEach(u=> users.push({ id: Number(u.id||u.user_id||u.uid), name: u.screen_name||u.name||'' }));
          }
        }
      }catch(e){ /* ignore */ }
    }

    for(const u of users){
      try{
        // 时间线接口：有的账号 page=1 能拿到最近数据
        const data = await fetchJson(ctx, `/statuses/user_timeline.json?user_id=${u.id}&page=1`);
        const list = (data && (data.statuses || data.list || data)) || [];
        list.forEach((it, idx)=>{
          const url = it.target ? `https://xueqiu.com/${it.target}` : (it.url || '');
          const text = it.text || it.description || '';
          const created = it.created_at || it.createdAt || Date.now();
          const type = it.type || (url.includes('/article/') ? 'article':'post');
          const { tickers, symbols_meta } = extractSymbolsFromText(text + ' ' + (it.title||''));
          all.push({
            id: `post_${it.id || (Date.now()+idx)}`, user_id: u.id, user_name: u.name || String(u.id),
            type, created_at: toISOZ(created), url, title: it.title || '', text,
            comments_count: it.comments_count || 0, likes_count: it.likes || it.like_count || 0,
            tickers, symbols_meta, hash: `sha1_${u.id}_${it.id || idx}_${toISOZ(created)}_${type}`
          });
        });
        await new Promise(r=>setTimeout(r, 1000));
      }catch(e){ console.log('[scrape] 用户接口失败', u.id, e.message); }
    }
  } finally {
    await ctx.dispose();
  }

  if(all.length === 0){
    all.push({ id:'post_demo', user_id:1000, user_name:'示例', type:'post', created_at:new Date().toISOString(), url:'https://xueqiu.com', title:'', text:'占位：未抓到数据', tickers:[], symbols_meta:[], comments_count:0, likes_count:0, hash:'demo' });
  }
  fs.writeFileSync(snap, JSON.stringify(all, null, 2));
  console.log('[scrape] 写入快照', snap, '数量', all.length);
}

main().catch(e=>{ console.error(e); process.exit(0); });
