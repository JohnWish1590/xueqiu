# 雪球关注动态聚合（模板）

本模板用于：
- GitHub Actions 每小时抓取你雪球账号可见范围内的关注/特别关注动态（登录态通过 Secrets 注入 Cookie）
- GitHub Pages 展示时间线、按用户、按标的的三个视图

步骤：
1) 在仓库 Settings → Secrets → Actions 添加 `XUEQIU_COOKIE`（至少含 `xq_a_token` 与 `u`，建议整段 Cookie 单行粘贴）。
2) 将本模板所有文件置于仓库根目录（保持路径结构）。
3) 合并到 `main` 后，在 Actions 页面手动 Run 一次工作流。
4) Pages 地址形如：`https://<你的用户名>.github.io/<仓库名>/`

合规：
- 仅用于个人账号可见范围的聚合与归档；默认限速、随机延迟、失败退避。
- Cookie 失效或遇风控将降级到公开页面抓取（功能受限）。
