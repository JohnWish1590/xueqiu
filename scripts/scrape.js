// 占位：后续改为 Playwright 登录抓取
// 这里先生成一个小时快照与示例数据，便于前端查看结构
import fs from 'fs'; import path from 'path';
const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true }); // 新增：确保 data 目录存在
const now = new Date(); const hour = now.toISOString().slice(0,13);
const snap = path.join(dataDir, `${hour}.json`);
const sample = [
  {
    id: "post_123456",
    user_id: 1247347556,
    user_name: "段永平",
    type: "post",
    created_at: new Date().toISOString(),
    url: "https://xueqiu.com/123456",
    title: "",
    text: "示例：这是占位抓取生成的卡片文本",
    tickers: ["TSLA"],
    symbols_meta: [{ raw:"$TSLA", market:"US" }],
    comments_count: 3,
    likes_count: 10,
    hash: "demo-hash-1"
  }
];
fs.writeFileSync(snap, JSON.stringify(sample, null, 2));
console.log("写入占位快照:", snap);
