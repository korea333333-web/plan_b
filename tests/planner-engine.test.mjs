import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARACTER_ORDER,
  addDays,
  calculateCompletionRate,
  calculateCompletionStreak,
  generateAutoPlan,
  getAssessedPlanOccurrences,
  getCharacterDialogue,
  getDateRange,
  getScheduleStatus,
  getWeekDates,
  getWeekday,
  hasScheduleEnded,
  materializePlanOccurrences,
  planOccursOnDate,
} from "../lib/planner.ts";

test("요일과 주간 날짜를 시간대에 영향받지 않고 계산한다", () => {
  assert.equal(getWeekday("2026-07-26"), 0);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.deepEqual(getWeekDates("2026-07-26"), [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
    "2026-07-26",
  ]);
  assert.deepEqual(getDateRange("2026-07-30", "2026-08-02"), [
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
  ]);
  assert.throws(() => getDateRange("2026-07-27", "2026-07-26"));
  assert.throws(() => addDays("2026-02-30", 1));
});

test("자동 계획을 선택 요일, 가능 시간, 하루 최대 시간 안에서 분산한다", () => {
  const result = generateAutoPlan({
    tasks: [
      {
        id: "english",
        title: "영단어 복습",
        totalMinutes: 180,
        category: "공부",
      },
      {
        id: "exercise",
        title: "운동",
        totalMinutes: 120,
      },
    ],
    startDate: "2026-07-27",
    endDate: "2026-07-31",
    allowedWeekdays: [1, 3, 5],
    availability: [
      { weekday: 1, startTime: "18:00", endTime: "20:00" },
      { weekday: 3, startTime: "18:00", endTime: "20:00" },
      { weekday: 5, startTime: "18:00", endTime: "20:00" },
    ],
    maxMinutesPerDay: 120,
    slotMinutes: 30,
  });

  assert.equal(result.scheduledMinutes, 300);
  assert.equal(result.unscheduledMinutes, 0);
  assert.deepEqual(
    [...new Set(result.plans.map((plan) => plan.date))],
    ["2026-07-27", "2026-07-29", "2026-07-31"],
  );

  const minutesByDate = new Map();
  for (const plan of result.plans) {
    assert.equal(plan.status, "planned");
    assert.equal(plan.source, "auto");
    assert.deepEqual(plan.repeat, []);
    assert.match(plan.start, /^\d{2}:\d{2}$/);
    assert.match(plan.end, /^\d{2}:\d{2}$/);
    assert.ok(plan.start >= "18:00");
    assert.ok(plan.end <= "20:00");
    minutesByDate.set(
      plan.date,
      (minutesByDate.get(plan.date) ?? 0) + plan.durationMinutes,
    );
  }
  assert.ok([...minutesByDate.values()].every((minutes) => minutes <= 120));
});

test("겹치는 가능 시간은 한 번만 세고 부족한 분량을 반환한다", () => {
  const result = generateAutoPlan({
    tasks: [
      { id: "first", title: "첫 과제", totalMinutes: 90 },
      { id: "second", title: "둘째 과제", totalMinutes: 90 },
    ],
    startDate: "2026-07-27",
    endDate: "2026-07-27",
    allowedWeekdays: [1],
    availability: [
      { weekday: 1, startTime: "09:00", endTime: "10:00" },
      { weekday: 1, startTime: "09:30", endTime: "10:30" },
    ],
    maxMinutesPerDay: 1000,
  });

  assert.equal(result.capacityMinutes, 90);
  assert.equal(result.scheduledMinutes, 90);
  assert.equal(result.unscheduledMinutes, 90);
  assert.deepEqual(result.unscheduled, [
    { taskId: "second", title: "둘째 과제", remainingMinutes: 90 },
  ]);
  assert.equal(result.plans.at(-1).end, "10:30");
});

test("빈 요일 또는 가능 시간이 없으면 전체 분량을 미배치로 돌려준다", () => {
  const result = generateAutoPlan({
    tasks: [{ id: "one", title: "할 일", totalMinutes: 60 }],
    startDate: "2026-07-27",
    endDate: "2026-07-28",
    allowedWeekdays: [],
    availability: [],
    maxMinutesPerDay: 60,
  });

  assert.deepEqual(result.plans, []);
  assert.equal(result.scheduledMinutes, 0);
  assert.equal(result.unscheduledMinutes, 60);
});

test("종료된 planned 일정만 미확인으로 판정한다", () => {
  const beforeEnd = new Date(2026, 6, 26, 9, 59);
  const atEnd = new Date(2026, 6, 26, 10, 0);
  const base = {
    date: "2026-07-26",
    start: "09:00",
    end: "10:00",
    repeat: [],
    status: "planned",
  };

  assert.equal(hasScheduleEnded(base, beforeEnd), false);
  assert.equal(hasScheduleEnded(base, atEnd), true);
  assert.equal(getScheduleStatus(base, beforeEnd), "planned");
  assert.equal(getScheduleStatus(base, atEnd), "unconfirmed");
  assert.equal(
    getScheduleStatus({ ...base, status: "completed" }, atEnd),
    "completed",
  );
  assert.equal(
    getScheduleStatus({ ...base, status: "incomplete" }, atEnd),
    "incomplete",
  );
});

test("반복 일정은 시작일 이후 선택한 요일에만 발생한다", () => {
  const recurring = {
    date: "2026-07-27",
    repeat: [3, 5],
  };

  assert.equal(planOccursOnDate(recurring, "2026-07-26"), false);
  assert.equal(planOccursOnDate(recurring, "2026-07-27"), false);
  assert.equal(planOccursOnDate(recurring, "2026-07-29"), true);
  assert.equal(planOccursOnDate(recurring, "2026-07-30"), false);
  assert.equal(planOccursOnDate(recurring, "2026-07-31"), true);
  assert.equal(
    planOccursOnDate({ date: "2026-07-27", repeat: null }, "2026-07-27"),
    true,
  );
  assert.equal(
    planOccursOnDate({ date: "2026-07-27", repeat: null }, "2026-08-03"),
    false,
  );
});

test("반복 일정 상태는 실제 표시 날짜의 종료 시각으로 판정한다", () => {
  const recurring = {
    date: "2026-07-20",
    start: "09:00",
    end: "10:00",
    repeat: [1],
    status: "planned",
  };

  assert.equal(
    getScheduleStatus(
      recurring,
      new Date(2026, 6, 26, 12, 0),
      "2026-07-27",
    ),
    "planned",
  );
  assert.equal(
    getScheduleStatus(
      recurring,
      new Date(2026, 6, 27, 10, 0),
      "2026-07-27",
    ),
    "unconfirmed",
  );
});

test("반복 일정 완료 상태는 선택한 날짜에만 적용한다", () => {
  const recurring = {
    date: "2026-07-21",
    start: "09:00",
    end: "10:00",
    repeat: [2, 3, 4, 5],
    status: "completed",
    occurrenceStatuses: {
      "2026-07-21": "completed",
    },
  };
  const wednesdayAfterEnd = new Date(2026, 6, 22, 10, 0);

  assert.equal(
    getScheduleStatus(recurring, wednesdayAfterEnd, "2026-07-21"),
    "completed",
  );
  assert.equal(
    getScheduleStatus(recurring, wednesdayAfterEnd, "2026-07-22"),
    "unconfirmed",
  );
  assert.equal(
    getScheduleStatus(recurring, wednesdayAfterEnd, "2026-07-23"),
    "planned",
  );
  assert.equal(
    getScheduleStatus(recurring, wednesdayAfterEnd, "2026-07-24"),
    "planned",
  );
});

test("주간 반복 일정을 발생 날짜별 독립 상태로 펼친다", () => {
  const recurring = {
    id: 1,
    date: "2026-07-21",
    start: "09:00",
    end: "10:00",
    repeat: [2, 3, 4, 5],
    status: "completed",
    occurrenceStatuses: {
      "2026-07-21": "completed",
    },
  };
  const week = [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
    "2026-07-26",
  ];
  const occurrences = materializePlanOccurrences(
    [recurring],
    week,
    new Date(2026, 6, 22, 10, 0),
  );

  assert.deepEqual(
    occurrences.map(({ occurrenceDate, status }) => ({
      occurrenceDate,
      status,
    })),
    [
      { occurrenceDate: "2026-07-21", status: "completed" },
      { occurrenceDate: "2026-07-22", status: "unconfirmed" },
      { occurrenceDate: "2026-07-23", status: "planned" },
      { occurrenceDate: "2026-07-24", status: "planned" },
    ],
  );
  assert.equal(calculateCompletionRate(occurrences), 100);
});

test("통계용 반복 일정은 유효한 발생일의 확정 상태만 센다", () => {
  const assessed = getAssessedPlanOccurrences([
    {
      id: 1,
      date: "2026-07-21",
      start: "09:00",
      end: "10:00",
      repeat: [2, 3, 4, 5],
      status: "completed",
      occurrenceStatuses: {
        "2026-07-21": "completed",
        "2026-07-22": "incomplete",
        "2026-07-25": "completed",
        invalid: "completed",
      },
    },
    {
      id: 2,
      date: "2026-07-23",
      start: "11:00",
      end: "12:00",
      repeat: [],
      status: "completed",
    },
    {
      id: 3,
      date: "2026-07-24",
      start: "11:00",
      end: "12:00",
      repeat: null,
      status: "planned",
    },
  ]);

  assert.deepEqual(
    assessed.map(({ id, date, occurrenceDate, status }) => ({
      id,
      date,
      occurrenceDate,
      status,
    })),
    [
      {
        id: 1,
        date: "2026-07-21",
        occurrenceDate: "2026-07-21",
        status: "completed",
      },
      {
        id: 1,
        date: "2026-07-22",
        occurrenceDate: "2026-07-22",
        status: "incomplete",
      },
      {
        id: 2,
        date: "2026-07-23",
        occurrenceDate: "2026-07-23",
        status: "completed",
      },
    ],
  );
  assert.equal(calculateCompletionRate(assessed), 67);
});

test("완료율은 확인된 일정만 대상으로 반올림한다", () => {
  assert.equal(
    calculateCompletionRate([
      { status: "completed" },
      { status: "completed" },
      { status: "incomplete" },
      { status: "unconfirmed" },
      { status: "planned" },
    ]),
    67,
  );
  assert.equal(calculateCompletionRate([{ status: "unconfirmed" }]), 0);
});

test("오늘 진행 중 일정은 건너뛰고 성공한 수련일의 연속 기록을 센다", () => {
  const plans = [
    { date: "2026-07-20", status: "completed" },
    { date: "2026-07-22", status: "incomplete" },
    { date: "2026-07-23", status: "completed" },
    { date: "2026-07-24", status: "completed" },
    { date: "2026-07-26", status: "planned" },
    { date: "2026-07-27", status: "completed" },
  ];

  assert.equal(calculateCompletionStreak(plans, "2026-07-26"), 2);
  assert.equal(
    calculateCompletionStreak(
      [...plans, { date: "2026-07-26", status: "unconfirmed" }],
      "2026-07-26",
    ),
    0,
  );
});

test("화산오검이 순환하며 확정된 대사를 말한다", () => {
  assert.deepEqual(getCharacterDialogue("completed", 0), {
    character: "청명",
    message: "오, 좀 하는데?",
  });
  assert.deepEqual(getCharacterDialogue("incomplete", 4), {
    character: "윤종",
    message: "도망친다고 될 일이 아니다. 다음에는 꼭 하거라.",
  });
  assert.deepEqual(getCharacterDialogue("completed", 5), {
    character: "청명",
    message: "오, 좀 하는데?",
  });
  assert.deepEqual(getCharacterDialogue("unconfirmed", -1), {
    character: "윤종",
    message: "뭐야, 왜 안 왔어?",
  });
  assert.equal(getCharacterDialogue("planned", 0), null);

  for (let index = 0; index < CHARACTER_ORDER.length; index += 1) {
    assert.equal(
      getCharacterDialogue("unconfirmed", index).message,
      "뭐야, 왜 안 왔어?",
    );
  }
});
