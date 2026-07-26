import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const env = {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("매화수련록의 실제 제품 화면을 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>매화수련록<\/title>/);
  assert.match(html, /내 계획표/);
  assert.match(html, /계획 만들기/);
  assert.match(html, /수련 기록/);
  assert.match(html, /계획표를 펼치는 중/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, />친구</);
});

test("빈 상태와 확정 대사를 코드의 단일 기준과 일치시킨다", async () => {
  const [app, engine] = await Promise.all([
    readFile(new URL("../app/PlannerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/planner.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /아직 계획이 없습니다\./);
  assert.doesNotMatch(app, /검술 수련|서예 연습|아침 명상/);
  assert.match(engine, /오, 좀 하는데\?/);
  assert.match(engine, /뭐야, 왜 안 왔어\?/);
  assert.match(engine, /도망친다고 될 일이 아니다\. 다음에는 꼭 하거라\./);
});
