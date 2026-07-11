import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the Focus Reader application shell", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Focus Reader · ADHD 便利阅读器<\/title>/i);
  assert.match(html, /ADHD 便利阅读器/);
  assert.match(html, /粘贴阅读/);
  assert.match(html, /文件阅读/);
  assert.match(html, /不保存内容/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("local formatter returns source-bound highlight ranges", async () => {
  const response = await request("/api/format", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "local",
      blocks: [{ id: "b1", text: "Clear steps make a long task easier to start.", kind: "paragraph" }],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.annotations[0].id, "b1");
  assert.ok(payload.annotations[0].highlights[0].start >= 0);
  assert.ok(payload.annotations[0].highlights[0].end <= 45);
});

test("formatter rejects duplicate source block ids", async () => {
  const response = await request("/api/format", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "local",
      blocks: [
        { id: "duplicate", text: "First block", kind: "paragraph" },
        { id: "duplicate", text: "Second block", kind: "paragraph" },
      ],
    }),
  });
  assert.equal(response.status, 400);
});
