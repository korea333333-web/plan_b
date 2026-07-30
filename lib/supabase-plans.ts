// @ts-expect-error Node의 type-stripping 테스트 실행기는 .ts 소스를 직접 읽는다.
import * as planTypes from "./plan-types.ts";
import type {
  AssessedPlanStatus,
  OccurrenceStatuses,
  Plan,
  PlanSource,
  PlanStatus,
  PlanUpdate,
  PlanWritableFields,
} from "./plan-types.ts";

const { ASSESSED_PLAN_STATUSES, PLAN_SOURCES, PLAN_STATUSES } = planTypes;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export type SupabasePlanRow = {
  id: number | string;
  user_id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  repeat: unknown;
  category: string | null;
  memo: string;
  status: string;
  occurrence_statuses: unknown;
  source: string;
  created_at: string;
  updated_at: string;
};

export type SupabasePlanInsert = {
  user_id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  repeat: number[] | null;
  category: string | null;
  memo: string;
  status: PlanStatus;
  occurrence_statuses: OccurrenceStatuses;
  source: PlanSource;
};

export type SupabasePlanUpdate = Partial<
  Omit<SupabasePlanInsert, "user_id">
> & {
  updated_at: string;
};

type PlanSignatureInput = Pick<
  Plan,
  | "title"
  | "date"
  | "start"
  | "end"
  | "repeat"
  | "category"
  | "memo"
  | "source"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isValidDateKey(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function readRequiredString(
  row: Record<string, unknown>,
  field: string,
): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new TypeError(`Supabase 계획의 ${field} 값이 문자열이 아닙니다.`);
  }
  return value;
}

function readPlanId(value: unknown): number {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && POSITIVE_INTEGER_PATTERN.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Supabase 계획의 id가 올바른 양의 정수가 아닙니다.");
  }
  return id;
}

function normalizeStatus(value: unknown): PlanStatus {
  return typeof value === "string" &&
    PLAN_STATUSES.includes(value as PlanStatus)
    ? (value as PlanStatus)
    : "planned";
}

function normalizeSource(value: unknown): PlanSource {
  return typeof value === "string" &&
    PLAN_SOURCES.includes(value as PlanSource)
    ? (value as PlanSource)
    : "manual";
}

/**
 * json/jsonb 또는 과거 D1 문자열 값을 안전하게 요일 배열로 바꾼다.
 * 손상된 원소는 버리고, 중복 제거 후 요일 순으로 정렬한다.
 */
export function parsePlanRepeat(value: unknown): number[] | null {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return null;
  }

  const days = parsed.filter(
    (day): day is number =>
      Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
  );
  const normalized = [...new Set(days)].sort((left, right) => left - right);
  return normalized.length ? normalized : null;
}

/**
 * 발생 날짜별 판정 중 유효한 날짜와 완료/미완료 값만 남긴다.
 * 반환 키 순서를 고정하여 중복 판정도 항상 같은 결과가 되게 한다.
 */
export function parseOccurrenceStatuses(value: unknown): OccurrenceStatuses {
  const parsed = parseJsonValue(value);
  if (!isRecord(parsed)) {
    return {};
  }

  const entries = Object.entries(parsed)
    .filter(
      (entry): entry is [string, AssessedPlanStatus] =>
        isValidDateKey(entry[0]) &&
        typeof entry[1] === "string" &&
        ASSESSED_PLAN_STATUSES.includes(entry[1] as AssessedPlanStatus),
    )
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

/**
 * Supabase의 snake_case 행을 기존 화면의 camelCase 계획으로 변환한다.
 */
export function fromSupabasePlanRow(rowValue: unknown): Plan {
  if (!isRecord(rowValue)) {
    throw new TypeError("Supabase 계획 행이 객체가 아닙니다.");
  }

  const userId = readRequiredString(rowValue, "user_id");
  const categoryValue = rowValue.category;

  return {
    id: readPlanId(rowValue.id),
    clientId: userId,
    title: readRequiredString(rowValue, "title"),
    date: readRequiredString(rowValue, "date"),
    start: readRequiredString(rowValue, "start"),
    end: readRequiredString(rowValue, "end"),
    repeat: parsePlanRepeat(rowValue.repeat),
    category:
      typeof categoryValue === "string" ? categoryValue : null,
    memo: typeof rowValue.memo === "string" ? rowValue.memo : "",
    status: normalizeStatus(rowValue.status),
    occurrenceStatuses: parseOccurrenceStatuses(
      rowValue.occurrence_statuses,
    ),
    source: normalizeSource(rowValue.source),
    createdAt: readRequiredString(rowValue, "created_at"),
    updatedAt: readRequiredString(rowValue, "updated_at"),
  };
}

function normalizeWritablePlan(
  plan: PlanWritableFields,
): Omit<SupabasePlanInsert, "user_id"> {
  return {
    title: plan.title.trim(),
    date: plan.date,
    start: plan.start,
    end: plan.end,
    repeat: parsePlanRepeat(plan.repeat),
    category: plan.category?.trim() || null,
    memo: plan.memo.trim(),
    status: normalizeStatus(plan.status),
    occurrence_statuses: parseOccurrenceStatuses(
      plan.occurrenceStatuses,
    ),
    source: normalizeSource(plan.source),
  };
}

/**
 * 신규 계획을 Supabase insert payload로 변환한다.
 * `created_at`과 `updated_at`은 데이터베이스 기본값을 사용한다.
 */
export function toSupabasePlanInsert(
  plan: PlanWritableFields,
  userId: string,
): SupabasePlanInsert {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new TypeError("Supabase 사용자 id가 필요합니다.");
  }

  return {
    user_id: normalizedUserId,
    ...normalizeWritablePlan(plan),
  };
}

/**
 * 화면의 부분 수정값을 Supabase update payload로 변환한다.
 */
export function toSupabasePlanUpdate(
  update: PlanUpdate,
  updatedAt: string = new Date().toISOString(),
): SupabasePlanUpdate {
  const payload: SupabasePlanUpdate = { updated_at: updatedAt };

  if (update.title !== undefined) payload.title = update.title.trim();
  if (update.date !== undefined) payload.date = update.date;
  if (update.start !== undefined) payload.start = update.start;
  if (update.end !== undefined) payload.end = update.end;
  if (update.repeat !== undefined) {
    payload.repeat = parsePlanRepeat(update.repeat);
  }
  if (update.category !== undefined) {
    payload.category = update.category?.trim() || null;
  }
  if (update.memo !== undefined) payload.memo = update.memo.trim();
  if (update.status !== undefined) {
    payload.status = normalizeStatus(update.status);
  }
  if (update.occurrenceStatuses !== undefined) {
    payload.occurrence_statuses = parseOccurrenceStatuses(
      update.occurrenceStatuses,
    );
  }
  if (update.source !== undefined) {
    payload.source = normalizeSource(update.source);
  }

  return payload;
}

/**
 * 로컬/D1의 기존 계획과 Supabase 계획을 비교하는 안정적인 서명이다.
 * 저장소별 id, 사용자 id, 생성/수정 시각과 판정 상태는 의도적으로
 * 제외한다. 가져오기를 재시도하는 동안 상태가 바뀌어도 같은 계획을
 * 다시 추가하지 않는 것을 우선한다.
 */
export function getPlanSignature(plan: PlanSignatureInput): string {
  return JSON.stringify([
    plan.title.trim(),
    plan.date,
    plan.start,
    plan.end,
    parsePlanRepeat(plan.repeat),
    plan.category?.trim() || null,
    plan.memo.trim(),
    normalizeSource(plan.source),
  ]);
}
