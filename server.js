const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin@angry123";
const KEYS_FILE = path.join(__dirname, "keys.json");

// ─── Middleware ─────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Keys DB (JSON file) ────────────────────────────────
function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: [], maintenance: false }, null, 2));
  }
  return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
}

function saveKeys(db) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(db, null, 2));
}

// ─── Helper: check if key expired ──────────────────────
function isExpired(key) {
  if (!key.expiry) return false;
  return new Date() > new Date(key.expiry);
}

// ═══════════════════════════════════════════════════════
//   APK ENDPOINTS
// ═══════════════════════════════════════════════════════

// GET /hdshrs.php — Server status (APK pings this first)
app.get("/hdshrs.php", (req, res) => {
  const db = loadKeys();
  res.json({
    status: true,
    maintenance: db.maintenance || false,
    server_message: db.maintenance
      ? "Server is under maintenance. Please try again later."
      : "Server is running smoothly"
  });
});

// POST /hdshrs.php — Key validation
// App can send: username+key | user_key+serial | key+serial | key+game
app.post("/hdshrs.php", (req, res) => {
  const db = loadKeys();

  // Maintenance check
  if (db.maintenance) {
    return res.json({ status: false, message: "Server under maintenance. Try later." });
  }

  // Accept multiple param name formats from different app versions
  const rawKey      = req.body.key      || req.body.user_key || req.body.license_key || "";
  const rawUsername = req.body.username || req.body.user     || req.body.serial      || req.body.hwid || "";
  const game        = req.body.game     || "";

  // Log incoming for debugging
  console.log("[AUTH] body:", JSON.stringify(req.body));
  console.log("[AUTH] key:", rawKey, "| user/serial:", rawUsername, "| game:", game);

  if (!rawKey) {
    return res.json({ status: false, message: "Invalid request." });
  }

  // Match by key alone first, then also check username/serial if provided
  let found = db.keys.find((k) => k.key === rawKey.trim());

  if (!found) {
    return res.json({ status: false, message: "Invalid key or username." });
  }

  if (!found.active) {
    return res.json({ status: false, message: "Key is disabled." });
  }

  if (isExpired(found)) {
    return res.json({ status: false, message: "Key has expired." });
  }

  // Update last seen & hwid/serial
  found.last_seen = new Date().toISOString();
  found.hwid      = rawUsername || found.hwid || "";
  found.uses      = (found.uses || 0) + 1;
  saveKeys(db);

  const expStr = found.expiry ? found.expiry.replace("T", " ").substring(0, 19) : "2030-12-31 23:59:59";

  return res.json({
    status: true,
    message: "Login Success",
    reason: "Login Success",
    username: found.username,
    expiry: found.expiry || "Lifetime",
    exp: expStr,
    plan: found.plan || "Standard",
    data: {
      user_key: found.key,
      expired_date: expStr,
      seller_name: "AngryMod",
      registrator: "Admin"
    }
  });
});

// GET /connect — APK initial connection check
app.get("/connect", (req, res) => {
  res.json({
    web_info: {
      _client: "ANGRY MOD",
      license: "valid",
      version: "1.0.0"
    },
    web_dev: {
      author: "Angry Mod Dev",
      telegram: "https://t.me/"
    }
  });
});

// ═══════════════════════════════════════════════════════
//   ADMIN API ENDPOINTS
// ═══════════════════════════════════════════════════════

// Middleware to check admin password
function adminAuth(req, res, next) {
  const pass = req.headers["x-admin-password"] || req.body?.admin_password || req.query?.pass;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// GET /api/keys — List all keys
app.get("/api/keys", adminAuth, (req, res) => {
  const db = loadKeys();
  const keysWithStatus = db.keys.map((k) => ({
    ...k,
    expired: isExpired(k)
  }));
  res.json({ keys: keysWithStatus, maintenance: db.maintenance });
});

// POST /api/keys/add — Add new key
app.post("/api/keys/add", adminAuth, (req, res) => {
  const db = loadKeys();
  const { username, key, expiry, plan } = req.body;

  if (!username) return res.status(400).json({ error: "Username is required" });

  // Check duplicate username
  if (db.keys.find((k) => k.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username already exists" });
  }

  const newKey = {
    id: uuidv4(),
    username: username.trim(),
    key: key ? key.trim() : uuidv4().replace(/-/g, "").substring(0, 16).toUpperCase(),
    expiry: expiry || null,
    plan: plan || "Standard",
    active: true,
    uses: 0,
    created: new Date().toISOString(),
    last_seen: null
  };

  db.keys.push(newKey);
  saveKeys(db);

  res.json({ success: true, key: newKey });
});

// POST /api/keys/delete — Delete a key
app.post("/api/keys/delete", adminAuth, (req, res) => {
  const db = loadKeys();
  const { id } = req.body;

  const idx = db.keys.findIndex((k) => k.id === id);
  if (idx === -1) return res.status(404).json({ error: "Key not found" });

  db.keys.splice(idx, 1);
  saveKeys(db);
  res.json({ success: true });
});

// POST /api/keys/toggle — Enable/Disable a key
app.post("/api/keys/toggle", adminAuth, (req, res) => {
  const db = loadKeys();
  const { id } = req.body;

  const key = db.keys.find((k) => k.id === id);
  if (!key) return res.status(404).json({ error: "Key not found" });

  key.active = !key.active;
  saveKeys(db);
  res.json({ success: true, active: key.active });
});

// POST /api/maintenance — Toggle maintenance
app.post("/api/maintenance", adminAuth, (req, res) => {
  const db = loadKeys();
  db.maintenance = !db.maintenance;
  saveKeys(db);
  res.json({ success: true, maintenance: db.maintenance });
});

// POST /api/keys/reset-uses — Reset use count
app.post("/api/keys/reset-uses", adminAuth, (req, res) => {
  const db = loadKeys();
  const { id } = req.body;
  const key = db.keys.find((k) => k.id === id);
  if (!key) return res.status(404).json({ error: "Key not found" });
  key.uses = 0;
  saveKeys(db);
  res.json({ success: true });
});

// ─── Start Server ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Angry Mod License Server] Running on port ${PORT}`);
  console.log(`[Admin Panel] http://localhost:${PORT}/admin`);
  console.log(`[Admin Password] ${ADMIN_PASSWORD}`);
});
