const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 3199;
let child;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "" },
    stdio: "ignore"
  });
  for (let i = 0; i < 30; i++) {
    try { const response = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (response.ok) return; }
    catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start.");
});

test.after(() => child?.kill());

test("health endpoint reports demo mode", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "demo");
});

test("homepage accepts a static-demo query string", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/?static-demo=1`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /LeadPilot AI/);
});

test("lead endpoint returns a structured analysis", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Alex",
      email: "alex@example.com",
      company: "Acme",
      subject: "New website",
      message: "We need a five-page website next month. Budget is $2500."
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.analysis.priority, "high");
  assert.equal(body.analysis.qualificationScore, 91);
  assert.equal(body.analysis.intent, "sales");
  assert.equal(typeof body.analysis.replyDraft, "string");
});

test("invalid lead is rejected", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Email", message: "Hello" })
  });
  assert.equal(response.status, 400);
});
