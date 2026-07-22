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
      spreadsheetId:
        process.env.SPREADSHEET_ID,
      range: "Campaigns!A:G"
    });

  const rows =
    response.data.values || [];

  if (rows.length <= 1) {
    return [];
  }

  const campaigns = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

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
        height: 1080
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
  finalPath
) {
  const screenshot =
    await Jimp.read(
      screenshotPath
    );

  const taskbar =
    await Jimp.read(
      "taskbar-template.png"
    );

  const width =
    screenshot.bitmap.width;

  taskbar.resize(
    width,
    Jimp.AUTO
  );

  const font =
    await Jimp.loadFont(
      Jimp.FONT_SANS_32_WHITE
    );

  const now = getCurrentIST();

  const timeText =
    now.format("HH:mm");

  const dateText =
    now.format("DD-MM-YYYY");

  taskbar.print(
    font,
    width - 220,
    8,
    timeText
  );

  taskbar.print(
    font,
    width - 260,
    42,
    dateText
  );

  const merged =
    new Jimp(
      width,
      screenshot.bitmap.height +
        taskbar.bitmap.height
    );

  merged.blit(
    screenshot,
    0,
    0
  );

  merged.blit(
    taskbar,
    0,
    screenshot.bitmap.height
  );

  await merged.writeAsync(
    finalPath
  );
}

async function uploadFile(
  drive,
  filePath,
  fileName,
  parentFolderId
) {
  const response =
    await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [parentFolderId]
      },
      media: {
        mimeType: "image/png",
        body:
          fs.createReadStream(
            filePath
          )
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
      finalFile
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
