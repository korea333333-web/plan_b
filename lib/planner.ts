export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PlanStatus =
  | "planned"
  | "completed"
  | "incomplete"
  | "unconfirmed";

export interface PlanLike {
  date: string;
  start: string;
  end: string;
  repeat: number[] | null;
  status: PlanStatus;
  occurrenceStatuses?: Record<string, "completed" | "incomplete">;
}

export interface AutoPlanTask {
  id: string;
  title: string;
  totalMinutes: number;
  category?: string | null;
  memo?: string;
}

export interface AvailabilityWindow {
  weekday: Weekday;
  startTime: string;
  endTime: string;
}

export interface AutoPlanInput {
  tasks: AutoPlanTask[];
  startDate: string;
  endDate: string;
  allowedWeekdays: Weekday[];
  availability: AvailabilityWindow[];
  maxMinutesPerDay: number;
  slotMinutes?: number;
}

export interface AutoPlannedItem {
  key: string;
  sourceTaskId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  repeat: number[];
  category: string | null;
  memo: string;
  status: "planned";
  source: "auto";
  durationMinutes: number;
}

export interface UnscheduledTask {
  taskId: string;
  title: string;
  remainingMinutes: number;
}

export interface AutoPlanResult {
  plans: AutoPlannedItem[];
  unscheduled: UnscheduledTask[];
  scheduledMinutes: number;
  unscheduledMinutes: number;
  capacityMinutes: number;
}

export type CharacterName =
  | "청명"
  | "백천"
  | "유이설"
  | "조걸"
  | "윤종";

export interface CharacterDialogue {
  character: CharacterName;
  message: string;
}

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

interface MinuteWindow {
  start: number;
  end: number;
}

interface PlanningDay {
  date: string;
  windows: MinuteWindow[];
  capacity: number;
  budget: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_DATE_RANGE_DAYS = 3660;

export const CHARACTER_ORDER = [
  "청명",
  "백천",
  "유이설",
  "조걸",
  "윤종",
] as const satisfies readonly CharacterName[];

export const CHARACTER_DIALOGUES = {
  청명: {
    completed: "오, 좀 하는데?",
    incomplete: "어디서 할 일을 빼먹고 있어? 뒈지려고?",
    unconfirmed: "뭐야, 왜 안 왔어?",
  },
  백천: {
    completed: "잘했다. 네가 정말 자랑스럽다.",
    incomplete: "네가 처한 상황이 지금 한가해 보이냐? 빨리빨리 해!",
    unconfirmed: "뭐야, 왜 안 왔어?",
  },
  유이설: {
    completed: "할 일은 잘하네. 착해.",
    incomplete: "느려. 빨리 해.",
    unconfirmed: "뭐야, 왜 안 왔어?",
  },
  조걸: {
    completed: "이건 청명이도 인정하겠는데?",
    incomplete: "앞으로 잘해! 청명이한테 찍힌다.",
    unconfirmed: "뭐야, 왜 안 왔어?",
  },
  윤종: {
    completed: "정말 고생 많았다. 네가 잘할 줄 알았다.",
    incomplete: "도망친다고 될 일이 아니다. 다음에는 꼭 하거라.",
    unconfirmed: "뭐야, 왜 안 왔어?",
  },
} as const satisfies Record<
  CharacterName,
  Record<Exclude<PlanStatus, "planned">, string>
>;

function parseDateKey(date: string): ParsedDate {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new RangeError(`날짜는 YYYY-MM-DD 형식이어야 합니다: ${date}`);
  }

  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const value = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day),
  );

  if (
    value.getUTCFullYear() !== parsed.year ||
    value.getUTCMonth() !== parsed.month - 1 ||
    value.getUTCDate() !== parsed.day
  ) {
    throw new RangeError(`존재하지 않는 날짜입니다: ${date}`);
  }

  return parsed;
}

function dateToUtcMilliseconds(date: string): number {
  const parsed = parseDateKey(date);
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

function formatUtcDate(milliseconds: number): string {
  const date = new Date(milliseconds);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("유효하지 않은 Date입니다.");
  }

  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseClock(value: string): number {
  if (value === "24:00") {
    return 24 * 60;
  }
  if (!CLOCK_PATTERN.test(value)) {
    throw new RangeError(`시간은 HH:mm 형식이어야 합니다: ${value}`);
  }

  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatClock(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw new RangeError(`하루 범위를 벗어난 분 단위 시간입니다: ${minutes}`);
  }

  if (minutes === 24 * 60) {
    return "24:00";
  }

  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function assertWeekday(value: number): asserts value is Weekday {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new RangeError(`요일은 0(일)부터 6(토) 사이여야 합니다: ${value}`);
  }
}

function mergeWindows(windows: AvailabilityWindow[]): MinuteWindow[] {
  const sorted = windows
    .map(({ startTime, endTime }) => {
      const start = parseClock(startTime);
      const end = parseClock(endTime);
      if (start >= end) {
        throw new RangeError(
          `가능 시간의 종료 시각은 시작 시각보다 늦어야 합니다: ${startTime}-${endTime}`,
        );
      }
      return { start, end };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: MinuteWindow[] = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (!previous || window.start > previous.end) {
      merged.push({ ...window });
    } else {
      previous.end = Math.max(previous.end, window.end);
    }
  }
  return merged;
}

function buildPlanningDays(input: AutoPlanInput): PlanningDay[] {
  const dates = getDateRange(input.startDate, input.endDate);
  const allowed = new Set(input.allowedWeekdays);
  const windowsByWeekday = new Map<Weekday, AvailabilityWindow[]>();

  for (const weekday of input.allowedWeekdays) {
    assertWeekday(weekday);
  }
  for (const window of input.availability) {
    assertWeekday(window.weekday);
    const grouped = windowsByWeekday.get(window.weekday) ?? [];
    grouped.push(window);
    windowsByWeekday.set(window.weekday, grouped);
  }

  return dates.flatMap((date) => {
    const weekday = getWeekday(date);
    if (!allowed.has(weekday)) {
      return [];
    }

    const windows = mergeWindows(windowsByWeekday.get(weekday) ?? []);
    const availableMinutes = windows.reduce(
      (total, window) => total + window.end - window.start,
      0,
    );
    const capacity = Math.min(input.maxMinutesPerDay, availableMinutes);
    if (capacity <= 0) {
      return [];
    }

    return [{ date, windows, capacity, budget: 0 }];
  });
}

function findNearestDayWithCapacity(
  days: PlanningDay[],
  targetIndex: number,
): number {
  for (let distance = 0; distance < days.length; distance += 1) {
    const later = targetIndex + distance;
    if (
      later < days.length &&
      days[later].budget < days[later].capacity
    ) {
      return later;
    }

    const earlier = targetIndex - distance;
    if (
      distance > 0 &&
      earlier >= 0 &&
      days[earlier].budget < days[earlier].capacity
    ) {
      return earlier;
    }
  }
  return -1;
}

function distributeDailyBudgets(
  days: PlanningDay[],
  totalMinutes: number,
  slotMinutes: number,
): void {
  const availableCapacity = days.reduce(
    (total, day) => total + day.capacity,
    0,
  );
  const minutesToSchedule = Math.min(totalMinutes, availableCapacity);
  const chunkCount = Math.ceil(minutesToSchedule / slotMinutes);
  let remaining = minutesToSchedule;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    let chunkRemaining = Math.min(slotMinutes, remaining);
    const targetIndex = Math.min(
      days.length - 1,
      Math.floor(((chunkIndex + 0.5) * days.length) / chunkCount),
    );

    while (chunkRemaining > 0) {
      const dayIndex = findNearestDayWithCapacity(days, targetIndex);
      if (dayIndex < 0) {
        return;
      }

      const free = days[dayIndex].capacity - days[dayIndex].budget;
      const assigned = Math.min(chunkRemaining, free);
      days[dayIndex].budget += assigned;
      chunkRemaining -= assigned;
      remaining -= assigned;
    }
  }
}

function validateAutoPlanInput(input: AutoPlanInput): number {
  getDateRange(input.startDate, input.endDate);

  if (
    !Number.isInteger(input.maxMinutesPerDay) ||
    input.maxMinutesPerDay <= 0
  ) {
    throw new RangeError("하루 최대 시간은 1분 이상의 정수여야 합니다.");
  }

  const slotMinutes = input.slotMinutes ?? 30;
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    throw new RangeError("계획 단위는 1분 이상의 정수여야 합니다.");
  }

  const taskIds = new Set<string>();
  for (const task of input.tasks) {
    if (!task.id.trim()) {
      throw new TypeError("과제 id는 비어 있을 수 없습니다.");
    }
    if (taskIds.has(task.id)) {
      throw new TypeError(`과제 id가 중복되었습니다: ${task.id}`);
    }
    taskIds.add(task.id);

    if (!task.title.trim()) {
      throw new TypeError(`과제 제목은 비어 있을 수 없습니다: ${task.id}`);
    }
    if (!Number.isInteger(task.totalMinutes) || task.totalMinutes <= 0) {
      throw new RangeError(
        `과제 시간은 1분 이상의 정수여야 합니다: ${task.id}`,
      );
    }
  }

  return slotMinutes;
}

function scheduleDay(
  day: PlanningDay,
  taskStates: Array<AutoPlanTask & { remainingMinutes: number }>,
  firstTaskIndex: number,
  sequenceStart: number,
): {
  plans: AutoPlannedItem[];
  nextTaskIndex: number;
  nextSequence: number;
} {
  const plans: AutoPlannedItem[] = [];
  let taskIndex = firstTaskIndex;
  let dayRemaining = day.budget;
  let sequence = sequenceStart;

  for (const window of day.windows) {
    let cursor = window.start;

    while (
      cursor < window.end &&
      dayRemaining > 0 &&
      taskIndex < taskStates.length
    ) {
      const task = taskStates[taskIndex];
      if (task.remainingMinutes <= 0) {
        taskIndex += 1;
        continue;
      }

      const duration = Math.min(
        task.remainingMinutes,
        dayRemaining,
        window.end - cursor,
      );
      const start = formatClock(cursor);
      const end = formatClock(cursor + duration);

      plans.push({
        key: `${task.id}:${day.date}:${sequence}`,
        sourceTaskId: task.id,
        title: task.title.trim(),
        date: day.date,
        start,
        end,
        repeat: [],
        category: task.category?.trim() || null,
        memo: task.memo?.trim() ?? "",
        status: "planned",
        source: "auto",
        durationMinutes: duration,
      });

      sequence += 1;
      cursor += duration;
      dayRemaining -= duration;
      task.remainingMinutes -= duration;
      if (task.remainingMinutes === 0) {
        taskIndex += 1;
      }
    }

    if (dayRemaining === 0 || taskIndex >= taskStates.length) {
      break;
    }
  }

  return {
    plans,
    nextTaskIndex: taskIndex,
    nextSequence: sequence,
  };
}

/**
 * 날짜 문자열에 일수를 더합니다. 날짜 계산은 실행 환경의 시간대와 무관합니다.
 */
export function addDays(date: string, amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new RangeError("더할 일수는 정수여야 합니다.");
  }
  return formatUtcDate(dateToUtcMilliseconds(date) + amount * 86_400_000);
}

/**
 * 일요일을 0, 토요일을 6으로 반환합니다.
 */
export function getWeekday(date: string): Weekday {
  return new Date(dateToUtcMilliseconds(date)).getUTCDay() as Weekday;
}

/**
 * 기준 날짜가 속한 주의 날짜 7개를 반환합니다. 기본 시작 요일은 월요일입니다.
 */
export function getWeekDates(
  anchorDate: string,
  weekStartsOn: Weekday = 1,
): string[] {
  assertWeekday(weekStartsOn);
  const weekday = getWeekday(anchorDate);
  const offset = (weekday - weekStartsOn + 7) % 7;
  const firstDate = addDays(anchorDate, -offset);
  return Array.from({ length: 7 }, (_, index) => addDays(firstDate, index));
}

/**
 * 시작일과 종료일을 모두 포함한 날짜 목록을 반환합니다.
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const start = dateToUtcMilliseconds(startDate);
  const end = dateToUtcMilliseconds(endDate);
  if (start > end) {
    throw new RangeError("종료일은 시작일보다 빠를 수 없습니다.");
  }

  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount > MAX_DATE_RANGE_DAYS) {
    throw new RangeError(
      `자동 계획 기간은 ${MAX_DATE_RANGE_DAYS}일을 넘을 수 없습니다.`,
    );
  }

  return Array.from({ length: dayCount }, (_, index) =>
    formatUtcDate(start + index * 86_400_000),
  );
}

/**
 * 목표 과제를 입력 순서(우선순위)대로 가능한 날짜와 시간에 배치합니다.
 * 날짜별 예산은 전체 기간에 고르게 퍼지도록 계산됩니다.
 */
export function generateAutoPlan(input: AutoPlanInput): AutoPlanResult {
  const slotMinutes = validateAutoPlanInput(input);
  const taskStates = input.tasks.map((task) => ({
    ...task,
    remainingMinutes: task.totalMinutes,
  }));
  const totalMinutes = taskStates.reduce(
    (total, task) => total + task.totalMinutes,
    0,
  );
  const days = buildPlanningDays(input);
  const capacityMinutes = days.reduce(
    (total, day) => total + day.capacity,
    0,
  );

  distributeDailyBudgets(days, totalMinutes, slotMinutes);

  const plans: AutoPlannedItem[] = [];
  let taskIndex = 0;
  let sequence = 0;
  for (const day of days) {
    if (day.budget <= 0 || taskIndex >= taskStates.length) {
      continue;
    }

    const scheduled = scheduleDay(day, taskStates, taskIndex, sequence);
    plans.push(...scheduled.plans);
    taskIndex = scheduled.nextTaskIndex;
    sequence = scheduled.nextSequence;
  }

  const unscheduled = taskStates
    .filter((task) => task.remainingMinutes > 0)
    .map((task) => ({
      taskId: task.id,
      title: task.title.trim(),
      remainingMinutes: task.remainingMinutes,
    }));
  const unscheduledMinutes = unscheduled.reduce(
    (total, task) => total + task.remainingMinutes,
    0,
  );

  return {
    plans,
    unscheduled,
    scheduledMinutes: totalMinutes - unscheduledMinutes,
    unscheduledMinutes,
    capacityMinutes,
  };
}

function planEndDate(
  plan: Pick<PlanLike, "date" | "end">,
  occurrenceDate: string = plan.date,
): Date {
  const parsed = parseDateKey(occurrenceDate);
  const endMinutes = parseClock(plan.end);
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    Math.floor(endMinutes / 60),
    endMinutes % 60,
    0,
    0,
  );
}

/**
 * 일정 종료 시각과 현재 시각을 비교합니다. 종료 시각과 같으면 종료된 일정입니다.
 */
export function hasScheduleEnded(
  plan: Pick<PlanLike, "date" | "end">,
  now: Date = new Date(),
  occurrenceDate: string = plan.date,
): boolean {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("현재 시각이 유효하지 않습니다.");
  }
  return now.getTime() >= planEndDate(plan, occurrenceDate).getTime();
}

/**
 * 날짜별 완료/미완료 상태를 가장 먼저 적용합니다. 반복 일정은 날짜별
 * 상태가 없으면 전역 상태를 퍼뜨리지 않고 planned 일정처럼 판정합니다.
 */
export function getScheduleStatus(
  plan: Pick<
    PlanLike,
    "date" | "end" | "repeat" | "status" | "occurrenceStatuses"
  >,
  now: Date = new Date(),
  occurrenceDate: string = plan.date,
): PlanStatus {
  const occurrenceStatus = plan.occurrenceStatuses?.[occurrenceDate];
  if (occurrenceStatus) {
    return occurrenceStatus;
  }

  const isRecurring = Boolean(plan.repeat?.length);
  if (!isRecurring && plan.status !== "planned") {
    return plan.status;
  }
  return hasScheduleEnded(plan, now, occurrenceDate)
    ? "unconfirmed"
    : "planned";
}

/**
 * 반복이 없으면 지정 날짜에 한 번만, 반복 요일이 있으면 시작일 이후의
 * 선택 요일에만 일정이 발생합니다.
 */
export function planOccursOnDate(
  plan: Pick<PlanLike, "date" | "repeat">,
  occurrenceDate: string,
): boolean {
  parseDateKey(plan.date);
  if (occurrenceDate < plan.date) {
    parseDateKey(occurrenceDate);
    return false;
  }

  if (!plan.repeat?.length) {
    parseDateKey(occurrenceDate);
    return occurrenceDate === plan.date;
  }

  return plan.repeat.includes(getWeekday(occurrenceDate));
}

export type MaterializedPlanOccurrence<T extends PlanLike> = T & {
  occurrenceDate: string;
  status: PlanStatus;
};

export type AssessedPlanOccurrence<T extends PlanLike> = T & {
  date: string;
  occurrenceDate: string;
  status: "completed" | "incomplete";
};

/**
 * 요청한 날짜들에 실제로 발생하는 일정을 날짜별 상태와 함께 펼칩니다.
 */
export function materializePlanOccurrences<T extends PlanLike>(
  plans: ReadonlyArray<T>,
  dateKeys: ReadonlyArray<string>,
  now: Date = new Date(),
): MaterializedPlanOccurrence<T>[] {
  const occurrences: MaterializedPlanOccurrence<T>[] = [];

  for (const occurrenceDate of dateKeys) {
    parseDateKey(occurrenceDate);
    for (const plan of plans) {
      if (!planOccursOnDate(plan, occurrenceDate)) {
        continue;
      }

      occurrences.push({
        ...plan,
        occurrenceDate,
        status: getScheduleStatus(plan, now, occurrenceDate),
      });
    }
  }

  return occurrences;
}

/**
 * 통계에 포함할 확정 상태를 실제 발생 날짜 단위로 반환합니다.
 */
export function getAssessedPlanOccurrences<T extends PlanLike>(
  plans: ReadonlyArray<T>,
): AssessedPlanOccurrence<T>[] {
  const occurrences: AssessedPlanOccurrence<T>[] = [];

  for (const plan of plans) {
    if (!plan.repeat?.length) {
      if (plan.status === "completed" || plan.status === "incomplete") {
        occurrences.push({
          ...plan,
          occurrenceDate: plan.date,
          status: plan.status,
        });
      }
      continue;
    }

    for (const [occurrenceDate, status] of Object.entries(
      plan.occurrenceStatuses ?? {},
    )) {
      if (status !== "completed" && status !== "incomplete") {
        continue;
      }

      try {
        parseDateKey(occurrenceDate);
      } catch {
        continue;
      }
      if (!planOccursOnDate(plan, occurrenceDate)) {
        continue;
      }

      occurrences.push({
        ...plan,
        date: occurrenceDate,
        occurrenceDate,
        status,
      });
    }
  }

  return occurrences.sort((left, right) =>
    left.occurrenceDate.localeCompare(right.occurrenceDate),
  );
}

/**
 * 사용자가 완료 또는 미완료로 확인한 일정만 분모에 포함합니다.
 */
export function calculateCompletionRate(
  plans: ReadonlyArray<Pick<PlanLike, "status">>,
): number {
  let completed = 0;
  let assessed = 0;

  for (const plan of plans) {
    if (plan.status === "completed") {
      completed += 1;
      assessed += 1;
    } else if (plan.status === "incomplete") {
      assessed += 1;
    }
  }

  return assessed === 0 ? 0 : Math.round((completed / assessed) * 100);
}

/**
 * 계획이 있는 날만 수련일로 셉니다. 오늘 일정이 아직 진행 중(planned)이면
 * 오늘은 건너뛰고 이전 수련일부터 계산하며, 실패/미확인은 연속 기록을 끊습니다.
 */
export function calculateCompletionStreak(
  plans: ReadonlyArray<Pick<PlanLike, "date" | "status">>,
  today: string | Date = new Date(),
): number {
  const todayKey = typeof today === "string" ? today : formatLocalDate(today);
  parseDateKey(todayKey);

  const statusesByDate = new Map<string, PlanStatus[]>();
  for (const plan of plans) {
    parseDateKey(plan.date);
    if (plan.date > todayKey) {
      continue;
    }
    const statuses = statusesByDate.get(plan.date) ?? [];
    statuses.push(plan.status);
    statusesByDate.set(plan.date, statuses);
  }

  const dates = [...statusesByDate.keys()].sort((left, right) =>
    right.localeCompare(left),
  );
  let streak = 0;

  for (const date of dates) {
    const statuses = statusesByDate.get(date) ?? [];
    const hasFailure = statuses.some(
      (status) => status === "incomplete" || status === "unconfirmed",
    );
    if (hasFailure) {
      break;
    }

    const allCompleted =
      statuses.length > 0 &&
      statuses.every((status) => status === "completed");
    if (allCompleted) {
      streak += 1;
      continue;
    }

    if (date === todayKey && statuses.some((status) => status === "planned")) {
      continue;
    }
    break;
  }

  return streak;
}

/**
 * rotationIndex를 0부터 올리면 화산오검이 정해진 순서로 반복 등장합니다.
 * 아직 시간이 지나지 않은 planned 일정에는 대사가 없습니다.
 */
export function getCharacterDialogue(
  status: PlanStatus,
  rotationIndex: number,
): CharacterDialogue | null {
  if (status === "planned") {
    return null;
  }
  if (!Number.isInteger(rotationIndex)) {
    throw new RangeError("캐릭터 순번은 정수여야 합니다.");
  }

  const normalizedIndex =
    ((rotationIndex % CHARACTER_ORDER.length) + CHARACTER_ORDER.length) %
    CHARACTER_ORDER.length;
  const character = CHARACTER_ORDER[normalizedIndex];
  return {
    character,
    message: CHARACTER_DIALOGUES[character][status],
  };
}
