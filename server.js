const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("="); if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim(); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || 4242);
if (process.env.NODE_ENV === "production" && !process.env.SITEPIX_BETA_INVITE_CODE) {
  throw new Error("SITEPIX_BETA_INVITE_CODE is required in production to keep private-beta registration invite-only.");
}
const loginAttempts = new Map();
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const configuredDataDir = process.env.SITEPIX_DATA_DIR || "./data";
const DATA_DIR = path.isAbsolute(configuredDataDir) ? configuredDataDir : path.resolve(ROOT, configuredDataDir);
const DB_FILE = path.join(DATA_DIR, "db.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const TENANTS_DIR = path.join(DATA_DIR, "tenants");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TENANTS_DIR, { recursive: true });
const emptyWorkspace = () => ({
  leads: [], estimates: [], projects: [], posts: [], costs: [], referrals: [], media: [], travelEstimates: [],
  settings: { businessName: "Your Construction Business", trade: "General Contractor", serviceArea: "", autonomy: "Approval required", subscription: "Trial", measureBidEnabled: false, laborRate: 65, laborBurdenPct: 0, materialsMarkupPct: 20, homeBaseAddress: "", vehicleCostPerMile: 0.70, defaultRoundTrips: 1 },
  callLog: [], auditLog: []
});
function readAuth() {
  if (!fs.existsSync(AUTH_FILE)) return { users: {}, organizations: {}, sessions: {} };
  return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
}
function writeAuth(auth) { fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 }); fs.chmodSync(AUTH_FILE, 0o600); }
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const pair of raw.split(";")) { const i = pair.indexOf("="); if (i > 0 && pair.slice(0, i).trim() === name) return decodeURIComponent(pair.slice(i + 1).trim()); }
  return "";
}
function sessionFor(req) {
  const token = cookieValue(req, "sitepix_session"); if (!token) return null;
  const auth = readAuth(), hash = crypto.createHash("sha256").update(token).digest("hex"), entry = auth.sessions[hash];
  if (!entry || entry.expiresAt < Date.now() || !auth.users[entry.userId]) return null;
  return { ...auth.users[entry.userId], userId: entry.userId, sessionHash: hash };
}
function issueSession(res, userId) {
  const auth = readAuth(), token = crypto.randomBytes(32).toString("base64url"), hash = crypto.createHash("sha256").update(token).digest("hex");
  auth.sessions[hash] = { userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, createdAt: new Date().toISOString() };
  writeAuth(auth);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sitepix_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`);
}
function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function passwordMatches(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const actual = crypto.scryptSync(password, record.salt, 64), expected = Buffer.from(record.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function cleanOrgId(orgId) { return String(orgId).replace(/[^a-zA-Z0-9_-]/g, ""); }
function workspacePath(orgId) { return path.join(TENANTS_DIR, `${cleanOrgId(orgId)}.json`); }
function tenantMediaDir(orgId) { const dir = path.join(TENANTS_DIR, cleanOrgId(orgId), "media"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); return dir; }
async function parseMultipartFile(req, maxBytes = 50 * 1024 * 1024) {
  if (Number(req.headers["content-length"] || 0) > maxBytes) throw new Error("Upload exceeds the 50 MB limit.");
  const contentType = String(req.headers["content-type"] || "");
  const match = contentType.match(/boundary=(?:\"([^\"]+)\"|([^;]+))/i);
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !match) throw new Error("Expected multipart/form-data with a boundary.");
  const boundary = "--" + (match[1] || match[2]).trim();
  const raw = await rawBody(req, maxBytes);
  const chunks = raw.toString("latin1").split(boundary);
  let file = null; const fields = {};
  for (let part of chunks) {
    part = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    if (!part || part === "--") continue;
    const divider = part.indexOf("\r\n\r\n"); if (divider < 0) continue;
    const headers = part.slice(0, divider), payload = part.slice(divider + 4).replace(/\r\n$/, "");
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i); if (!disposition) continue;
    const nameMatch = disposition[1].match(/name=\"([^\"]*)\"/), filenameMatch = disposition[1].match(/filename=\"([^\"]*)\"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    if (filenameMatch) {
      const typeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      file = { originalName: filenameMatch[1], contentType: (typeMatch ? typeMatch[1].trim() : "application/octet-stream").toLowerCase(), buffer: Buffer.from(payload, "latin1") };
    } else fields[fieldName] = payload;
  }
  if (!file || !file.buffer.length) throw new Error("Choose a non-empty image or video file to upload.");
  return { file, fields };
}
function mediaTypeAllowed(file) {
  const b = file.buffer, t = file.contentType;
  if (t === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (t === "image/png") return b.length > 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (t === "image/webp") return b.length > 12 && b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP";
  if (["video/mp4", "video/quicktime"].includes(t)) return b.length > 12 && b.toString("ascii",4,8) === "ftyp";
  if (t === "video/webm") return b.length > 4 && b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if (t === "image/heic" || t === "image/heif") return b.length > 12 && b.toString("ascii",4,8) === "ftyp";
  return false;
}
function readDb(req) {
  if (!req || !req.sitepixOrgId) return emptyWorkspace();
  const file = workspacePath(req.sitepixOrgId);
  if (!fs.existsSync(file)) { const blank = emptyWorkspace(); fs.writeFileSync(file, JSON.stringify(blank, null, 2), { mode: 0o600 }); fs.chmodSync(file, 0o600); return blank; }
  return { ...emptyWorkspace(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
}
function writeDb(db, req) {
  if (!req || !req.sitepixOrgId) throw new Error("Workspace context is required.");
  const file = workspacePath(req.sitepixOrgId);
  fs.writeFileSync(file, JSON.stringify(db, null, 2), { mode: 0o600 }); fs.chmodSync(file, 0o600);
}
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
function json(res, status, body) {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function rawBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", chunk => { size += chunk.length; if (size > limit) { reject(new Error("Request too large")); req.destroy(); return; } chunks.push(chunk); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 2_000_000) reject(new Error("Request too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
  });
}
function id(prefix) { return prefix + "_" + crypto.randomBytes(5).toString("hex"); }
function safeNumber(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, service: "trades-secretary", version: "0.4.2" });
    if (req.method === "GET" && url.pathname === "/api/config/public") return json(res, 200, { betaInviteRequired: Boolean(process.env.SITEPIX_BETA_INVITE_CODE) });
    if (req.method === "POST" && ["/api/auth/register", "/api/auth/login"].includes(url.pathname)) {
      const ip = String(process.env.TRUST_PROXY === "1" && req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"] : req.socket.remoteAddress || "unknown").split(",")[0].trim();
      const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
      if (attempts.resetAt < Date.now()) { attempts.count = 0; attempts.resetAt = Date.now() + 15 * 60 * 1000; }
      if (attempts.count >= 15) return json(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
      const b = await body(req), email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: "Enter a valid email address." });
      const auth = readAuth();
      if (url.pathname === "/api/auth/register") {
        const requiredInvite = String(process.env.SITEPIX_BETA_INVITE_CODE || "");
        if (requiredInvite) {
          const suppliedInvite = String(b.betaInviteCode || "");
          const expected = Buffer.from(requiredInvite, "utf8"), supplied = Buffer.from(suppliedInvite, "utf8");
          const validInvite = expected.length === supplied.length && expected.length > 0 && crypto.timingSafeEqual(expected, supplied);
          if (!validInvite) { attempts.count++; loginAttempts.set(ip, attempts); return json(res, 403, { error: "A valid private-beta invite code is required to create an account." }); }
        }
        if (password.length < 12 || password.length > 256) return json(res, 400, { error: "Use a password between 12 and 256 characters." });
        if (Object.values(auth.users).some(u => u.email === email)) { attempts.count++; loginAttempts.set(ip, attempts); return json(res, 409, { error: "An account with this email already exists. Sign in instead." }); }
        const userId = id("user"), orgId = id("org"), orgName = String(b.businessName || "My Construction Business").trim().slice(0, 160) || "My Construction Business";
        const record = passwordRecord(password);
        auth.users[userId] = { email, password: record, organizationId: orgId, role: "owner", createdAt: new Date().toISOString() };
        auth.organizations[orgId] = { id: orgId, name: orgName, createdAt: new Date().toISOString(), ownerId: userId };
        writeAuth(auth);
        const tenantFile = workspacePath(orgId); fs.writeFileSync(tenantFile, JSON.stringify({ ...emptyWorkspace(), settings: { ...emptyWorkspace().settings, businessName: orgName } }, null, 2), { mode: 0o600 });
        issueSession(res, userId); loginAttempts.delete(ip);
        return json(res, 201, { user: { id: userId, email, role: "owner" }, organization: auth.organizations[orgId] });
      }
      const found = Object.entries(auth.users).find(([, u]) => u.email === email);
      if (!found || !passwordMatches(password, found[1].password)) { attempts.count++; loginAttempts.set(ip, attempts); return json(res, 401, { error: "Email or password is incorrect." }); }
      issueSession(res, found[0]); loginAttempts.delete(ip);
      return json(res, 200, { user: { id: found[0], email, role: found[1].role }, organization: auth.organizations[found[1].organizationId] || null });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const user = sessionFor(req); if (!user) return json(res, 401, { error: "Sign in to continue." });
      const auth = readAuth(); return json(res, 200, { user: { id: user.userId, email: user.email, role: user.role }, organization: auth.organizations[user.organizationId] || null });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = cookieValue(req, "sitepix_session"), auth = readAuth();
      if (token) delete auth.sessions[crypto.createHash("sha256").update(token).digest("hex")];
      writeAuth(auth); const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", `sitepix_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/") && !["/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/billing/webhook", "/api/telephony/incoming", "/api/telephony/recording-complete", "/api/telephony/voice-turn", "/api/telephony/handoff-complete"].includes(url.pathname)) {
      const user = sessionFor(req);
      if (!user) return json(res, 401, { error: "Sign in to continue." });
      req.sitepixUserId = user.userId; req.sitepixOrgId = user.organizationId; req.sitepixRole = user.role;
    }
    if (req.method === "GET" && url.pathname === "/api/media") {
      const db = readDb(req); return json(res, 200, { media: db.media || [] });
    }
    if (req.method === "POST" && url.pathname === "/api/media/upload") {
      if (Number(req.headers["content-length"] || 0) > 50 * 1024 * 1024) return json(res, 413, { error: "Upload exceeds the 50 MB per-file limit." });
      const { file, fields } = await parseMultipartFile(req);
      if (!mediaTypeAllowed(file)) return json(res, 415, { error: "Unsupported file type or invalid file signature. Use JPEG, PNG, WebP, HEIC/HEIF, MP4, QuickTime, or WebM." });
      const extension = ({ "image/jpeg":".jpg", "image/png":".png", "image/webp":".webp", "image/heic":".heic", "image/heif":".heif", "video/mp4":".mp4", "video/quicktime":".mov", "video/webm":".webm" })[file.contentType];
      const db = readDb(req); db.media = db.media || [];
      const totalBytes = db.media.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (totalBytes + file.buffer.length > 500 * 1024 * 1024) return json(res, 413, { error: "This workspace has reached the 500 MB pilot storage limit. Delete unused media or use a configured production storage service." });
      const mediaId = id("media"), storageName = crypto.randomBytes(18).toString("hex") + extension, dir = tenantMediaDir(req.sitepixOrgId), storedPath = path.join(dir, storageName);
      fs.writeFileSync(storedPath, file.buffer, { mode: 0o600, flag: "wx" }); fs.chmodSync(storedPath, 0o600);
      const originalName = path.basename(String(file.originalName || "upload").replace(/\\/g, "/").replace(/[\x00-\x1f\x7f]/g, "")).slice(0,180) || "upload";
      const record = { id: mediaId, fileName: originalName, storageName, contentType: file.contentType, size: file.buffer.length, kind: ["walkthrough", "project", "marketing"].includes(fields.kind) ? fields.kind : "project", createdAt: new Date().toISOString(), processingStatus: "stored; no AI enhancement or measurement has run" };
      db.media.unshift(record); db.auditLog = db.auditLog || []; db.auditLog.unshift({ id: id("audit"), actorId: req.sitepixUserId, action: "media.upload", entityId: mediaId, createdAt: new Date().toISOString() }); writeDb(db, req);
      return json(res, 201, { media: { ...record, downloadUrl: `/api/media/${mediaId}/download` } });
    }
    const mediaDelete = url.pathname.match(/^\/api\/media\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "DELETE" && mediaDelete) {
      const db = readDb(req), index = (db.media || []).findIndex(m => m.id === mediaDelete[1]);
      if (index < 0) return json(res, 404, { error: "Media not found in this workspace." });
      const record = db.media[index]; fs.rmSync(path.join(tenantMediaDir(req.sitepixOrgId), path.basename(record.storageName)), { force: true });
      db.media.splice(index, 1); for (const project of db.projects || []) if (project.mediaId === record.id) { project.mediaId = null; project.videoName = ""; }
      db.auditLog = db.auditLog || []; db.auditLog.unshift({ id: id("audit"), actorId: req.sitepixUserId, action: "media.delete", entityId: record.id, createdAt: new Date().toISOString() }); writeDb(db, req);
      return json(res, 200, { deleted: true, id: record.id });
    }
    const mediaDownload = url.pathname.match(/^\/api\/media\/([a-zA-Z0-9_-]+)\/download$/);
    if (req.method === "GET" && mediaDownload) {
      const db = readDb(req), record = (db.media || []).find(m => m.id === mediaDownload[1]);
      if (!record) return json(res, 404, { error: "Media not found in this workspace." });
      const file = path.join(tenantMediaDir(req.sitepixOrgId), path.basename(record.storageName));
      let stat; try { stat = fs.statSync(file); } catch { return json(res, 404, { error: "Stored media file was not found." }); }
      securityHeaders(res); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("Content-Type", record.contentType); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Disposition", `inline; filename=\"${String(record.fileName).replace(/[\"\r\n]/g, "_")}\"`); res.setHeader("Accept-Ranges", "bytes");
      const range = String(req.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2] || 0));
        const requestedEnd = range[2] ? Number(range[2]) : stat.size - 1;
        const end = Math.min(requestedEnd, stat.size - 1);
        if (start < 0 || end < start || start >= stat.size) { res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); return res.end(); }
        res.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` }); return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { "Content-Length": stat.size }); return fs.createReadStream(file).pipe(res);
    }
    if (req.method === "GET" && url.pathname === "/api/integrations/status") {
      const configured = (keys) => keys.every(k => Boolean(process.env[k]));
      const twilioBaseConfigured = configured(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_INCOMING_WEBHOOK_URL"]) && Boolean(process.env.TWILIO_ORGANIZATION_ID || process.env.TWILIO_NUMBER_ORG_MAP);
      const twilioAiConfigured = twilioBaseConfigured && configured(["OPENAI_API_KEY", "TWILIO_VOICE_TURN_WEBHOOK_URL"]);
      const twilioVoicemailConfigured = twilioBaseConfigured && Boolean(process.env.TWILIO_RECORDING_CALLBACK_URL);
      const stripeConfigured = configured(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_SOLO", "STRIPE_PRICE_PRO", "STRIPE_PRICE_GROWTH"]);
      return json(res, 200, {
        mode: "pilot",
        providers: {
          postgres: { configured: false, credentialsPresent: configured(["DATABASE_URL"]), status: configured(["DATABASE_URL"]) ? "connection string present; runtime still uses JSON files" : "not-configured; runtime still uses JSON files" },
          openai: { configured: configured(["OPENAI_API_KEY"]), status: configured(["OPENAI_API_KEY"]) ? "configured" : "not-configured" },
          stripe: { configured: stripeConfigured, status: stripeConfigured ? "credentials and prices present; test checkout and webhook before launch" : "not-configured; secret key, webhook secret, and monthly base Price IDs required" },
          twilio: { configured: twilioAiConfigured || twilioVoicemailConfigured, status: twilioAiConfigured ? "AI voice prototype configured; live call, privacy, and handoff testing required" : (twilioVoicemailConfigured ? "voicemail capture configured; AI conversation not enabled" : "not-configured; credentials, exact webhook URLs, and workspace routing required") },
          social: { configured: configured(["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "META_GRAPH_API_VERSION"]), status: configured(["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "META_GRAPH_API_VERSION"]) ? "Facebook Page text publishing configured; approval required" : "not-configured; Page token and Graph API version required" },
          objectStorage: { configured: false, credentialsPresent: configured(["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]), status: "runtime uses private local files; S3 adapter not implemented" },
          measurement: { configured: false, status: "not-connected; human verification required" },
          supplierPricing: { configured: configured(["LOWES_CLIENT_ID", "LOWES_ACCESS_TOKEN", "LOWES_API_BASE_URL"]), status: configured(["LOWES_CLIENT_ID", "LOWES_ACCESS_TOKEN", "LOWES_API_BASE_URL"]) ? "Lowe's authorized partner API credentials present; confirm permissions and test live responses" : "retailer search links available; live Lowe's prices require partner approval and credentials; Home Depot/Menards/Ace direct integrations are not configured" },
          routing: { configured: configured(["GOOGLE_MAPS_API_KEY"]), status: configured(["GOOGLE_MAPS_API_KEY"]) ? "Google Routes API key present; verify Routes API enabled, billing, restrictions, and route results" : "contractor-entered distance/time fallback active; set GOOGLE_MAPS_API_KEY for route distance/time lookup" }
        }
      });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/marketing-draft") {
      if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: "AI provider is not configured. Set OPENAI_API_KEY in the server environment." });
      const b = await body(req);
      const businessName = String(b.businessName || "the contractor").slice(0,160);
      const trade = String(b.trade || "construction").slice(0,100);
      const project = String(b.project || "a recent project").slice(0,300);
      const serviceArea = String(b.serviceArea || "the local area").slice(0,160);
      const facts = String(b.verifiedFacts || "").slice(0,1500);
      const prompt = `Write one concise, professional local social-media post for ${businessName}, a ${trade} business serving ${serviceArea}. Project: ${project}. Verified facts supplied by the contractor: ${facts || "No project-specific facts supplied; keep claims generic."}. Do not invent prices, guarantees, customer testimonials, certifications, project details, reviews, or outcomes. Do not claim an image/video was reviewed. Include a low-pressure call to action. Return only the post copy.`;
      const aiRes = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: prompt, max_output_tokens: 300 }), signal: AbortSignal.timeout(15000) });
      const aiData = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) return json(res, 502, { error: "AI provider request failed.", providerStatus: aiRes.status });
      const caption = (aiData.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n").trim();
      if (!caption) return json(res, 502, { error: "AI provider returned no post text." });
      return json(res, 200, { caption, status: "Draft for approval", provider: "OpenAI Responses API", approvalRequired: true, notice: "Review factual accuracy, image consent, platform rules, and claims before publishing." });
    }
    if (req.method === "POST" && url.pathname === "/api/social/facebook/publish") {
      if (!process.env.META_PAGE_ID || !process.env.META_PAGE_ACCESS_TOKEN || !process.env.META_GRAPH_API_VERSION) return json(res, 503, { error: "Facebook Page publishing is not configured. Set META_PAGE_ID, META_PAGE_ACCESS_TOKEN, and META_GRAPH_API_VERSION securely." });
      const b = await body(req), db = readDb(req), post = db.posts.find(x => x.id === String(b.postId || ""));
      if (!post) return json(res, 404, { error: "Marketing draft not found in this workspace." });
      if (post.status !== "Approved") return json(res, 409, { error: "Only drafts explicitly marked Approved can be published." });
      if (!String(post.caption || "").trim()) return json(res, 400, { error: "The post caption is empty." });
      const form = new URLSearchParams({ message: post.caption, access_token: process.env.META_PAGE_ACCESS_TOKEN });
      const graphVersion = String(process.env.META_GRAPH_API_VERSION).replace(/^v?/, "v");
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(process.env.META_PAGE_ID)}/feed`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.id) return json(res, 502, { error: "Facebook did not accept the post. Check Page permissions, token expiry, and API version.", providerStatus: response.status, providerCode: result.error && result.error.code });
      post.status = "Published"; post.platform = "Facebook"; post.publishedAt = new Date().toISOString(); post.externalPostId = result.id;
      db.auditLog = db.auditLog || []; db.auditLog.unshift({ id: id("audit"), actorId: req.sitepixUserId, action: "social.facebook.publish", entityId: post.id, createdAt: new Date().toISOString() });
      writeDb(db, req);
      return json(res, 200, { published: true, postId: post.id, externalPostId: result.id, publishedAt: post.publishedAt });
    }
    if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: "Stripe is not configured. Set test-mode credentials and Price IDs first." });
      const b = await body(req);
      const currentWorkspace = readDb(req);
      if (currentWorkspace.billing && ["active", "trialing"].includes(currentWorkspace.billing.status) && currentWorkspace.billing.customerId) return json(res, 409, { error: "This workspace already has a billing subscription. Use the billing portal to manage or change it instead of creating a duplicate." });
      const plan = String(b.plan || "Pro");
      const planPrices = { Solo: process.env.STRIPE_PRICE_SOLO, Pro: process.env.STRIPE_PRICE_PRO, Growth: process.env.STRIPE_PRICE_GROWTH };
      if (!planPrices[plan]) return json(res, 400, { error: "Choose a configured plan: Solo, Pro, or Growth." });
      const items = [{ price: planPrices[plan], quantity: 1 }];
      if (b.measureBidEnabled) {
        if (!process.env.STRIPE_PRICE_MEASURE_BID) return json(res, 503, { error: "Measure & Bid add-on Price ID is not configured." });
        items.push({ price: process.env.STRIPE_PRICE_MEASURE_BID, quantity: 1 });
      }
      const form = new URLSearchParams({ mode: "subscription", success_url: `${process.env.SITEPIX_BASE_URL || `http://localhost:${PORT}`}/?billing=success`, cancel_url: `${process.env.SITEPIX_BASE_URL || `http://localhost:${PORT}`}/?billing=cancel`, "metadata[plan]": plan, "metadata[measureBidEnabled]": String(Boolean(b.measureBidEnabled)), "metadata[organizationId]": req.sitepixOrgId, "subscription_data[metadata][organizationId]": req.sitepixOrgId, "subscription_data[metadata][plan]": plan, "subscription_data[metadata][measureBidEnabled]": String(Boolean(b.measureBidEnabled)) });
      items.forEach((item, i) => { form.set(`line_items[${i}][price]`, item.price); form.set(`line_items[${i}][quantity]`, String(item.quantity)); });
      if (b.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) form.set("customer_email", String(b.email).slice(0,254));
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000) });
      const stripeData = await stripeRes.json().catch(() => ({}));
      if (!stripeRes.ok || !stripeData.url) return json(res, 502, { error: "Stripe Checkout session could not be created.", providerStatus: stripeRes.status });
      return json(res, 200, { url: stripeData.url, sessionId: stripeData.id, mode: "subscription" });
    }
    if (req.method === "POST" && url.pathname === "/api/billing/portal") {
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: "Stripe is not configured." });
      const workspace = readDb(req), customerId = workspace.billing && workspace.billing.customerId;
      if (!customerId) return json(res, 409, { error: "No Stripe customer is linked to this workspace yet." });
      const form = new URLSearchParams({ customer: customerId, return_url: `${process.env.SITEPIX_BASE_URL || `http://localhost:${PORT}`}/` });
      const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) return json(res, 502, { error: "Stripe billing portal could not be created.", providerStatus: response.status });
      return json(res, 200, { url: result.url });
    }
    if (req.method === "POST" && url.pathname === "/api/billing/webhook") {
      if (!process.env.STRIPE_WEBHOOK_SECRET) return json(res, 503, { error: "Stripe webhook signing secret is not configured." });
      const signature = String(req.headers["stripe-signature"] || "");
      const parts = Object.fromEntries(signature.split(",").map(part => part.split("=")));
      if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return json(res, 400, { error: "Invalid or expired Stripe signature." });
      const raw = await rawBody(req);
      const expected = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${parts.t}.`).update(raw).digest("hex");
      const a = Buffer.from(expected, "hex"), c = Buffer.from(parts.v1, "hex");
      if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return json(res, 400, { error: "Stripe signature verification failed." });
      let event; try { event = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "Invalid webhook JSON." }); }
      const authForEvents = readAuth();
      authForEvents.processedStripeEvents = authForEvents.processedStripeEvents || {};
      if (authForEvents.processedStripeEvents[event.id]) return json(res, 200, { received: true, duplicate: true, eventType: event.type });
      authForEvents.processedStripeEvents[event.id] = { receivedAt: new Date().toISOString(), type: event.type };
      const eventIds = Object.keys(authForEvents.processedStripeEvents);
      for (const oldId of eventIds.slice(0, Math.max(0, eventIds.length - 1000))) delete authForEvents.processedStripeEvents[oldId];
      const object = event.data && event.data.object || {};
      const orgId = object.metadata && object.metadata.organizationId;
      if (orgId && ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        const tenantReq = { sitepixOrgId: orgId };
        const tenant = readDb(tenantReq);
        const status = event.type === "customer.subscription.deleted" ? "canceled" : String(object.status || (event.type === "checkout.session.completed" ? "checkout-complete" : "unknown"));
        tenant.billing = { ...(tenant.billing || {}), status, customerId: object.customer || (tenant.billing || {}).customerId || null, subscriptionId: object.subscription || object.id || (tenant.billing || {}).subscriptionId || null, plan: object.metadata.plan || (tenant.billing || {}).plan || null, measureBidEnabled: String(object.metadata.measureBidEnabled || "false") === "true", lastEventId: event.id, updatedAt: new Date().toISOString() };
        tenant.settings.subscription = ["active", "trialing"].includes(status) && ["Solo", "Pro", "Growth"].includes(tenant.billing.plan) ? tenant.billing.plan : "Trial";
        tenant.settings.measureBidEnabled = tenant.billing.measureBidEnabled && ["active", "trialing"].includes(status);
        writeDb(tenant, tenantReq);
      }
      writeAuth(authForEvents);
      console.log("Verified Stripe event received:", event.type, event.id);
      return json(res, 200, { received: true, eventType: event.type, entitlementSync: orgId ? "processed" : "no-organization-metadata" });
    }
    if (req.method === "POST" && ["/api/telephony/incoming", "/api/telephony/recording-complete", "/api/telephony/voice-turn", "/api/telephony/handoff-complete"].includes(url.pathname)) {
      if (!process.env.TWILIO_AUTH_TOKEN) return json(res, 503, { error: "Twilio is not configured." });
      const raw = await rawBody(req, 256_000);
      const params = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
      const publicUrl = url.pathname.endsWith("/incoming") ? process.env.TWILIO_INCOMING_WEBHOOK_URL : (url.pathname.endsWith("/voice-turn") ? process.env.TWILIO_VOICE_TURN_WEBHOOK_URL : (url.pathname.endsWith("/handoff-complete") ? process.env.TWILIO_HANDOFF_WEBHOOK_URL : process.env.TWILIO_RECORDING_CALLBACK_URL));
      if (!publicUrl) return json(res, 503, { error: url.pathname.endsWith("/incoming") ? "Set TWILIO_INCOMING_WEBHOOK_URL to the exact public HTTPS webhook URL." : (url.pathname.endsWith("/voice-turn") ? "Set TWILIO_VOICE_TURN_WEBHOOK_URL to the exact public HTTPS callback URL." : (url.pathname.endsWith("/handoff-complete") ? "Set TWILIO_HANDOFF_WEBHOOK_URL to the exact public HTTPS callback URL." : "Set TWILIO_RECORDING_CALLBACK_URL to the exact public HTTPS callback URL.")) });
      const signatureBase = publicUrl + Object.keys(params).sort().map(k => k + params[k]).join("");
      const expected = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(signatureBase).digest("base64");
      const supplied = String(req.headers["x-twilio-signature"] || "");
      if (Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return json(res, 403, { error: "Twilio signature validation failed." });
      let numberMap = {}; try { numberMap = JSON.parse(process.env.TWILIO_NUMBER_ORG_MAP || "{}"); } catch { return json(res, 503, { error: "TWILIO_NUMBER_ORG_MAP must be valid JSON mapping Twilio phone numbers to organization IDs." }); }
      const orgId = numberMap[params.To] || process.env.TWILIO_ORGANIZATION_ID;
      if (!orgId || !readAuth().organizations[orgId]) return json(res, 503, { error: "No valid workspace is mapped to this Twilio number. Configure TWILIO_NUMBER_ORG_MAP or TWILIO_ORGANIZATION_ID." });
      if (url.pathname.endsWith("/incoming")) {
        const tenantReq = { sitepixOrgId: orgId }, workspace = readDb(tenantReq);
        const businessName = String(workspace.settings.businessName || "our construction team").replace(/[&<>"']/g, "");
        const callSid = String(params.CallSid || "").slice(0,80);
        let call = workspace.callLog.find(c => c.callSid === callSid);
        if (!call) {
          call = { id: id("call"), callSid, caller: String(params.From || "Unknown caller").slice(0,80), calledNumber: String(params.To || "").slice(0,80), result: "Call in progress", summary: "AI receptionist conversation in progress.", transcript: [], when: new Date().toISOString(), reviewed: false };
          workspace.callLog.unshift(call); writeDb(workspace, tenantReq);
        }
        if (process.env.OPENAI_API_KEY && process.env.TWILIO_VOICE_TURN_WEBHOOK_URL) {
          const action = String(process.env.TWILIO_VOICE_TURN_WEBHOOK_URL).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          const greeting = `Thanks for calling ${businessName}. I am the AI assistant. Your spoken responses may be transcribed and stored so the business can follow up. Say that you would like a person at any time. How can I help with your construction project today?`;
          const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="6"><Say voice="Polly.Joanna">${greeting}</Say></Gather><Say voice="Polly.Joanna">I did not hear a response. Please call back or leave a voicemail after the tone.</Say>${process.env.TWILIO_RECORDING_CALLBACK_URL ? `<Record maxLength="90" playBeep="true" action="${String(process.env.TWILIO_RECORDING_CALLBACK_URL).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" method="POST"/>` : "<Hangup/>"}</Response>`;
          res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
        }
        if (!process.env.TWILIO_RECORDING_CALLBACK_URL) return json(res, 503, { error: "Configure OPENAI_API_KEY plus TWILIO_VOICE_TURN_WEBHOOK_URL for AI voice, or TWILIO_RECORDING_CALLBACK_URL for voicemail-only mode." });
        const action = String(process.env.TWILIO_RECORDING_CALLBACK_URL).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Thanks for calling ${businessName}. This is an automated voicemail system. Your message will be recorded so the business can follow up. Please leave your name, callback number, and a brief description of the project after the tone. Do not include sensitive personal information.</Say><Record maxLength="90" playBeep="true" action="${action}" method="POST"/></Response>`;
        res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
      }
      const tenantReq = { sitepixOrgId: orgId }, db = readDb(tenantReq);
      if (url.pathname.endsWith("/voice-turn")) {
        const callSid = String(params.CallSid || "").slice(0,80), call = db.callLog.find(c => c.callSid === callSid);
        if (!call) return json(res, 404, { error: "Call session was not found for this workspace." });
        const utterance = String(params.SpeechResult || "").trim().slice(0,1200);
        const escXml = value => String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&apos;" }[c]));
        if (/\b(person|human|representative|real person|manager)\b/i.test(utterance) && process.env.SITEPIX_HUMAN_HANDOFF_NUMBER && process.env.TWILIO_HANDOFF_WEBHOOK_URL) {
          call.result = "Human handoff requested"; call.summary = "Caller requested a person; handoff attempted."; call.transcript = [...(call.transcript || []), { role: "user", text: utterance }].slice(-30); writeDb(db, tenantReq);
          const handoffAction = escXml(process.env.TWILIO_HANDOFF_WEBHOOK_URL);
          const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>I'll try to connect you to a team member now.</Say><Dial timeout="20" action="${handoffAction}" method="POST">${escXml(process.env.SITEPIX_HUMAN_HANDOFF_NUMBER)}</Dial></Response>`;
          res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
        }
        call.transcript = call.transcript || []; if (utterance) call.transcript.push({ role: "user", text: utterance });
        const history = call.transcript.slice(-16).map(m => `${m.role === "assistant" ? "Receptionist" : "Caller"}: ${m.text}`).join("\n");
        const prompt = `You are SITEPIX AI, a polite AI receptionist for ${db.settings.businessName || "a construction business"}, specializing in ${db.settings.trade || "construction"} and serving ${db.settings.serviceArea || "the local area"}. Use brief spoken sentences. Ask one question at a time to understand the project, caller name, callback number, location, and desired timeline. Never invent prices, availability, licenses, warranties, or project capabilities. Do not promise a quote; say a contractor will review it. Do not request sensitive personal data. If asked a question that needs a contractor, say the team will follow up. Recent conversation:\n${history}\nRespond with only the next sentence or two to speak.`;
        let reply = "Thanks for explaining that. I have recorded your inquiry for the team. Please leave your name and callback number after the tone so they can follow up.";
        if (process.env.OPENAI_API_KEY) {
          try {
            const aiRes = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", input: prompt, max_output_tokens: 120 }), signal: AbortSignal.timeout(9000) });
            const aiData = await aiRes.json().catch(() => ({}));
            if (aiRes.ok) { const generated = (aiData.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join(" ").trim(); if (generated) reply = generated.slice(0,900); }
          } catch { /* Keep the safe fallback response when the AI provider is unavailable. */ }
        }
        call.transcript.push({ role: "assistant", text: reply }); call.transcript = call.transcript.slice(-30); call.summary = call.transcript.map(m => `${m.role}: ${m.text}`).join(" | ").slice(0,3000); call.result = "AI receptionist conversation"; call.updatedAt = new Date().toISOString(); writeDb(db, tenantReq);
        const action = String(process.env.TWILIO_VOICE_TURN_WEBHOOK_URL).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const noResponse = process.env.TWILIO_RECORDING_CALLBACK_URL ? `<Say voice="Polly.Joanna">I did not hear a response. Please leave a voicemail after the tone.</Say><Record maxLength="90" playBeep="true" action="${escXml(process.env.TWILIO_RECORDING_CALLBACK_URL)}" method="POST"/>` : `<Say voice="Polly.Joanna">I did not hear a response. Please call back later. Goodbye.</Say><Hangup/>`;
        const gather = `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="6"><Say voice="Polly.Joanna">${escXml(reply)}</Say></Gather>${noResponse}`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${gather}</Response>`;
        res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
      }
      if (url.pathname.endsWith("/handoff-complete")) {
        const call = (db.callLog || []).find(c => c.callSid === String(params.CallSid || ""));
        if (call) { call.result = params.DialCallStatus === "completed" ? "Human handoff completed" : "Human handoff unavailable"; call.summary = params.DialCallStatus === "completed" ? "Caller was connected to the configured team number." : "The team did not answer; follow-up is needed."; call.updatedAt = new Date().toISOString(); writeDb(db, tenantReq); }
        const say = params.DialCallStatus === "completed" ? "Thank you for calling. Goodbye." : "The team is unavailable right now.";
        const fallback = params.DialCallStatus === "completed" ? "<Hangup/>" : (process.env.TWILIO_RECORDING_CALLBACK_URL ? `<Say>Please leave a message after the tone.</Say><Record maxLength="90" playBeep="true" action="${String(process.env.TWILIO_RECORDING_CALLBACK_URL).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" method="POST"/>` : "<Say>Please call back later. Goodbye.</Say><Hangup/>");
        const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${say}</Say>${fallback}</Response>`;
        res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
      }
      const call = { id: id("call"), callSid: String(params.CallSid || "").slice(0,80), caller: String(params.From || "Unknown caller").slice(0,80), calledNumber: String(params.To || "").slice(0,80), result: "Voicemail received", summary: `Recording received (${String(params.RecordingDuration || "unknown").slice(0,10)} seconds). Review caller details and follow up.`, recordingUrl: String(params.RecordingUrl || "").slice(0,500), recordingDuration: Number(params.RecordingDuration || 0) || 0, when: new Date().toISOString(), reviewed: false };
      db.callLog.unshift(call); db.auditLog = db.auditLog || []; db.auditLog.unshift({ id: id("audit"), actorId: "twilio-webhook", action: "telephony.voicemail.received", entityId: call.id, createdAt: new Date().toISOString() }); writeDb(db, tenantReq);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Your message has been received. Goodbye.</Say></Response>`;
      res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" }); return res.end(xml);
    }
    if (url.pathname.startsWith("/api/")) {
      const db = readDb(req);
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, db);
      if (req.method === "POST" && url.pathname.startsWith("/api/calls/") && url.pathname.endsWith("/convert-to-lead")) {
        const parts = url.pathname.split("/"); const callId = parts[parts.length - 2];
        const call = (db.callLog || []).find(c => c.id === callId);
        if (!call) return json(res, 404, { error: "Call record not found." });
        if (call.leadId) return json(res, 200, { alreadyConverted: true, lead: (db.leads || []).find(l => l.id === call.leadId) || null });
        const transcript = (call.transcript || []).map(m => `${m.role === "assistant" ? "Receptionist" : "Caller"}: ${m.text}`).join("\n");
        const lead = { id: id("lead"), name: "Phone inquiry", phone: String(call.caller || "").slice(0,80), trade: "Construction inquiry", source: call.result && call.result.includes("Voicemail") ? "Phone voicemail" : "AI Receptionist", status: "New", notes: String([call.summary || "Phone inquiry requiring follow-up", transcript].filter(Boolean).join("\n\n")).slice(0,2000), createdAt: new Date().toISOString() };
        db.leads.unshift(lead); call.leadId = lead.id; call.reviewed = true; db.auditLog = db.auditLog || []; db.auditLog.unshift({ id: id("audit"), actorId: req.sitepixUserId, action: "telephony.convert_to_lead", entityId: call.id, createdAt: new Date().toISOString() });
        writeDb(db, req); return json(res, 201, { lead });
      }
      if (req.method === "GET" && url.pathname === "/api/data/export") {
        const auth = readAuth(), org = auth.organizations[req.sitepixOrgId];
        return json(res, 200, { exportedAt: new Date().toISOString(), organization: org, workspace: db });
      }
      if (req.method === "POST" && url.pathname === "/api/account/delete") {
        const b = await body(req), auth = readAuth(), user = auth.users[req.sitepixUserId];
        if (!user || !passwordMatches(String(b.password || ""), user.password)) return json(res, 403, { error: "Enter your current password to confirm account deletion." });
        if (user.role !== "owner") return json(res, 403, { error: "Only the workspace owner can delete this workspace." });
        const orgId = user.organizationId;
        for (const [uid, u] of Object.entries(auth.users)) if (u.organizationId === orgId) delete auth.users[uid];
        for (const [hash, session] of Object.entries(auth.sessions)) if (!auth.users[session.userId]) delete auth.sessions[hash];
        delete auth.organizations[orgId]; writeAuth(auth);
        fs.rmSync(workspacePath(orgId), { force: true }); fs.rmSync(path.join(TENANTS_DIR, cleanOrgId(orgId)), { recursive: true, force: true });
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader("Set-Cookie", `sitepix_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
        return json(res, 200, { deleted: true });
      }
      if (req.method === "GET" && url.pathname === "/api/costs") return json(res, 200, { costs: db.costs || [] });
      if (req.method === "POST" && url.pathname === "/api/costs") {
        const b = await body(req), price = Number(b.price);
        if (!String(b.item || "").trim() || !Number.isFinite(price) || price < 0) return json(res, 400, { error: "Enter an item and a valid non-negative price." });
        const cost = { id: id("cost"), item: String(b.item).slice(0,160), price, unit: String(b.unit || "unit").slice(0,40), source: String(b.source || "Contractor-entered; not independently verified").slice(0,200), sourceDate: String(b.sourceDate || "").slice(0,40), postalCode: String(b.postalCode || "").slice(0,20), deliveryAvailable: ["yes","no","unknown"].includes(String(b.deliveryAvailable || "unknown")) ? String(b.deliveryAvailable || "unknown") : "unknown", createdAt: new Date().toISOString(), verified: false };
        db.costs.unshift(cost); writeDb(db, req); return json(res, 201, cost);
      }
      if (req.method === "GET" && url.pathname === "/api/suppliers/search") {
        const query = String(url.searchParams.get("q") || "").trim().slice(0,160);
        const postalCode = String(url.searchParams.get("zip") || "").trim().slice(0,20);
        if (!query) return json(res, 400, { error: "Enter a material or product to search." });
        const q = encodeURIComponent(query), z = encodeURIComponent(postalCode);
        const links = [
          { supplier: "Lowe's", url: `https://www.lowes.com/search?searchTerm=${q}${postalCode ? `&location=${z}` : ""}`, note: "Store-specific price and stock require a valid local store and, for direct data, authorized partner API access." },
          { supplier: "The Home Depot", url: `https://www.homedepot.com/s/${q}`, note: "Confirm selected store, delivery address, quantity pricing, and delivery fees at checkout." },
          { supplier: "Menards", url: `https://www.menards.com/main/search.html?search=${q}`, note: "Availability and delivery depend on the selected market; programmatic API access requires authorization." },
          { supplier: "Ace Hardware", url: `https://www.acehardware.com/search?query=${q}`, note: "Inventory and delivery are store-dependent; confirm with the participating local store." },
          { supplier: "Local supplier map search", url: `https://www.google.com/maps/search/${q}+building+materials${postalCode ? "/" + z : ""}`, note: "Find local lumberyards, specialty suppliers, and delivery options near the job ZIP." }
        ];
        let live = null, liveError = null;
        if (process.env.LOWES_CLIENT_ID && process.env.LOWES_ACCESS_TOKEN && process.env.LOWES_API_BASE_URL) {
          try {
            const endpoint = new URL("/api/v1/search/items", process.env.LOWES_API_BASE_URL);
            endpoint.searchParams.set("searchTerms", query);
            if (postalCode) endpoint.searchParams.set("zipCode", postalCode);
            const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${process.env.LOWES_ACCESS_TOKEN}`, "X-Client-Id": process.env.LOWES_CLIENT_ID }, signal: AbortSignal.timeout(9000) });
            const data = await response.json().catch(() => ({}));
            if (response.ok) live = { supplier: "Lowe's", fetchedAt: new Date().toISOString(), results: Array.isArray(data.items) ? data.items.slice(0,20) : (Array.isArray(data.results) ? data.results.slice(0,20) : data) };
            else liveError = `Lowe's partner API returned HTTP ${response.status}; use the retailer link and verify pricing manually.`;
          } catch { liveError = "Lowe's partner API is not reachable; use retailer links and verify current pricing manually."; }
        }
        const matchingCosts = (db.costs || []).filter(c => c.item.toLowerCase().includes(query.toLowerCase())).slice(0,10);
        return json(res, 200, { query, postalCode, live, liveError, links, savedReferences: matchingCosts, supplierStatus: process.env.LOWES_CLIENT_ID && process.env.LOWES_ACCESS_TOKEN && process.env.LOWES_API_BASE_URL ? "Lowe's partner API configured; verify each returned record and store context." : "Retailer search links active. Live pricing requires authorized supplier API credentials; no prices have been scraped or invented." });
      }
      if (req.method === "POST" && url.pathname === "/api/travel/estimate") {
        const b = await body(req);
        const origin = String(b.origin || db.settings.homeBaseAddress || "").trim().slice(0,300);
        const destination = String(b.destination || "").trim().slice(0,300);
        if (!origin || !destination) return json(res, 400, { error: "Set a home/office origin in Business Settings and enter a jobsite address." });
        const numeric = ["roundTrips", "milesOneWay", "vehicleCostPerMile", "driveHoursOneWay", "laborRate", "workers", "tolls", "parking", "meals", "lodging", "other"];
        for (const field of numeric) if (b[field] !== undefined && (!Number.isFinite(Number(b[field])) || Number(b[field]) < 0)) return json(res, 400, { error: `${field} must be a non-negative number.` });
        const roundTrips = Math.min(100, Math.max(1, Math.round(Number(b.roundTrips || db.settings.defaultRoundTrips || 1))));
        let milesOneWay = Number(b.milesOneWay || 0), driveHoursOneWay = Number(b.driveHoursOneWay || 0), routeSource = "Contractor-entered distance/time estimate";
        if (process.env.GOOGLE_MAPS_API_KEY) {
          try {
            const routeResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo" }, body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", routeModifiers: { avoidTolls: false } }), signal: AbortSignal.timeout(9000) });
            const routeData = await routeResponse.json().catch(() => ({}));
            if (routeResponse.ok && routeData.routes && routeData.routes[0]) {
              const route = routeData.routes[0]; milesOneWay = Number(route.distanceMeters || 0) / 1609.344; driveHoursOneWay = Number(String(route.duration || "0s").replace("s", "")) / 3600; routeSource = "Google Routes API estimate; traffic and tolls may change";
            }
          } catch { /* retain contractor-entered distance/time when routing is unavailable */ }
        }
        const vehicleRate = Number(b.vehicleCostPerMile ?? db.settings.vehicleCostPerMile ?? 0.70), workers = Math.max(1, Math.round(Number(b.workers || 1))), laborRate = Number(b.laborRate ?? db.settings.laborRate ?? 0);
        const miles = milesOneWay * 2 * roundTrips, driveHours = driveHoursOneWay * 2 * roundTrips;
        const items = [
          { label: "Vehicle / fuel / maintenance allowance", amount: miles * vehicleRate, basis: `${(milesOneWay*2).toFixed(1)} miles round trip × ${roundTrips} trip(s) × $${vehicleRate.toFixed(2)}/mile` },
          { label: "Travel time labor (estimate only)", amount: driveHours * laborRate * workers, basis: `${driveHours.toFixed(2)} drive hours × ${workers} worker(s) × $${laborRate.toFixed(2)}/hour` },
          { label: "Tolls", amount: Number(b.tolls || 0) * roundTrips, basis: `Entered per round trip × ${roundTrips}` },
          { label: "Parking", amount: Number(b.parking || 0) * roundTrips, basis: `Entered per round trip × ${roundTrips}` },
          { label: "Meals / per diem", amount: Number(b.meals || 0) * roundTrips, basis: `Entered per trip × ${roundTrips}` },
          { label: "Lodging", amount: Number(b.lodging || 0), basis: "Entered total for the trip plan" },
          { label: "Other travel costs", amount: Number(b.other || 0), basis: "Entered total" }
        ].map(x => ({ ...x, amount: Math.round(x.amount * 100) / 100 }));
        const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
        const trip = { id: id("trip"), projectId: String(b.projectId || "").slice(0,80), customer: String(b.customer || "").slice(0,120), origin, destination, roundTrips, milesOneWay: Math.round(milesOneWay*100)/100, driveHoursOneWay: Math.round(driveHoursOneWay*100)/100, totalMiles: Math.round(miles*100)/100, totalDriveHours: Math.round(driveHours*100)/100, routeSource, items, total, includedInBid: false, createdAt: new Date().toISOString(), note: "Travel evaluator is separate from the construction bid total; decide separately whether and how to bill travel to the customer." };
        db.travelEstimates = db.travelEstimates || []; db.travelEstimates.unshift(trip); writeDb(db, req); return json(res, 201, trip);
      }
      if (req.method === "POST" && url.pathname === "/api/leads") {
        const b = await body(req);
        if (!String(b.name || "").trim()) return json(res, 400, { error: "Lead name is required." });
        const lead = { id: id("lead"), name: String(b.name).slice(0,120), phone: String(b.phone || "").slice(0,80), trade: String(b.trade || "General inquiry").slice(0,120), source: String(b.source || "Manual entry").slice(0,80), status: "New", notes: String(b.notes || "").slice(0,2000), createdAt: new Date().toISOString() };
        db.leads.unshift(lead); writeDb(db, req); return json(res, 201, lead);
      }
      if (req.method === "PATCH" && url.pathname.startsWith("/api/leads/")) {
        const leadId = url.pathname.split("/").pop(), b = await body(req);
        const lead = db.leads.find(x => x.id === leadId);
        if (!lead) return json(res, 404, { error: "Lead not found." });
        if (["New","Contacted","Follow-up","Qualified","Won","Lost"].includes(b.status)) lead.status = b.status;
        if (b.notes !== undefined) lead.notes = String(b.notes).slice(0,2000);
        writeDb(db, req); return json(res, 200, lead);
      }
      if (req.method === "POST" && url.pathname === "/api/estimates") {
        const b = await body(req);
        for (const field of ["materials", "labor", "other", "markupPct", "laborHours", "laborRate", "materialsMarkupPct"]) if (b[field] !== undefined && (!Number.isFinite(Number(b[field])) || Number(b[field]) < 0)) return json(res, 400, { error: `${field} must be a valid non-negative number.` });
        if (Number(b.materialsMarkupPct ?? b.markupPct ?? db.settings.materialsMarkupPct ?? 0) > 300) return json(res, 400, { error: "Materials markup must be 300% or less." });
        const materials = safeNumber(b.materials), other = safeNumber(b.other);
        const laborRate = b.laborRate === undefined || b.laborRate === "" ? safeNumber(db.settings.laborRate) : safeNumber(b.laborRate);
        const laborHours = b.laborHours === undefined || b.laborHours === "" ? null : safeNumber(b.laborHours);
        const labor = laborHours === null ? safeNumber(b.labor) : laborHours * laborRate * (1 + safeNumber(db.settings.laborBurdenPct) / 100);
        const markupPct = Math.min(300, safeNumber(b.materialsMarkupPct === undefined ? (b.markupPct === undefined ? db.settings.materialsMarkupPct : b.markupPct) : b.materialsMarkupPct));
        const materialMarkup = Math.round(materials * markupPct) / 100;
        const subtotal = materials + materialMarkup + labor + other;
        const estimate = { id: id("est"), customer: String(b.customer || "Customer").slice(0,120), customerAddress: String(b.customerAddress || "").slice(0,300), project: String(b.project || "Construction project").slice(0,200), materials, materialsMarkupPct: markupPct, materialMarkup, labor, laborHours, laborRate, laborBurdenPct: safeNumber(db.settings.laborBurdenPct), other, subtotal: Math.round(subtotal * 100) / 100, total: Math.round(subtotal * 100) / 100, status: "Draft", createdAt: new Date().toISOString(), disclaimer: "Draft only. Travel costs are separate and excluded. Verify quantities, current supplier prices, labor rates, scope, taxes, permits, and local requirements before issuing." };
        db.estimates.unshift(estimate); writeDb(db, req); return json(res, 201, estimate);
      }
      if (req.method === "POST" && url.pathname === "/api/projects") {
        const b = await body(req);
        for (const field of ["lengthFt", "widthFt", "heightFt", "wastePct"]) if (b[field] !== undefined && (!Number.isFinite(Number(b[field])) || Number(b[field]) < 0)) return json(res, 400, { error: `${field} must be a valid non-negative number.` });
        if (Number(b.wastePct || 10) > 100) return json(res, 400, { error: "Waste allowance must be 100% or less." });
        const mediaRecord = b.mediaId ? (db.media || []).find(m => m.id === String(b.mediaId)) : null;
        if (b.mediaId && !mediaRecord) return json(res, 400, { error: "Selected media was not found in this workspace." });
        const lengthFt = safeNumber(b.lengthFt), widthFt = safeNumber(b.widthFt), heightFt = safeNumber(b.heightFt), wastePct = b.wastePct === undefined ? 10 : safeNumber(b.wastePct);
        const round2 = n => Math.round(n * 100) / 100;
        const floorAreaSqFt = round2(lengthFt * widthFt), perimeterFt = round2(2 * (lengthFt + widthFt)), grossWallAreaSqFt = round2(perimeterFt * heightFt);
        const project = { id: id("project"), name: String(b.name || "Untitled project").slice(0,160), customer: String(b.customer || "").slice(0,120), customerAddress: String(b.customerAddress || "").slice(0,300), trade: String(b.trade || "General").slice(0,100), mediaId: mediaRecord ? mediaRecord.id : null, videoName: String(mediaRecord ? mediaRecord.fileName : (b.videoName || "")).slice(0,180), lengthFt, widthFt, heightFt, wastePct, floorAreaSqFt, floorAreaWithWasteSqFt: round2(floorAreaSqFt * (1 + wastePct / 100)), perimeterFt, grossWallAreaSqFt, material: String(b.material || "Not confirmed").slice(0,100), notes: String(b.notes || "").slice(0,2000), status: "Needs review", createdAt: new Date().toISOString(), measurementMode: "Calculated from contractor-entered dimensions; excludes openings and is not an automated video measurement" };
        db.projects.unshift(project); writeDb(db, req); return json(res, 201, project);
      }
      if (req.method === "POST" && url.pathname === "/api/posts") {
        const b = await body(req);
        const post = { id: id("post"), title: String(b.title || "Project spotlight").slice(0,160), platform: String(b.platform || "Draft").slice(0,60), caption: String(b.caption || "").slice(0,4000), status: "Draft for approval", createdAt: new Date().toISOString() };
        db.posts.unshift(post); writeDb(db, req); return json(res, 201, post);
      }
      if (req.method === "PATCH" && url.pathname.startsWith("/api/posts/")) {
        const postId = url.pathname.split("/").pop(), b = await body(req);
        const post = db.posts.find(x => x.id === postId);
        if (!post) return json(res, 404, { error: "Post not found." });
        if (["Draft for approval","Approved","Scheduled (manual)"].includes(b.status)) post.status = b.status;
        writeDb(db, req); return json(res, 200, post);
      }
      if (req.method === "POST" && url.pathname === "/api/settings") {
        const b = await body(req);
        const numberSetting = (key, fallback, max) => { const value = b[key] === undefined || b[key] === "" ? Number(db.settings[key] ?? fallback) : Number(b[key]); return Number.isFinite(value) && value >= 0 && value <= max ? value : Number(db.settings[key] ?? fallback); };
        db.settings = { ...db.settings, businessName: String(b.businessName ?? db.settings.businessName).slice(0,160), trade: String(b.trade ?? db.settings.trade).slice(0,100), serviceArea: String(b.serviceArea ?? db.settings.serviceArea).slice(0,200), autonomy: ["Approval required","Scheduled after approval","Growth automation (future)"].includes(b.autonomy) ? b.autonomy : db.settings.autonomy, laborRate: numberSetting("laborRate", 65, 10000), laborBurdenPct: numberSetting("laborBurdenPct", 0, 300), materialsMarkupPct: numberSetting("materialsMarkupPct", 20, 300), vehicleCostPerMile: numberSetting("vehicleCostPerMile", 0.70, 100), defaultRoundTrips: Math.max(1, Math.min(100, Math.round(numberSetting("defaultRoundTrips", 1, 100)))), homeBaseAddress: String(b.homeBaseAddress ?? db.settings.homeBaseAddress ?? "").slice(0,300) };
        // Subscription tier and paid add-on entitlements are changed only by verified billing webhooks.
        writeDb(db, req); return json(res, 200, db.settings);
      }
      return json(res, 404, { error: "API route not found." });
    }

    let requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.normalize(path.join(PUBLIC, requested));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "Forbidden" });
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: "File not found" });
      const ext = path.extname(file);
      const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }); res.end(data);
    });
  } catch (e) { json(res, 400, { error: process.env.NODE_ENV === "production" ? "Request could not be processed." : (e.message || "Request failed.") }); }
});
server.listen(PORT, () => console.log(`Trades Secretary running at http://localhost:${PORT}`));
