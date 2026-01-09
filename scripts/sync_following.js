// 同步“特别关注”分组，改为纯 API 请求方式，避免页面导航导致 ERR_CONNECTION_RESET
// 说明：使用 Playwright 的 APIRequestContext 直接发起 HTTP 请求，携带 Cookie 与常见 UA/Referer 头部

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
  const cfgPath = path.join(process.cwd(), 'config.yml');
  const cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.xueqiu ||= {}; cfg.xueqiu.target_users ||= []; cfg.xueqiu.sync_following ??= true; cfg.xueqiu.only_special ??= true;
  if(!cfg.xueqiu.sync_following){ console.log('[sync_following] 配置关闭同步'); return; }
  if(!COOKIE || !COOKIE.includes('xq_a_token=')){
    console.log('[sync_following] 无有效 Cookie，跳过');
    return;
  }

  const ctx = await request.newContext({ baseURL: 'https://xueqiu.com', extraHTTPHeaders: buildHeaders(COOKIE) });
  try{
    // 1) 读取分组列表（特别关注分组）
    // 该端点在不同账号下返回结构可能差异，做容错处理
    let users = [];
    try{
      const groups = await fetchJson(ctx, '/friendships/groups.json');
      if(groups && Array.isArray(groups.groups)){
        for(const g of groups.groups){
          const isSpecial = (g.name||'').includes('特别关注') || (g.name||'').includes('special');
          if(!isSpecial) continue;
          // 有的结构里包含用户数组；有的需要单独请求分组成员
          if(Array.isArray(g.users)){
            for(const u of g.users){ users.push({ id: Number(u.id || u.user_id || u.uid), name: u.screen_name || u.name || '' }); }
          } else if(g.id){
            try{
              const detail = await fetchJson(ctx, `/friendships/groups/members.json?gid=${g.id}`);
              (detail.users||[]).forEach(u=> users.push({ id: Number(u.id||u.uid), name: u.screen_name||u.name||'' }));
            }catch(e){ /* ignore group members failure */ }
          }
        }
      }
    }catch(e){ console.log('[sync_following] groups.json 获取失败：', e.message); }

    // 2) 若依然为空，尝试关注列表接口（分页）并过滤“特别关注”标记
    if(users.length===0){
      try{
        const list = await fetchJson(ctx, '/friendships/groups/members.json'); // 有些账号该端点返回默认分组成员
        (list.users||[]).forEach(u=> users.push({ id: Number(u.id||u.uid), name: u.screen_name||u.name||'' }));
      }catch(e){ /* ignore */ }
    }

    // 去重与清洗
    const uniq = []; const seen = new Set();
    for(const u of users){ const id = Number(u.id); if(!id||seen.has(id)) continue; seen.add(id); uniq.push({ id, name: u.name||String(id) }); }

    if(uniq.length){
      cfg.xueqiu.target_users = uniq;
      fs.writeFileSync(cfgPath, yaml.stringify(cfg));
      console.log(`[sync_following] 同步完成：${uniq.length} 人`);
    } else {
      console.log('[sync_following] 未获取到分组成员，可能接口受限或需要进一步适配');
    }
  } finally {
    await ctx.dispose();
  }
}

main().catch(e=>{ console.error(e); process.exit(0); });
