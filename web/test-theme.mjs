import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8100";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[autocomplete="username"]', "__t3__");
await page.fill('input[type="password"]', "test123456");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);

const read = () => page.evaluate(() => document.documentElement.dataset.theme);
const stored = () => page.evaluate(() => localStorage.getItem("wn.theme"));

console.log("初始:", await read(), "/ 存储:", await stored());

// 点顶部切换
await page.click('button[aria-label="切换外观"]');
await page.waitForTimeout(400);
console.log("点一次后:", await read(), "/ 存储:", await stored());

await page.click('button[aria-label="切换外观"]');
await page.waitForTimeout(400);
console.log("再点一次:", await read(), "/ 存储:", await stored());

// 设置页三态
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: /跟随系统/ }).click();
await page.waitForTimeout(400);
console.log("设为跟随系统:", await read(), "/ 存储:", await stored());

// 刷新后保持
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
console.log("刷新后:", await read(), "/ 存储:", await stored());

await browser.close();
