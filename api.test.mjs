import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { server } from "./server.mjs";

let endpoint;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

async function post(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { status: response.status, body: await response.json() };
}

for (const [text, topic] of [
  ["Когда доставка?", "delivery"],
  ["Сколько стоит? Какова цена?", "pricing"],
  ["Хочу изменить заказ", "other"],
]) {
  test(`valid request is ready: ${topic}`, async () => {
    const reply = await post(JSON.stringify({ text }));
    assert.equal(reply.status, 200);
    assert.equal(reply.body.status, "ready");
    assert.equal(reply.body.topic, topic);
    assert.ok(reply.body.draft.trim());
  });
}

test("invalid JSON and missing, non-string or blank text return 400", async () => {
  for (const body of ["", "{", "null", "[]", "{}", '{"text":7}', '{"text":""}', '{"text":"   "}']) {
    assert.deepEqual(await post(body), { status: 400, body: { status: "invalid_input" } }, body);
  }
});

const manualReview = { status: 200, body: { status: "manual_review", topic: null, draft: null } };

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`model failure clears topic and draft: ${marker}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text: marker })), manualReview);
  });
}

test("timeout triggers manual review before the mock finishes; the next request succeeds", async () => {
  const start = performance.now();
  assert.deepEqual(await post(JSON.stringify({ text: "[timeout]" })), manualReview);
  // Allow scheduling overhead, but keep this well below the mock's 1200 ms delay.
  assert.ok(performance.now() - start < 1000, "the API waited too long for the model");
  const next = await post(JSON.stringify({ text: "Уточните цену" }));
  assert.equal(next.body.status, "ready");
  assert.equal(next.body.topic, "pricing");
});
