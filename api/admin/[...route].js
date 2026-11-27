const crypto = require("node:crypto");

// Vercel must leave request bodies raw for JSON and binary image uploads.

const ALLOWED_TABLES = new Set([
  "catalog_entries", "announcements", "chat_rooms", "chat_messages",
  "profiles", "content_reports", "site_settings"
]);
const METHODS = {
  catalog_entries: new Set(["GET","POST","PATCH","DELETE","HEAD"]),
  announcements: new Set(["GET","POST","PATCH","DELETE","HEAD"]),
  chat_rooms: new Set(["GET","POST","PATCH","DELETE","HEAD"]),
  chat_messages: new Set(["GET","DELETE","HEAD"]),
  profiles: new Set(["GET","HEAD"]),
  content_reports: new Set(["GET","PATCH","HEAD"]),
  site_settings: new Set(["GET","POST","PATCH","HEAD"])
};
const COOKIE = "koku_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
function sign(value) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(value).digest("base64url");
}
function makeSession(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now()/1000) + SESSION_SECONDS })).toString("base64url");
  return payload + "." + sign(payload);
}
function getSession(req) {
  const token = getCookie(req, COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !process.env.ADMIN_SESSION_SECRET) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.email || !data.exp || data.exp < Math.floor(Date.now()/1000)) return null;
    return data;
  } catch { return null; }
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_SECONDS}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0`);
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

const attempts = new Map();
function rateLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.start > 10 * 60 * 1000) {
    attempts.set(ip, { start: now, count: 0 });
    return false;
  }
  return entry.count >= 10;
}
function noteFailure(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  let entry = attempts.get(ip);
  if (!entry || now - entry.start > 10 * 60 * 1000) entry = { start: now, count: 0 };
  entry.count += 1;
  attempts.set(ip, entry);
}

async function handler(req, res) {
  const parts = Array.isArray(req.query.route) ? req.query.route : String(req.query.route || "").split("/").filter(Boolean);
  const endpoint = parts[0] || "";
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configured = !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET && supabaseUrl && serviceKey);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!configured && endpoint !== "health") {
    return json(res, 503, { error: "Admin backend is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your hosting environment." });
  }
  if (endpoint === "health" && req.method === "GET") {
    return json(res, 200, { configured });
  }

  if (endpoint === "login" && req.method === "POST") {
    if (rateLimited(req)) return json(res, 429, { error: "Too many login attempts. Try again later." });
    let credentials;
    try { credentials = JSON.parse((await readBody(req)).toString("utf8") || "{}"); }
    catch { return json(res, 400, { error: "Invalid request." }); }
    const username = String(credentials.username || "").trim().toLowerCase();
    const expectedUsername = String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
    const password = String(credentials.password || "");
    if (!constantTimeEqual(username, expectedUsername) || !constantTimeEqual(password, process.env.ADMIN_PASSWORD || "")) {
      noteFailure(req);
      return json(res, 401, { error: "Invalid administrator username or password." });
    }
    setSessionCookie(res, makeSession(expectedUsername));
    return json(res, 200, { user: { username: expectedUsername } });
  }

  if (endpoint === "logout" && req.method === "POST") {
    clearSessionCookie(res);
    return json(res, 200, { success: true });
  }

  const session = getSession(req);
  if (endpoint === "session" && req.method === "GET") {
    if (!session) return json(res, 401, { error: "Not signed in." });
    return json(res, 200, { user: { username: session.email } });
  }
  if (!session) return json(res, 401, { error: "Administrator sign-in required." });

  if (endpoint === "db") {
    const table = parts[1] || "";
    const method = req.method.toUpperCase();
    if (!ALLOWED_TABLES.has(table) || !METHODS[table]?.has(method)) return json(res, 403, { error: "This database operation is not allowed." });
    const incoming = new URL(req.url, "https://local.invalid");
    const target = supabaseUrl + "/rest/v1/" + encodeURIComponent(table) + incoming.search;
    const headers = {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      Accept: req.headers.accept || "application/json",
      Prefer: req.headers.prefer || "return=representation"
    };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    const body = ["GET","HEAD"].includes(method) ? undefined : await readBody(req);
    try {
      const upstream = await fetch(target, { method, headers, body });
      const text = method === "HEAD" ? "" : await upstream.text();
      if (method === "HEAD") {
        const range = upstream.headers.get("content-range") || "";
        const count = range.includes("/") ? Number(range.split("/").pop()) : null;
        res.setHeader("Content-Range", range);
        return json(res, upstream.status, { count: Number.isFinite(count) ? count : 0 });
      }
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      return res.end(text || (upstream.ok ? "[]" : ""));
    } catch (error) {
      return json(res, 502, { error: "Database request failed: " + error.message });
    }
  }

  if (endpoint === "storage") {
    const bucket = parts[1] || "";
    const objectPath = parts.slice(2).join("/");
    if (bucket !== "site-media" || !objectPath || objectPath.split("/").some(x => x === ".." || !x)) {
      return json(res, 400, { error: "Invalid storage path." });
    }
    if (!["POST","PUT"].includes(req.method)) return json(res, 405, { error: "Method not allowed." });
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const target = supabaseUrl + "/storage/v1/object/" + bucket + "/" + encodedPath;
    const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": req.headers["content-type"] || "application/octet-stream", "x-upsert": req.headers["x-upsert"] || "false" };
    try {
      const upstream = await fetch(target, { method: "POST", headers, body: await readBody(req) });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      return res.end(text);
    } catch (error) {
      return json(res, 502, { error: "Image upload failed: " + error.message });
    }
  }

  return json(res, 404, { error: "Unknown admin endpoint." });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
