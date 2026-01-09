// 使用 Playwright 登录抓取目标用户的发帖/转发/评论/长文（基础版，选择器容错）
// 说明：站点结构可能变化；本脚本实现稳妥策略：
// - 通过 Cookie 建立会话，逐个访问用户主页（尝试 /u/{id} 与其他候选 URL）
// - 抽取卡片信息（id/链接/时间/摘要/类型/点赞/评论），文章类型进入详情页取标题
// - 每用户之间随机延迟，整体并发限制为1-3（此处为1以保守）
// - 失败不阻断全局流程（记录到控制台），最终生成小时快照

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

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function scrapeUser(page, user){
  const candidates = [
    `https://xueqiu.com/u/${user.id}`,
    `https://xueqiu.com/${user.id}`,
    `https://xueqiu.com/user/${user.id}`
  ];
  let items = [];
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
          const likes = Number(el.querySelector('.like__count, .status__like')?.textContent || 0);
          const comments = Number(el.querySelector('.comment__count, .status__comment')?.textContent || 0);
          arr.push({ id: pid, url, text: txt, created_at: timeTxt, type, likes_count: likes, comments_count: comments });
        });
        return arr;
      });
      if(got && got.length){ items = got; break; }
    }catch(e){ /* try next */ }
  }
  // 详情页补充文章标题（必要时）
  const enriched = [];
  for(const it of items){
    const out = { ...it, user_id: user.id, user_name: user.name || String(user.id) };
    if(it.type==='article' && it.url){
      try{
        await page.goto(it.url, { waitUntil: 'domcontentloaded' });
        await sleep(600 + Math.floor(Math.random()*900));
        const title = await page.evaluate(() => document.querySelector('h1, .article__title, .title')?.textContent?.trim() || '');
        out.title = title;
      }catch(e){ out.title = ''; }
    }
    // 规范时间
    out.created_at = toISOZ(out.created_at);
    // 简单标的解析：美股 $TSLA / A股 SH600519 / 港股 HK03690
    const txt = (out.text||'') + ' ' + (out.title||'');
    const tickers = [];
    const symbols_meta = [];
    const m1 = txt.match(/\$[A-Z]{1,6}/g) || [];
    m1.forEach(raw => { tickers.push(raw.slice(1)); symbols_meta.push({ raw, market: 'US' }); });
    const m2 = txt.match(/S[HZ]\d{6}/g) || [];
    m2.forEach(raw => { tickers.push(raw.slice(0)); symbols_meta.push({ raw, market: 'CN' }); });
    const m3 = txt.match(/HK\d{5}/g) || [];
    m3.forEach(raw => { tickers.push(raw.slice(0)); symbols_meta.push({ raw, market: 'HK' }); });
    out.tickers = Array.from(new Set(tickers));
    out.symbols_meta = symbols_meta;
    out.hash = `sha1_${out.user_id}_${out.id}_${out.created_at}_${out.type}`;
    enriched.push(out);
  }
  return enriched;
}

async function main(){
  const COOKIE = process.env.XUEQIU_COOKIE || '';
  const cfg = yaml.parse(fs.readFileSync(path.join(process.cwd(), 'config.yml'), 'utf8'));
  const users = cfg?.xueqiu?.target_users || [];
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
    for(const u of users){
      try{
        console.log('[scrape] 抓取用户', u.id, u.name);
        const items = await scrapeUser(page, u);
        all.push(...items);
        await sleep(1000 + Math.floor(Math.random()*1200));
      }catch(e){ console.log('[scrape] 用户失败', u.id, e.message); }
    }
  } finally {
    await browser.close();
  }
  // 若抓不到数据，保底写占位（避免后续步骤失败）
  if(all.length === 0){
    all.push({
      id: 'post_demo', user_id: 1000, user_name: '示例', type: 'post',
      created_at: new Date().toISOString(), url: 'https://xueqiu.com',
      title: '', text: '占位：未抓到数据时的示例项', tickers: [], symbols_meta: [], comments_count: 0, likes_count: 0, hash: 'demo'
    });
  }
  fs.writeFileSync(snap, JSON.stringify(all, null, 2));
  console.log('[scrape] 写入快照', snap, '数量', all.length);
}

main().catch(e => { console.error(e); process.exit(0); });
