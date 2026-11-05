import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8100";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1.4 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));

// 未登录状态（新建 context 默认 prefers-color-scheme: light）→ 浅色登录页
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.4 });
const anonPage = await anon.newPage();
await anonPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await anonPage.waitForTimeout(600);
console.log("anon theme:", await anonPage.evaluate(() => document.documentElement.dataset.theme));
await anonPage.screenshot({ path: "shots/20-login-light.png" });

// 登录
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[autocomplete="username"]', "__t3__");
await page.fill('input[type="password"]', "test123456");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const s = await (await fetch("/api/sentences?limit=1", { credentials: "include" })).json();
  const w = await (await fetch("/api/words?limit=1", { credentials: "include" })).json();
  return { sid: s.items?.[0]?.id ?? null, wid: w.items?.[0]?.id ?? null };
});
console.log("ids:", ids);

const setMode = async (m) => {
  await page.evaluate((mode) => localStorage.setItem("wn.theme", mode), m);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
};

// 浅色
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await setMode("light");
console.log("theme now:", await page.evaluate(() => document.documentElement.dataset.theme));
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/21-dashboard-light.png" });

const pages = [
  ["/words", "22-wordbook-light"],
  ["/review", "23-review-light"],
  ["/settings", "24-settings-light"],
];
for (const [path, name] of pages) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `shots/${name}.png` });
}
if (ids.sid) {
  await page.goto(`${BASE}/sentences/${ids.sid}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "shots/25-sentence-light.png" });
}
if (ids.wid) {
  await page.goto(`${BASE}/words/${ids.wid}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "shots/26-word-light.png" });
}

// 深色对照
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await setMode("dark");
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/27-dashboard-dark.png" });

// 手机浅色
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await setMode("light");
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/28-mobile-light.png" });

await browser.close();
console.log("done");
