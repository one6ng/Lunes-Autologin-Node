const puppeteer = require("puppeteer");
const axios = require("axios");

const {
  LUNES_USERNAME,
  LUNES_PASSWORD,
  SERVER_ID,
  SERVER_UUID,
  NODE_HOST,
  BOT_TOKEN,
  CHAT_ID,
} = process.env;

async function sendTG(message) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    await page.goto("https://ctrl.lunes.host/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // 自动查找输入框（通用匹配）
    await page.type('input[type="text"]', LUNES_USERNAME);
    await page.type('input[type="password"]', LUNES_PASSWORD);

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    // 验证登录是否成功
    const content = await page.content();

    if (content.includes("Dashboard") || content.includes("Logout")) {
      console.log("登录成功 ✅");

      await sendTG(
        `✅ Lunes.Host 自动登录成功\n\n` +
        `SERVER_ID: ${SERVER_ID || "未设置"}\n` +
        `SERVER_UUID: ${SERVER_UUID || "未设置"}\n` +
        `NODE_HOST: ${NODE_HOST || "未设置"}`
      );
    } else {
      throw new Error("登录验证失败");
    }

  } catch (err) {
    console.error("登录失败 ❌", err.message);

    await sendTG(
      `❌ Lunes.Host 自动登录失败\n\n` +
      `错误信息: ${err.message}\n` +
      `SERVER_ID: ${SERVER_ID || "未设置"}`
    );
  } finally {
    await browser.close();
  }
})();
