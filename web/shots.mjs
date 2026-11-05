import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.WN_BASE || "http://127.0.0.1:8100";
const OUT = process.env.WN_SHOTS || "shots";
const USER = process.env.WN_USER || "kev";
const PASS = process.env.WN_PASS || "wordnote123";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("console error:", m.text());
});
page.on("pageerror", (e) => console.log("page error:", e.message));

const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("shot:", name);
};

// 1) 登录页
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot("01-login");

// 2) 登录
const hasUser = await page.locator('input[autocomplete="username"]').count();
if (hasUser) {
  await page.fill('input[autocomplete="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("02-dashboard");
} else {
  console.log("未找到登录表单，可能已登录或处于初始化状态");
  await shot("02-after-login");
}

// 3) 各页
const pages = [
  ["/words", "03-wordbook"],
  ["/words?mode=random", "04-wordbook-random"],
  ["/review", "05-review"],
  ["/new", "06-compose"],
  ["/settings", "07-settings"],
];
for (const [path, name] of pages) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(900);
  await shot(name);
}

// 4) 句子详情（取第一句）
const list = await page.evaluate(async () => {
  const r = await fetch("/api/sentences?limit=1", { credentials: "include" });
  const j = await r.json();
  return j.items?.[0]?.id ?? null;
});
if (list) {
  await page.goto(`${BASE}/sentences/${list}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  await shot("08-sentence-detail");
}

// 5) 词详情（取第一个词）
const wordId = await page.evaluate(async () => {
  const r = await fetch("/api/words?limit=1", { credentials: "include" });
  const j = await r.json();
  return j.items?.[0]?.id ?? null;
});
if (wordId) {
  await page.goto(`${BASE}/words/${wordId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  await shot("09-word-detail");
}

// 6) 手机宽度
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("10-mobile-dashboard");

await browser.close();
console.log("done");
