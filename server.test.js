const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const port = 43000 + Math.floor(Math.random() * 15000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sitepix-test-"));
let child;
const base = `http://127.0.0.1:${port}`;
async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start in time");
}
function cookieFrom(response) { return (response.headers.get("set-cookie") || "").split(";")[0]; }
async function post(url, data, cookie = "") {
  return fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
}
async function uploadPng(cookie) {
  const boundary = "sitepix-test-boundary";
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0y8AAAAASUVORK5CYII=", "base64");
  const pre = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nproject\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tiny.png"\r\nContent-Type: image/png\r\n\r\n`);
  const postamble = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([pre, image, postamble]);
  return fetch(`${base}/api/media/upload`, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length), cookie }, body });
}

test("Trades Secretary authentication, tenant isolation, and core API tests", async t => {
  child = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: { ...process.env, NODE_ENV: "test", PORT: String(port), SITEPIX_DATA_DIR: dataDir, SITEPIX_BETA_INVITE_CODE: "beta-test-invite-2026", STRIPE_WEBHOOK_SECRET: "whsec_test_sitepix", TWILIO_AUTH_TOKEN: "twilio_test_token", TWILIO_INCOMING_WEBHOOK_URL: "https://sitepix.example/api/telephony/incoming", TWILIO_VOICE_TURN_WEBHOOK_URL: "https://sitepix.example/api/telephony/voice-turn", TWILIO_RECORDING_CALLBACK_URL: "https://sitepix.example/api/telephony/recording-complete" }, stdio: "ignore" });
  t.after(() => { if (child && !child.killed) child.kill("SIGTERM"); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await waitForServer();

  await t.test("health endpoint returns security headers", async () => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("cache-control"), "no-store");
  });
  await t.test("health and public config expose only safe launch status", async () => {
    const r = await fetch(`${base}/api/health`); assert.equal(r.status, 200); assert.equal((await r.json()).version, "0.4.2");
    const config = await fetch(`${base}/api/config/public`); assert.deepEqual(await config.json(), { betaInviteRequired: true });
  });
  await t.test("workspace APIs require a session", async () => {
    const r = await fetch(`${base}/api/state`); assert.equal(r.status, 401);
    const billing = await post("/api/billing/checkout", { plan: "Pro" }); assert.equal(billing.status, 401);
  });
  await t.test("Twilio webhook routes reject requests without a valid signature", async () => {
    const body = "CallSid=CA123&From=%2B15555550100&To=%2B15555550200";
    const r = await fetch(`${base}/api/telephony/incoming`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "invalid" }, body });
    assert.equal(r.status, 403);
  });

  let cookieA, cookieB, mediaId, orgIdA;
  await t.test("requires a beta invite code before account creation", async () => {
    const missing = await post("/api/auth/register", { email: "no-invite@example.com", password: "correct horse battery staple", businessName: "No Invite Co" });
    assert.equal(missing.status, 403);
    const wrong = await post("/api/auth/register", { email: "wrong-invite@example.com", password: "correct horse battery staple", businessName: "Wrong Invite Co", betaInviteCode: "wrong" });
    assert.equal(wrong.status, 403);
  });
  await t.test("registers an owner and creates a private empty workspace", async () => {
    const r = await post("/api/auth/register", { email: "owner@example.com", password: "correct horse battery staple", businessName: "Alpha Builders", betaInviteCode: "beta-test-invite-2026" });
    assert.equal(r.status, 201); cookieA = cookieFrom(r); assert.match(cookieA, /^sitepix_session=/);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieA } }); assert.equal(me.status, 200);
    const meData = await me.json(); orgIdA = meData.organization.id; assert.equal(meData.organization.name, "Alpha Builders");
    const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); assert.equal(state.status, 200);
    const data = await state.json(); assert.equal(data.leads.length, 0); assert.equal(data.settings.businessName, "Alpha Builders");
  });
  await t.test("rejects weak passwords and duplicate email addresses", async () => {
    const weak = await post("/api/auth/register", { email: "weak@example.com", password: "short", businessName: "Weak Co", betaInviteCode: "beta-test-invite-2026" }); assert.equal(weak.status, 400);
    const duplicate = await post("/api/auth/register", { email: "owner@example.com", password: "correct horse battery staple", businessName: "Duplicate Co", betaInviteCode: "beta-test-invite-2026" }); assert.equal(duplicate.status, 409);
  });
  await t.test("settings cannot self-grant paid subscriptions or add-on access", async () => {
    const update = await post("/api/settings", { businessName: "Alpha Builders", subscription: "Growth", measureBidEnabled: true }, cookieA);
    assert.equal(update.status, 200);
    const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); const data = await state.json();
    assert.equal(data.settings.subscription, "Trial"); assert.equal(data.settings.measureBidEnabled, false);
  });
  await t.test("verifies Stripe webhook signatures and updates paid entitlements idempotently", async () => {
    const event = { id: "evt_sitepix_test_001", type: "customer.subscription.updated", data: { object: { id: "sub_test_001", customer: "cus_test_001", status: "active", metadata: { organizationId: orgIdA, plan: "Pro", measureBidEnabled: "true" } } } };
    const raw = JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", "whsec_test_sitepix").update(`${timestamp}.`).update(raw).digest("hex");
    const send = () => fetch(`${base}/api/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, body: raw });
    const first = await send(); assert.equal(first.status, 200); assert.equal((await first.json()).entitlementSync, "processed");
    const duplicate = await send(); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).duplicate, true);
    const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); const data = await state.json();
    assert.equal(data.settings.subscription, "Pro"); assert.equal(data.settings.measureBidEnabled, true); assert.equal(data.billing.status, "active");
  });
  await t.test("creates leads and rejects invalid lead data", async () => {
    const bad = await post("/api/leads", {}, cookieA); assert.equal(bad.status, 400);
    const good = await post("/api/leads", { name: "Alpha Test Lead", trade: "Roofing" }, cookieA); assert.equal(good.status, 201);
    assert.equal((await good.json()).name, "Alpha Test Lead");
  });
  await t.test("calculates estimates and persists contractor cost references", async () => {
    const invalid = await post("/api/estimates", { materials: -5 }, cookieA); assert.equal(invalid.status, 400);
    const excessive = await post("/api/estimates", { markupPct: 301 }, cookieA); assert.equal(excessive.status, 400);
    const r = await post("/api/estimates", { customer: "Test", project: "Flooring", materials: 100, labor: 50, other: 10, markupPct: 20 }, cookieA);
    assert.equal(r.status, 201); const e = await r.json(); assert.equal(e.total, 180); assert.equal(e.status, "Draft"); assert.equal(e.materialMarkup, 20);
    const c = await post("/api/costs", { item: "Flooring", price: 3.25, unit: "sq ft", source: "Supplier quote", sourceDate: "2026-10-20" }, cookieA);
    assert.equal(c.status, 201); assert.equal((await c.json()).verified, false);
  });
  await t.test("supports contractor pricing preferences, supplier search, customer addresses, and separate travel estimates", async () => {
    const settings = await post("/api/settings", { businessName: "Alpha Builders", trade: "Roofing", laborRate: 85, laborBurdenPct: 18, materialsMarkupPct: 27, homeBaseAddress: "100 Main St, Raleigh, NC 27601", vehicleCostPerMile: 0.8, defaultRoundTrips: 2 }, cookieA);
    assert.equal(settings.status, 200);
    const estimate = await post("/api/estimates", { customer: "Jane Smith", customerAddress: "200 Oak St, Raleigh, NC 27603", project: "Roof replacement", materials: 1000, laborHours: 10, other: 100 }, cookieA);
    assert.equal(estimate.status, 201); const priced = await estimate.json(); assert.equal(priced.materialMarkup, 270); assert.equal(priced.labor, 1003); assert.equal(priced.total, 2373);
    const supplierResponse = await fetch(`${base}/api/suppliers/search?q=${encodeURIComponent("drywall")}&zip=27601`, { headers: { cookie: cookieA } });
    assert.equal(supplierResponse.status, 200); const supplierData = await supplierResponse.json(); assert.equal(supplierData.links.length, 5); assert.match(supplierData.supplierStatus, /Retailer search links active/);
    const projectResponse = await post("/api/projects", { name: "Smith kitchen", customer: "Jane Smith", customerAddress: "200 Oak St, Raleigh, NC 27603", trade: "Kitchen & Bath", lengthFt: 10, widthFt: 12, heightFt: 8 }, cookieA);
    assert.equal(projectResponse.status, 201); const project = await projectResponse.json(); assert.equal(project.customer, "Jane Smith"); assert.match(project.customerAddress, /Raleigh/);
    const travelResponse = await post("/api/travel/estimate", { customer: "Jane Smith", projectId: project.id, origin: "100 Main St, Raleigh, NC 27601", destination: project.customerAddress, roundTrips: 2, milesOneWay: 12, driveHoursOneWay: 0.5, workers: 2, vehicleCostPerMile: 0.8, laborRate: 85, tolls: 2, parking: 5, meals: 10, lodging: 0, other: 3 }, cookieA);
    assert.equal(travelResponse.status, 201); const trip = await travelResponse.json(); assert.equal(trip.totalMiles, 48); assert.equal(trip.includedInBid, false); assert.equal(trip.items.length, 7); assert.ok(trip.total > 0);
    const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); const data = await state.json(); assert.equal(data.travelEstimates[0].id, trip.id); assert.equal(data.projects[0].customer, "Jane Smith");
  });
  await t.test("uploads private media and serves it only to the owning workspace", async () => {
    const uploaded = await uploadPng(cookieA); assert.equal(uploaded.status, 201);
    const payload = await uploaded.json(); mediaId = payload.media.id; assert.equal(payload.media.fileName, "tiny.png");
    const downloaded = await fetch(`${base}/api/media/${mediaId}/download`, { headers: { cookie: cookieA } }); assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await downloaded.arrayBuffer()); assert.equal(bytes[0], 137); assert.ok(bytes.length > 20);
    const project = await post("/api/projects", { name: "Test room", lengthFt: 10, widthFt: 12, heightFt: 8, wastePct: 10, mediaId }, cookieA);
    assert.equal(project.status, 201); const p = await project.json(); assert.equal(p.floorAreaSqFt, 120); assert.equal(p.floorAreaWithWasteSqFt, 132); assert.equal(p.perimeterFt, 44); assert.equal(p.grossWallAreaSqFt, 352);
  });
  await t.test("isolates data between two different organizations", async () => {
    const r = await post("/api/auth/register", { email: "other@example.com", password: "another secure password", businessName: "Beta Contracting", betaInviteCode: "beta-test-invite-2026" });
    assert.equal(r.status, 201); cookieB = cookieFrom(r);
    const stateB = await fetch(`${base}/api/state`, { headers: { cookie: cookieB } }); const dataB = await stateB.json();
    assert.equal(dataB.leads.length, 0); assert.equal(dataB.estimates.length, 0); assert.equal(dataB.costs.length, 0); assert.equal(dataB.media.length, 0);
    const forbiddenMedia = await fetch(`${base}/api/media/${mediaId}/download`, { headers: { cookie: cookieB } }); assert.equal(forbiddenMedia.status, 404);
    const stateA = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); const dataA = await stateA.json();
    assert.equal(dataA.leads.length, 1); assert.equal(dataA.estimates.length, 2); assert.equal(dataA.costs.length, 1);
  });
  await t.test("exports only the signed-in workspace and provider status is protected", async () => {
    const exp = await fetch(`${base}/api/data/export`, { headers: { cookie: cookieA } }); assert.equal(exp.status, 200);
    assert.equal((await exp.json()).organization.name, "Alpha Builders");
    const social = await post("/api/social/facebook/publish", { postId: "does-not-exist" }, cookieA); assert.equal(social.status, 503);
    const status = await fetch(`${base}/api/integrations/status`, { headers: { cookie: cookieA } }); assert.equal(status.status, 200);
    const data = await status.json(); assert.equal(data.providers.measurement.configured, false); assert.equal(data.providers.stripe.configured, false);
    assert.equal(JSON.stringify(data).includes("sk_live"), false);
  });
  await t.test("allows the owner to delete uploaded media", async () => {
    const r = await fetch(`${base}/api/media/${mediaId}`, { method: "DELETE", headers: { cookie: cookieA } }); assert.equal(r.status, 200);
    const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieA } }); const data = await state.json(); assert.equal(data.media.length, 0); assert.equal(data.projects[0].mediaId, null);
  });
  await t.test("rejects a wrong password on sign-in and signs out cleanly", async () => {
    const wrong = await post("/api/auth/login", { email: "owner@example.com", password: "incorrect password" }); assert.equal(wrong.status, 401);
    const logout = await post("/api/auth/logout", {}, cookieA); assert.equal(logout.status, 200);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieFrom(logout) } }); assert.equal(me.status, 401);
  });
});
