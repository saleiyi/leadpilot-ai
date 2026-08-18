const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:3000";

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#demo").scrollIntoViewIfNeeded();

  const cases = [
    { tab: "qualified", score: "91", action: /book|call/i },
    { tab: "incomplete", score: "62", action: /ask|information|reply/i },
    { tab: "spam", score: "8", action: /archive|ignore/i },
  ];

  const results = [];
  for (const testCase of cases) {
    await page.locator(`[data-scenario="${testCase.tab}"]`).click();
    await page.locator("#submit").click();
    await page.locator("#result").waitFor({ state: "visible" });
    const score = (await page.locator("#score").textContent()).trim();
    const action = (await page.locator("#action").textContent()).trim();
    results.push({ scenario: testCase.tab, score, action });
    if (score !== testCase.score || !testCase.action.test(action)) {
      throw new Error(`Unexpected ${testCase.tab} result: ${score} / ${action}`);
    }
  }

  await page.locator('[data-scenario="qualified"]').click();
  await page.locator("#submit").click();
  await page.locator("#result").waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "C:/Users/fan/.codex/visualizations/2026/08/18/01a01541-4972-7843-9c6c-2bd535d9233c/leadpilot-demo-final.png",
    fullPage: false,
  });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.screenshot({
    path: "C:/Users/fan/.codex/visualizations/2026/08/18/01a01541-4972-7843-9c6c-2bd535d9233c/leadpilot-mobile-final.png",
    fullPage: true,
  });
  const mobileSize = await mobile.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));

  await browser.close();
  console.log(JSON.stringify({ results, consoleErrors, mobileSize }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
