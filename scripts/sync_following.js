// 使用 Playwright 同步“特别关注”分组到 config.yml.target_users（基于你的截图）
// 逻辑：
// - 打开 关注的人 页面 https://xueqiu.com/friendships?tab=following
// - 点击顶部“特别关注”标签
// - 从列表中抽取 data-user-id 与昵称
// - only_special 为 true 时，写入该分组；否则也可扩展抓全部（此版仅实现特别关注）

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

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

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

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(parseCookieString(COOKIE).map(c => ({ name: c.name, value: c.value, domain: 'xueqiu.com', path: '/', httpOnly: false, secure: true })));
  const page = await context.newPage();
  try{
    await page.goto('https://xueqiu.com/friendships?tab=following', { waitUntil: 'domcontentloaded' });
    await sleep(800 + Math.floor(Math.random()*900));

    // 点击“特别关注”tab（中文文本匹配）
    try{
      const tab = await page.locator('text=特别关注').first();
      if(await tab.count() && await tab.isVisible()){
        await tab.click();
        await sleep(800 + Math.floor(Math.random()*900));
      }
    }catch{}

    // 解析用户卡片
    const users = await page.evaluate(() => {
      const arr = [];
      // 用户条目容器可能是 .follow__list 或通用列表
      const rows = document.querySelectorAll('[data-user-id], .user-item, .user-card, .user__row');
      rows.forEach(el => {
        const id = el.getAttribute('data-user-id') || el.querySelector('[data-id]')?.getAttribute('data-id');
        // 昵称选择器容错
        const name = el.querySelector('.name, .user-name, .screen-name, a[href*="/u/"]')?.textContent?.trim();
        if(id){ arr.push({ id: Number(id), name: name || String(id) }); }
      });
      return arr;
    });

    if(users.length){
      cfg.xueqiu.target_users = users;
      fs.writeFileSync(cfgPath, yaml.stringify(cfg));
      console.log(`[sync_following] 特别关注同步完成：${users.length} 人`);
    } else {
      console.log('[sync_following] 特别关注列表解析为空（可能页面结构与选择器不符）');
    }
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(0); });
