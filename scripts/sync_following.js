// 使用 Playwright 登录态同步关注/特别关注到 config.yml.target_users
// 说明：实际页面/接口可能调整，本脚本采取多策略尝试：
// 1) 直接访问“我关注的人”页面，解析用户卡片
// 2) 在页面上下文里调用站内接口（fetch），读取分组与特别关注标记
// 若全部失败，则保留原有 target_users，不中断后续流程

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
  if(!COOKIE || !COOKIE.includes('xq_a_token=')){
    console.log('[sync_following] 未检测到有效 XUEQIU_COOKIE，跳过同步');
    return;
  }
  const cfgPath = path.join(process.cwd(), 'config.yml');
  const cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.xueqiu ||= {}; cfg.xueqiu.target_users ||= []; cfg.xueqiu.sync_following ||= true;
  if(!cfg.xueqiu.sync_following){
    console.log('[sync_following] 配置关闭同步，跳过');
    return;
  }
  const onlySpecial = !!cfg.xueqiu.only_special;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  // 注入 Cookie 到上下文
  await context.addCookies(parseCookieString(COOKIE).map(c => ({
    name: c.name, value: c.value, domain: 'xueqiu.com', path: '/', httpOnly: false, secure: true
  })));
  const page = await context.newPage();
  try{
    // 访问首页确认登录态
    await page.goto('https://xueqiu.com/', { waitUntil: 'domcontentloaded' });
    await sleep(800 + Math.floor(Math.random()*900));

    let users = [];
    // 策略A：尝试站内接口（在登录态下应可访问）
    try{
      const apiRes = await page.evaluate(async () => {
        const r = await fetch('https://xueqiu.com/friendships/groups.json', { credentials: 'include' });
        if(!r.ok) throw new Error('groups.json not ok');
        return await r.json();
      });
      // 结构示例兼容：分组里拿到用户与是否特别关注
      if(apiRes && Array.isArray(apiRes.groups)){
        for(const g of apiRes.groups){
          const special = g.name && (g.name.includes('特别') || g.name.includes('special'));
          if(Array.isArray(g.users)){
            for(const u of g.users){
              users.push({ id: u.id || u.user_id || u.uid, name: u.screen_name || u.name || u.nick, special });
            }
          }
        }
      }
    }catch(e){
      console.log('[sync_following] 站内接口方案失败，尝试解析页面卡片...', e.message);
    }

    // 策略B：解析“关注列表”页面卡片（选择器容错）
    if(users.length === 0){
      const candidateUrls = [
        'https://xueqiu.com/friendships?tab=following',
        'https://xueqiu.com/p/settings/following',
        'https://xueqiu.com/user/following'
      ];
      for(const u of candidateUrls){
        try{
          await page.goto(u, { waitUntil: 'domcontentloaded' });
          await sleep(800 + Math.floor(Math.random()*900));
          const got = await page.evaluate(() => {
            const arr = [];
            const cards = document.querySelectorAll('[data-user-id], .user__card, .user-item');
            cards.forEach(el => {
              const id = el.getAttribute('data-user-id') || el.querySelector('[data-id]')?.getAttribute('data-id');
              const name = el.querySelector('.name, .user-name, .screen-name')?.textContent?.trim();
              const special = !!(el.querySelector('.special') || el.querySelector('.star') || el.querySelector('.icon-star'));
              if(id) arr.push({ id: Number(id), name, special });
            });
            return arr;
          });
          if(got && got.length){ users = got; break; }
        }catch(e){ /* continue */ }
      }
    }

    if(users.length === 0){
      console.log('[sync_following] 未解析到关注列表，保留原 target_users');
    } else {
      // 过滤只保留特别关注（若启用）
      const filtered = onlySpecial ? users.filter(u => u.special) : users;
      // 去重与清洗
      const uniq = []; const seen = new Set();
      for(const u of filtered){
        const id = Number(u.id); if(!id || seen.has(id)) continue; seen.add(id);
        uniq.push({ id, name: u.name || String(id) });
      }
      cfg.xueqiu.target_users = uniq;
      fs.writeFileSync(cfgPath, yaml.stringify(cfg));
      console.log(`[sync_following] 同步完成，写入 ${uniq.length} 个用户${onlySpecial?'（仅特别关注）':''}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(0); /* 不阻断后续流程 */ });
