const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { chromium } = require("playwright");
const randomUA = require("random-useragent");
require("dotenv").config();

const LOGIN_URL = "https://ctrl.lunes.host/";

const ACCOUNTS = process.env.ACCOUNTS ? process.env.ACCOUNTS.split(",") : [];
const SERVER_ID = process.env.SERVER_ID;
const SERVER_UUID = process.env.SERVER_UUID;
const NODE_HOST = process.env.NODE_HOST;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ONLY_ERROR_NOTIFY = (process.env.ONLY_ERROR_NOTIFY || "true").toLowerCase() === "true";

const COOKIE_DIR = path.resolve(__dirname, "cookies");
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");

if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

function randomDelay(min = 10000, max = 60000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sendTG(text, photoPath) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  if (photoPath && fs.existsSync(photoPath)) {
    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);
    formData.append("caption", text);
    formData.append("photo", fs.createReadStream(photoPath));
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: formData });
  } else {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text })
    });
  }
}

async function detectCloudflare(page) {
  const content = await page.content();
  return content.includes("Just a moment") || content.includes("cf-browser-verification");
}

async function verifyServer(page) {
  const content = await page.content();
  const checks = [];
  if (SERVER_ID) checks.push(content.includes(SERVER_ID));
  if (SERVER_UUID) checks.push(content.includes(SERVER_UUID));
  if (NODE_HOST) checks.push(content.includes(NODE_HOST));
  if (!checks.length) return true;
  return checks.every(Boolean);
}

async function loginAccount(username, password) {
  const cookiePath = path.join(COOKIE_DIR, `${username}.json`);
  const screenshotPath = path.join(SCREENSHOT_DIR, `${username}.png`);
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const browser = await chromium.launch({ headless: true });
    const context = fs.existsSync(cookiePath)
      ? await browser.new_context({ storageState: cookiePath })
      : await browser.newContext({ userAgent: randomUA.getRandom() });

    const page = await context.newPage();
    // Playwright stealth
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(LOGIN_URL, { timeout: 60000 });
    await page.waitForTimeout(randomDelay());

    if (await detectCloudflare(page)) {
      await page.screenshot({ path: screenshotPath });
      await browser.close();
      if (attempt === maxRetries) return [false, "Cloudflare Challenge", screenshotPath];
      console.log(`⚠️ Cloudflare challenge detected, retry ${attempt}/${maxRetries}`);
      continue;
    }

    let content = await page.content();

    if (!content.includes("Dashboard")) {
      await page.fill('input[type="text"]', username);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(randomDelay());
      content = await page.content();
    }

    if (!content.includes("Dashboard")) {
      await page.screenshot({ path: screenshotPath });
      await browser.close();
      if (attempt === maxRetries) return [false, "Login Failed", screenshotPath];
      console.log(`⚠️ Login failed, retry ${attempt}/${maxRetries}`);
      continue;
    }

    if (!(await verifyServer(page))) {
      await page.screenshot({ path: screenshotPath });
      await browser.close();
      return [false, "Server Info Not Matched", screenshotPath];
    }

    await context.storageState({ path: cookiePath });
    await browser.close();
    return [true, "Success", null];
  }
}

(async () => {
  // 随机延迟启动，降低 CF 触发概率
  await new Promise(r => setTimeout(r, randomDelay(10000, 60000)));

  for (const acc of ACCOUNTS) {
    const [username, password] = acc.split(":");
    console.log(`🔄 Checking ${username}`);

    const [ok, msg, screenshot] = await loginAccount(username, password);

    if (ok) {
      console.log(`✅ ${username} success`);
      if (!ONLY_ERROR_NOTIFY) await sendTG(`✅ ${username} 保活成功\n时间: ${new Date()}`);
    } else {
      console.log(`❌ ${username} failed: ${msg}`);
      await sendTG(`❌ ${username} 保活失败\n原因: ${msg}\n时间: ${new Date()}`, screenshot);
    }
  }
})();
