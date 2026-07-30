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

test("매화수련록의 로그인 확인 화면을 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>매화수련록<\/title>/);
  assert.match(html, /매화수련록/);
  assert.match(html, /로그인 상태를 확인하는 중|Google로 계속하기/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, />친구</);
});

test("Google 로그인과 계정별 저장 흐름을 코드에 유지한다", async () => {
  const [app, auth] = await Promise.all([
    readFile(new URL("../app/PlannerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AuthGate.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /Google로 계속하기/);
  assert.match(auth, /signInWithOAuth/);
  assert.match(auth, /provider: "google"/);
  assert.match(auth, /redirectTo: window\.location\.origin/);
  assert.match(auth, /prompt: "select_account"/);
  assert.match(auth, /hashParams\.get\("error"\)/);
  assert.match(auth, /error_description/);
  assert.match(auth, /Google 로그인이 취소되었습니다/);
  assert.match(auth, /pendingOAuthErrorMessage/);
  assert.doesNotMatch(auth, /requestAnimationFrame\(\(\) => setErrorMessage/);
  assert.doesNotMatch(auth, /회원가입|비밀번호 재설정|type="password"/);
  assert.doesNotMatch(
    auth,
    /signInWithPassword|signUp\(|resetPasswordForEmail|updateUser/,
  );
  assert.match(app, /내 계획표/);
  assert.match(app, /계획 만들기/);
  assert.match(app, /수련 기록/);
  assert.match(app, /내 계정으로 가져오기/);
  assert.match(app, /\.from\("plans"\)/);
  assert.doesNotMatch(app, /이 브라우저에 저장 중/);
});

test("기존 D1 계획 API는 가져오기용 읽기만 허용한다", async () => {
  const route = await readFile(
    new URL("../app/api/plans/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /export async function GET/);
  assert.match(route, /afterId/);
  assert.match(route, /nextCursor/);
  assert.match(route, /MAX_RESULTS \+ 1/);
  assert.match(route, /기존 계획 저장소는 가져오기용 읽기만 허용합니다/);
  assert.doesNotMatch(route, /\.insert\(plans\)|\.update\(plans\)|\.delete\(plans\)/);
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

test("모바일 CTA와 기록 안내의 회귀를 막는다", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/PlannerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    styles,
    /\.empty-branch\s*\{[^}]*pointer-events:\s*none;/s,
  );
  assert.match(app, /const navigateToPage = useCallback/);
  assert.match(app, /window\.requestAnimationFrame\(\(\) => window\.scrollTo/);
  assert.match(app, /자동으로 쌓이는 실행 기록/);
  assert.match(app, /기록이 쌓이는 방법/);
  assert.match(app, /최근에 결과를 남긴 계획/);
});

test("자동 생성 안내와 시간 눈금, 매화 한 송이 규칙을 유지한다", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/PlannerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /자동 생성 사용 방법/);
  assert.match(app, /조건대로 미리보기 만들기/);
  assert.match(app, /완료 1회마다 매화 1송이/);
  assert.match(app, /Array\.from\(\{ length: 24 \}/);
  assert.match(app, /\.range\(from, from \+ SUPABASE_PAGE_SIZE - 1\)/);
  assert.match(app, /current\.slice\(processedCount\)/);
  assert.match(
    app,
    /const currentWeekCompleted = currentWeekOccurrences\.filter\([\s\S]*?plan\.status === "completed"/,
  );
  assert.match(app, /completed\.map\(\(plan, index\) =>/);
  assert.doesNotMatch(app, /Math\.round\(rate \/ 10\)/);
  assert.doesNotMatch(app, /conic-gradient\(from -90deg/);
  assert.match(styles, /\.plum-canopy\s*\{/);
  assert.match(styles, /\.time-mark\.is-major\s*\{/);
});
