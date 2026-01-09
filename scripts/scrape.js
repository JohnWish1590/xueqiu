// 登录抓取：先尝试站内 JSON 接口（登录态可访问），失败再退回 DOM 解析
// 同时增强标的解析：支持 /S/TSLA、/S/SH601006、/S/03690 链接，以及纯 0xxxx 港股数字规范化为 HK0xxxx

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { chromium } from 'playwright';

function parseCookieString(cookieStr){
  return cookieStr.split(';').map(s => s.trim()).filter(Boolean).map(kv => {
    const idx = kv.indexOf('=');
    return { name: kv.slice(0, idx), value: kv.slice(idx+1) };
  });
}

function toISOZ(ts){
  try { const d = new Date(ts); if(!isNaN(d.getTime())) return d.toISOString(); } catch {};
  return new Date().toISOString();
}

function extractSymbolsFromText(txt){
  const tickers = new Set(); const symbols_meta = [];
  // 美股 $TSLA
  (txt.match(/\$[A-Z]{1,6}/g) || []).forEach(raw => { tickers.add(raw.slice(1)); symbols_meta.push({ raw, market:'US' }); });
  // A股 SH/SZ6位
  (txt.match(/S[HZ]\d{6}/g) || []).forEach(raw => { tickers.add(raw); symbols_meta.push({ raw, market:'CN' }); });
  // 港股 HK5位
  (txt.match(/HK\d{5}/g) || []).forEach(raw => { tickers.add(raw); symbols_meta.push({ raw, market:'HK' }); });
  // 纯 0 开头的 5 位数字（如 03690）归一化为 HK0xxxx
  (txt.match(/\b0\d{4}\b/g) || []).forEach(num => { const raw = `HK${num}`; tickers.add(raw); symbols_meta.push({ raw, market:'HK' }); });
  return { tickers: Array.from(tickers), symbols_meta };
}

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function scrapeViaApi(page, user_id){
  try{
    const res = await page.evaluate(async (uid) => {
      const url = `https://xueqiu.com/statuses/user_timeline.json?user_id=${uid}&page=1`;
      const r = await fetch(url, { credentials: 'include' });
      if(!r.ok) throw new Error('timeline api not ok');
      return await r.json();
    }, user_id);
    const list = (res && (res.statuses || res.list || res)) || [];
    const mapped = list.map((it, idx) => {
      const url = it.target ? `https://xueqiu.com/${it.target}` : (it.url || '');
      const text = it.text || it.description || '';
      const created = it.created_at || it.createdAt || Date.now();
      const type = it.type || (url.includes('/article/') ? 'article':'post');
      const { tickers, symbols_meta } = extractSymbolsFromText(text + ' ' + (it.title||''));
      return {
        id: `post_${it.id || (Date.now()+idx)}`, user_id, user_name: it.user?.screen_name || '',
        type, created_at: toISOZ(created), url, title: it.title || '', text,
        comments_count: it.comments_count || 0, likes_count: it.likes || it.like_count || 0,
        tickers, symbols_meta, hash: `sha1_${user_id}_${it.id || idx}_${toISOZ(created)}_${type}`
      };
    });
    return mapped;
  }catch(e){
    console.log('[scrape] API 失败，改用 DOM 解析', e.message);
    return null;
  }
}

async function scrapeViaDom(page, user){
  const candidates = [
    `https://xueqiu.com/u/${user.id}`,
    `https://xueqiu.com/${user.id}`,
    `https://xueqiu.com/user/${user.id}`
  ];
  for(const url of candidates){
    try{
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(800 + Math.floor(Math.random()*900));
      const got = await page.evaluate(() => {
        const arr = [];
        const cards = document.querySelectorAll('article, .status, .card, .timeline__item');
        cards.forEach((el, idx) => {
          const linkEl = el.querySelector('a[href*="xueqiu.com"], a[href*="/status/"], a[href*="/article/"]');
          const url = linkEl?.href || '';
          const txt = (el.querySelector('.content, .text, .article__content, .status__content')?.textContent || '').trim();
          const timeTxt = el.querySelector('time')?.getAttribute('datetime') || el.querySelector('.time')?.textContent || '';
          const type = el.querySelector('.article, .post, .repost, .comment')?.className || (url.includes('/article/') ? 'article':'post');
          const idMatch = url.match(/\d{6,}/); const pid = idMatch?.[0] ? `post_${idMatch[0]}` : `post_${Date.now()}_${idx}`;
          arr.push({ id: pid, url, text: txt, created_at: timeTxt, type });
        });
        return arr;
      });
      if(got && got.length){
        // 补充标题与标的
        const enriched = [];
        for(const it of got){
          const out = { ...it, user_id: user.id, user_name: user.name || String(user.id) };
          if(it.type==='article' && it.url){
            try{
              await page.goto(it.url, { waitUntil: 'domcontentloaded' });
              await sleep(600 + Math.floor(Math.random()*900));
              const title = await page.evaluate(() => document.querySelector('h1, .article__title, .title')?.textContent?.trim() || '');
              out.title = title;
            }catch(e){ out.title = ''; }
          }
          out.created_at = toISOZ(out.created_at);
          const { tickers, symbols_meta } = extractSymbolsFromText((out.text||'') + ' ' + (out.title||''));
          out.tickers = tickers; out.symbols_meta = symbols_meta;
          out.hash = `sha1_${out.user_id}_${out.id}_${out.created_at}_${out.type}`;
          enriched.push(out);
        }
        return enriched;
      }
    }catch(e){ /* try next */ }
  }
  return [];
}

async function main(){
  const COOKIE = process.env.XUEQIU_COOKIE || '';
  const cfg = yaml.parse(fs.readFileSync(path.join(process.cwd(), 'config.yml'), 'utf8'));
  let users = cfg?.xueqiu?.target_users || [];
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const hour = new Date().toISOString().slice(0,13);
  const snap = path.join(dataDir, `${hour}.json`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(parseCookieString(COOKIE).map(c => ({ name: c.name, value: c.value, domain: 'xueqiu.com', path: '/', httpOnly: false, secure: true })));
  const page = await context.newPage();
  const all = [];
  try{
    await page.goto('https://xueqiu.com/', { waitUntil: 'domcontentloaded' });
    await sleep(900 + Math.floor(Math.random()*900));

    // 若 users 为空，尝试临时在运行期同步一次（点击“特别关注”）
    if(!users.length){
      try{
        await page.goto('https://xueqiu.com/friendships?tab=following', { waitUntil: 'domcontentloaded' });
        await sleep(800 + Math.floor(Math.random()*900));
        const tab = await page.locator('text=特别关注').first(); if(await tab.count()) { await tab.click(); await sleep(800); }
        users = await page.evaluate(() => {
          const arr = []; const rows = document.querySelectorAll('[data-user-id], .user-item, .user-card, .user__row');
          rows.forEach(el => { const id = el.getAttribute('data-user-id') || el.querySelector('[data-id]')?.getAttribute('data-id'); const name = el.querySelector('.name, .user-name, .screen-name, a[href*="/u/"]')?.textContent?.trim(); if(id) arr.push({ id: Number(id), name: name||String(id) }); });
          return arr;
        });
        console.log('[scrape] 运行期临时同步特别关注：', users.length);
      }catch(e){ console.log('[scrape] 运行期同步失败', e.message); }
    }

    for(const u of users){
      try{
        console.log('[scrape] 抓取用户', u.id, u.name);
        const apiItems = await scrapeViaApi(page, u.id);
        const items = apiItems || await scrapeViaDom(page, u);
        // 补齐用户名
        items.forEach(it => { if(!it.user_name) it.user_name = u.name || String(u.id); });
        all.push(...items);
        await sleep(1000 + Math.floor(Math.random()*1200));
      }catch(e){ console.log('[scrape] 用户失败', u.id, e.message); }
    }
  } finally {
    await browser.close();
  }
  if(all.length === 0){
    all.push({ id:'post_demo', user_id:1000, user_name:'示例', type:'post', created_at:new Date().toISOString(), url:'https://xueqiu.com', title:'', text:'占位：未抓到数据', tickers:[], symbols_meta:[], comments_count:0, likes_count:0, hash:'demo' });
  }
  fs.writeFileSync(snap, JSON.stringify(all, null, 2));
  console.log('[scrape] 写入快照', snap, '数量', all.length);
}

main().catch(e => { console.error(e); process.exit(0); });
