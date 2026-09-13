const fs = require("fs");
const path = require("path");
const https = require("https");

// ===== ตั้งค่า =====
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "YOUR_CHANNEL_ACCESS_TOKEN";
const IMAGE_PATH = path.join(__dirname, "slippy-rich-menu.png"); // ใส่ชื่อไฟล์รูปที่นี่

// ===== Helper: HTTP request =====
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Step 1: สร้าง Rich Menu
async function createRichMenu() {
  console.log("📋 สร้าง Rich Menu...");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "rich-menu-config.json"), "utf8"));
  const body = JSON.stringify(config);

  const res = await request(
    {
      hostname: "api.line.me",
      path: "/v2/bot/richmenu",
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.status !== 200) {
    throw new Error(`สร้าง Rich Menu ไม่สำเร็จ: ${JSON.stringify(res.body)}`);
  }

  console.log(`✅ สร้างสำเร็จ richMenuId: ${res.body.richMenuId}`);
  return res.body.richMenuId;
}

// Step 2: อัพโหลดรูปภาพ
async function uploadImage(richMenuId) {
  console.log("🖼️  อัพโหลดรูปภาพ...");
  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const ext = path.extname(IMAGE_PATH).toLowerCase();
  const contentType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api-data.line.me",
        path: `/v2/bot/richmenu/${richMenuId}/content`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": contentType,
          "Content-Length": imageBuffer.length,
        },
      },
      (r) => {
        let data = "";
        r.on("data", (c) => (data += c));
        r.on("end", () => resolve({ status: r.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(imageBuffer);
    req.end();
  });

  if (res.status !== 200) {
    throw new Error(`อัพโหลดรูปไม่สำเร็จ: ${res.body}`);
  }
  console.log("✅ อัพโหลดรูปสำเร็จ");
}

// Step 3: ตั้งเป็น Default Rich Menu
async function setAsDefault(richMenuId) {
  console.log("⚙️  ตั้งเป็น Default Rich Menu...");
  const res = await request({
    hostname: "api.line.me",
    path: `/v2/bot/user/all/richmenu/${richMenuId}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      "Content-Length": 0,
    },
  });

  if (res.status !== 200) {
    throw new Error(`ตั้ง Default ไม่สำเร็จ: ${JSON.stringify(res.body)}`);
  }
  console.log("✅ ตั้ง Default สำเร็จ");
}

// รัน
(async () => {
  try {
    if (!fs.existsSync(IMAGE_PATH)) {
      console.error(`❌ ไม่พบไฟล์รูป: ${IMAGE_PATH}`);
      console.error("   กรุณาเปลี่ยนชื่อ IMAGE_PATH ให้ถูกต้อง");
      process.exit(1);
    }

    const richMenuId = await createRichMenu();
    await uploadImage(richMenuId);
    await setAsDefault(richMenuId);

    console.log("\n🎉 เสร็จสิ้น! Rich Menu ใช้งานได้แล้ว");
    console.log(`   richMenuId: ${richMenuId}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
