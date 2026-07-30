import assert from "node:assert/strict";
import test from "node:test";

import type { Plan, PlanWritableFields } from "../lib/plan-types.ts";
// @ts-expect-error Node의 type-stripping 테스트 실행기는 .ts 소스를 직접 읽는다.
import * as supabasePlans from "../lib/supabase-plans.ts";

const {
  fromSupabasePlanRow,
  getPlanSignature,
  parseOccurrenceStatuses,
  parsePlanRepeat,
  toSupabasePlanInsert,
  toSupabasePlanUpdate,
} = supabasePlans;

const writablePlan: PlanWritableFields = {
  title: "  영어 복습  ",
  date: "2026-07-30",
  start: "09:00",
  end: "10:00",
  repeat: [4, 2, 4],
  category: "  공부  ",
  memo: "  단어 30개  ",
  status: "planned",
  occurrenceStatuses: {
    "2026-08-06": "completed",
    "2026-07-30": "incomplete",
  },
  source: "manual",
};

test("Supabase 행을 화면 계획으로 변환하고 JSON 값을 안전하게 정리한다", () => {
  const plan = fromSupabasePlanRow({
    id: "17",
    user_id: "user-123",
    title: "영어 복습",
    date: "2026-07-30",
    start: "09:00",
    end: "10:00",
    repeat: [4, 2, 4, 9, "3"],
    category: "공부",
    memo: "단어 30개",
    status: "completed",
    occurrence_statuses: {
      "2026-08-06": "completed",
      "2026-02-30": "incomplete",
      "not-a-date": "completed",
      "2026-07-30": "planned",
    },
    source: "auto",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T01:00:00.000Z",
  });

  assert.equal(plan.id, 17);
  assert.equal(plan.clientId, "user-123");
  assert.deepEqual(plan.repeat, [2, 4]);
  assert.deepEqual(plan.occurrenceStatuses, {
    "2026-08-06": "completed",
  });
  assert.equal(plan.status, "completed");
  assert.equal(plan.source, "auto");
});

test("손상되거나 빈 반복/발생 상태는 안전한 기본값을 사용한다", () => {
  assert.equal(parsePlanRepeat("not-json"), null);
  assert.equal(parsePlanRepeat([]), null);
  assert.deepEqual(parsePlanRepeat("[6,1,6,-1]"), [1, 6]);
  assert.deepEqual(parseOccurrenceStatuses("not-json"), {});
  assert.deepEqual(
    parseOccurrenceStatuses(
      '{"2026-07-30":"completed","bad":"incomplete"}',
    ),
    { "2026-07-30": "completed" },
  );
});

test("신규 계획을 Supabase insert payload로 변환한다", () => {
  assert.deepEqual(
    toSupabasePlanInsert(writablePlan, "  user-123  "),
    {
      user_id: "user-123",
      title: "영어 복습",
      date: "2026-07-30",
      start: "09:00",
      end: "10:00",
      repeat: [2, 4],
      category: "공부",
      memo: "단어 30개",
      status: "planned",
      occurrence_statuses: {
        "2026-07-30": "incomplete",
        "2026-08-06": "completed",
      },
      source: "manual",
    },
  );
});

test("부분 수정값만 snake_case update payload에 넣는다", () => {
  assert.deepEqual(
    toSupabasePlanUpdate(
      {
        repeat: [],
        category: "  ",
        occurrenceStatuses: {
          "2026-08-06": "completed",
          invalid: "incomplete",
        },
      },
      "2026-07-30T02:00:00.000Z",
    ),
    {
      repeat: null,
      category: null,
      occurrence_statuses: {
        "2026-08-06": "completed",
      },
      updated_at: "2026-07-30T02:00:00.000Z",
    },
  );
});

test("서명은 저장소 식별자와 판정 상태 차이를 무시한다", () => {
  const first: Plan = {
    id: 1,
    clientId: "legacy-device",
    ...writablePlan,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  const second: Plan = {
    ...first,
    id: 99,
    clientId: "supabase-user",
    title: "영어 복습",
    repeat: [2, 4],
    category: "공부",
    memo: "단어 30개",
    occurrenceStatuses: {
      "2026-07-30": "incomplete",
      "2026-08-06": "completed",
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  assert.equal(getPlanSignature(first), getPlanSignature(second));
  const changedAssessment: Plan = {
    ...second,
    status: "incomplete",
    occurrenceStatuses: {
      ...second.occurrenceStatuses,
      "2026-08-06": "incomplete",
    },
  };
  assert.equal(
    getPlanSignature(first),
    getPlanSignature(changedAssessment),
  );
  assert.notEqual(
    getPlanSignature(first),
    getPlanSignature({ ...second, start: "10:00" }),
  );
});
