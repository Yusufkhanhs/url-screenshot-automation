console.log("BUILD VERSION: JULY-23-ADDRESSBAR-V3");
const { google } = require("googleapis");
const { chromium } = require("playwright");
const Jimp = require("jimp");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

const SLOT_NAMES = {
  MORNING: "06AM_12PM",
  AFTERNOON: "12PM_06PM",
  EVENING: "06PM_12AM",
  NIGHT: "12AM_06AM"
};

async function getGoogleAuth() {
  const credentials = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT
  );

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
}

async function getGoogleServices() {
  const auth = await getGoogleAuth();

  return {
    sheets: google.sheets({
      version: "v4",
      auth
    }),
    drive: google.drive({
      version: "v3",
      auth
    })
  };
}

function getCurrentIST() {
  return moment().tz("Asia/Kolkata");
}

function getSlotName() {
  const hour = parseInt(
    getCurrentIST().format("H"),
    10
  );

  if (hour >= 6 && hour < 12) {
    return SLOT_NAMES.MORNING;
  }

  if (hour >= 12 && hour < 18) {
    return SLOT_NAMES.AFTERNOON;
  }

  if (hour >= 18) {
    return SLOT_NAMES.EVENING;
  }

  return SLOT_NAMES.NIGHT;
}

async function getCampaigns(sheets) {
  const response =
  await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Campaigns!A:G",
    valueRenderOption: "FORMATTED_VALUE"
  });

  const rows =
    response.data.values || [];

  if (rows.length <= 1) {
    return [];
  }

  const campaigns = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    console.log(row);

    campaigns.push({
      campaignId: row[0] || "",
      campaignName: row[1] || "",
      url: row[2] || "",
      startDate: row[3] || "",
      endDate: row[4] || "",
      active: row[5] || "",
      folderId: row[6] || ""
    });
  }

  return campaigns.filter(
    c =>
      c.active &&
      c.active.toLowerCase() === "yes"
  );
}

async function getOrCreateFolder(
  drive,
  folderName,
  parentId
) {
  const search =
  await drive.files.list({
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    q: `'${parentId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${folderName}'`,
    fields: "files(id,name)"
  });

  if (
    search.data.files &&
    search.data.files.length
  ) {
    return search.data.files[0].id;
  }

const folder =
  await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: folderName,
      mimeType:
        "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id"
  });
  return folder.data.id;
}

async function takeScreenshot(
  url,
  fileName
) {
  const browser =
    await chromium.launch({
      headless: true
    });

  const page =
    await browser.newPage({
      viewport: {
  width: 1920,
  height: 1350
}
    });

  console.log(`Opening ${url}`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });

  await page.waitForTimeout(15000);

  await page.mouse.move(500, 300);

  await page.mouse.wheel(0, 700);

  await page.waitForTimeout(3000);

  await page.mouse.wheel(0, -700);

  await page.waitForTimeout(3000);

  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "iframe"
        ).length >= 2,
      {
        timeout: 30000
      }
    );
  } catch (e) {
    console.log(
      "Ad iframes not detected"
    );
  }

  await page.waitForTimeout(5000);

  await page.screenshot({
    path: fileName,
    fullPage: false
  });

  await browser.close();
}

async function stitchTaskbar(
  screenshotPath,
  finalPath,
  originalUrl
) {
  
  const screenshotBase64 =
    fs.readFileSync(
      screenshotPath
    ).toString("base64");
const cleanUrl = new URL(
  originalUrl
).origin;
  const taskbarBase64 =
    fs.readFileSync(
      "taskbar-template.png"
    ).toString("base64");
const browserHeaderBase64 =
  fs.readFileSync(
    "browser-header.png"
  ).toString("base64");
  const now = getCurrentIST();

  const timeText =
    now.format("HH:mm");

  const dateText =
    now.format("DD-MM-YYYY");

  const browser =
    await chromium.launch({
      headless: true
    });

  const page =
    await browser.newPage({
      viewport: {
        width: 1920,
        height: 1200
      }
      });
console.log("ADDRESS BAR CSS TEST");
console.log("URL:", cleanUrl);
  await page.setContent(`
<html>
<head>
<style>
body{
  margin:0;
  padding:0;
  background:#000;
  font-family:'Segoe UI', Arial, sans-serif;
}

.wrapper{
  width:1920px;
}

.taskbar{
  position:relative;
}

.time{
  position:absolute;
  right:18px;
  top:5px;
  color:white;
  font-size:18px;
  font-weight:400;
}

.date{
  position:absolute;
  right:18px;
  top:28px;
  color:white;
  font-size:16px;
  font-weight:400;
}

.browser-header{
  position:relative;
  width:1918px;
  height:129px;
}

.address-bar{
  position:absolute;

  left:208px;
  top:66px;

  width:1379px;
  height:50px;


  display:flex;
  align-items:center;

  padding-left:14px;

  font-size:22px;
  color:white;

  overflow:hidden;
  white-space:nowrap;
}
</style>
</head>
<body>

<div class="wrapper">
<div class="browser-header">

<img
src="data:image/png;base64,${browserHeaderBase64}"
style="width:1918px;height:129px;display:block;">

<div class="address-bar">
${cleanUrl}
</div>

</div>
<img
src="data:image/png;base64,${screenshotBase64}"
width="1920">

<div class="taskbar">

<img
src="data:image/png;base64,${taskbarBase64}"
width="1920">

<div class="time">
${timeText}
</div>

<div class="date">
${dateText}
</div>

</div>

</div>

</body>
</html>
`);

  await page.screenshot({
    path: finalPath,
    fullPage: true
  });

  await browser.close();
}

async function uploadFile(
  drive,
  filePath,
  fileName,
  parentFolderId
) {
const response =
  await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [parentFolderId]
    },
    media: {
      mimeType: "image/png",
      body:
        fs.createReadStream(filePath)
    },
    fields: "id"
  });

  return response.data.id;
}

async function makePublic(
  drive,
  fileId
) {
  await drive.permissions.create({
  fileId,
  supportsAllDrives: true,
  requestBody: {
    role: "reader",
    type: "anyone"
  }
});

  return `https://drive.google.com/file/d/${fileId}/view`;
}

async function writeLog(
  sheets,
  values
) {
  await sheets.spreadsheets.values.append({
    spreadsheetId:
      process.env.SPREADSHEET_ID,
    range: "Execution_Log!A:G",
    valueInputOption: "RAW",
    requestBody: {
      values: [values]
    }
  });
}
// DATE VALIDATION TEMPORARILY DISABLED


async function processCampaign(
  drive,
  sheets,
  campaign
) {
  const now =
    getCurrentIST();

  const slot =
    getSlotName();

  const timestamp =
    now.format(
      "YYYY-MM-DD_HH-mm-ss"
    );

  const safeName =
    campaign.campaignName
      .replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )
      .substring(0, 50);

  const rawFile =
    `${safeName}_raw.png`;

  const finalFile =
    `${timestamp}_${safeName}.png`;

  try {
    const campaignFolder =
      await getOrCreateFolder(
        drive,
        campaign.campaignName,
        process.env
          .DRIVE_ROOT_FOLDER_ID
      );

    const slotFolder =
      await getOrCreateFolder(
        drive,
        slot,
        campaignFolder
      );

    await takeScreenshot(
      campaign.url,
      rawFile
    );

await stitchTaskbar(
  rawFile,
  finalFile,
  campaign.url
);

    const fileId =
      await uploadFile(
        drive,
        finalFile,
        finalFile,
        slotFolder
      );

    const driveLink =
      await makePublic(
        drive,
        fileId
      );

    await writeLog(
      sheets,
      [
        now.format(
          "YYYY-MM-DD HH:mm:ss"
        ),
        campaign.campaignId,
        campaign.url,
        slot,
        "SUCCESS",
        driveLink,
        ""
      ]
    );

    if (
      fs.existsSync(rawFile)
    ) {
      fs.unlinkSync(rawFile);
    }

    if (
      fs.existsSync(finalFile)
    ) {
      fs.unlinkSync(finalFile);
    }

    console.log(
      `SUCCESS: ${campaign.campaignName}`
    );
  } catch (error) {
    console.error(error);

    await writeLog(
      sheets,
      [
        now.format(
          "YYYY-MM-DD HH:mm:ss"
        ),
        campaign.campaignId,
        campaign.url,
        slot,
        "FAILED",
        "",
        error.message
      ]
    );
  }
}

async function main() {
  const {
    sheets,
    drive
  } =
    await getGoogleServices();

  const campaigns =
    await getCampaigns(
      sheets
    );

  console.log(
    `Found ${campaigns.length} active campaigns`
  );

for (const campaign of campaigns) {


  await processCampaign(
    drive,
    sheets,
    campaign
  );
}

  console.log(
    "ALL CAMPAIGNS COMPLETED"
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
