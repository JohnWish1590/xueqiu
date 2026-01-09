// 合并 data 目录所有快照为 index.json
import fs from 'fs'; import path from 'path';
const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
let all = [];
for (const f of files) {
  try { const arr = JSON.parse(fs.readFileSync(path.join(dataDir, f))); all = all.concat(arr); } catch {}
}
// 去重（按 hash）
const seen = new Set(); const merged = [];
for (const item of all) { if (!seen.has(item.hash)) { seen.add(item.hash); merged.push(item); } }
// 构建索引结构
const byUser = {}; const byTicker = {};
for (const item of merged) {
  byUser[item.user_id] ||= []; byUser[item.user_id].push(item);
  (item.tickers||[]).forEach(t => { byTicker[t] ||= []; byTicker[t].push(item); });
}
const index = { timeline: merged.sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)), byUser, byTicker };
fs.writeFileSync(path.join(dataDir,'index.json'), JSON.stringify(index, null, 2));
console.log("生成 index.json，共", merged.length, "条");
