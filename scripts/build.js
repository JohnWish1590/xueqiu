// 将 data/index.json 复制到 web 目录供前端读取
import fs from 'fs'; import path from 'path';
const src = path.join(process.cwd(),'data','index.json');
const dstDir = path.join(process.cwd(),'web','data');
fs.mkdirSync(dstDir, { recursive: true });
const dst = path.join(dstDir,'index.json');
fs.copyFileSync(src, dst);
console.log("拷贝 index.json ->", dst);
