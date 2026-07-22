const { google } = require("googleapis");
const { chromium } = require("playwright");
const fs = require("fs");

async function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
}

async function getCampaigns() {
  const auth = await getGoogleAuth();

  const sheets = google.sheets({
    version: "v4",
    auth
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Campaigns!A:G"
  });

  const rows = response.data.values || [];

  if (rows.length <= 1) {
    return [];
  }

  const campaigns = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    campaigns.push({
      campaignId: row[0],
      campaignName: row[1],
      url: row[2],
      startDate: row[3],
      endDate: row[4],
      active: row[5],
      folderId: row[6]
    });
  }

  return campaigns.filter(
    c => c.active && c.active.toLowerCase() === "yes"
  );
}

async function takeScreenshot(url, fileName) {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1366,
      height: 768
    }
  });

  console.log(`Opening ${url}`);

  await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 60000
});

await page.waitForLoadState("domcontentloaded");

await page.waitForTimeout(15000);

  await page.mouse.wheel(0, 500);

  await page.waitForTimeout(2000);

  await page.mouse.wheel(0, -500);

  await page.waitForTimeout(1000);

  await page.screenshot({
    path: fileName,
    fullPage: false
  });

  await browser.close();
}

async function main() {
  const campaigns = await getCampaigns();

  console.log(
    `Found ${campaigns.length} active campaigns`
  );

  if (!campaigns.length) {
    return;
  }

  const campaign = campaigns[0];

  const fileName = "test-screenshot.png";

  await takeScreenshot(
    campaign.url,
    fileName
  );

  console.log(
    `Screenshot saved: ${fileName}`
  );

  console.log("SUCCESS");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
