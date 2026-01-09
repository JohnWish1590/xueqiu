// 简单校验 Secrets 是否包含关键键
const required = ["xq_a_token", "u"]; const cookie = process.env.XUEQIU_COOKIE || "";
const ok = required.every(k => cookie.includes(k + "="));
if (!ok) {
  console.error("XUEQIU_COOKIE 缺少必要键：", required);
  process.exit(1);
}
console.log("XUEQIU_COOKIE 基本校验通过");