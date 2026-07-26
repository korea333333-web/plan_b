import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  assessedPlanStatuses,
  plans,
  planSources,
  planStatuses,
  type AssessedPlanStatus,
  type NewPlan,
  type PlanSource,
  type PlanStatus,
} from "../../../db/schema";
import { planOccursOnDate } from "../../../lib/planner";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_RESULTS = 500;

type InputObject = Record<string, unknown>;

type ValidPlanInput = {
  title: string;
  date: string;
  start: string;
  end: string;
  repeat: number[] | null;
  category: string | null;
  memo: string;
  status: PlanStatus;
  source: PlanSource;
};

class RequestValidationError extends Error {}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is InputObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(request: Request): Promise<InputObject> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new RequestValidationError("올바른 JSON 요청을 보내 주세요.");
  }

  if (!isRecord(payload)) {
    throw new RequestValidationError("요청 본문은 객체여야 합니다.");
  }

  return payload;
}

function readClientId(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_ID_PATTERN.test(value)) {
    throw new RequestValidationError(
      "clientId는 8~128자의 영문, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.",
    );
  }

  return value;
}

function readId(value: unknown): number {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RequestValidationError("올바른 계획 id가 필요합니다.");
  }

  return id;
}

function readRequiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new RequestValidationError(`${label}을(를) 입력해 주세요.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new RequestValidationError(`${label}을(를) 입력해 주세요.`);
  }
  if (normalized.length > maxLength) {
    throw new RequestValidationError(
      `${label}은(는) ${maxLength}자 이하여야 합니다.`,
    );
  }

  return normalized;
}

function readOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
  fallback: string | null,
): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new RequestValidationError(`${label} 형식이 올바르지 않습니다.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new RequestValidationError(
      `${label}은(는) ${maxLength}자 이하여야 합니다.`,
    );
  }

  return normalized || null;
}

function readDate(value: unknown, label = "날짜"): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new RequestValidationError(
      `${label}는 YYYY-MM-DD 형식이어야 합니다.`,
    );
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RequestValidationError(`${label}가 유효하지 않습니다.`);
  }

  return value;
}

function readTime(value: unknown, label: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new RequestValidationError(`${label}은 HH:mm 형식이어야 합니다.`);
  }

  return value;
}

function readRepeat(value: unknown, fallback: number[] | null): number[] | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new RequestValidationError(
      "repeat는 0(일요일)부터 6(토요일)까지의 숫자 배열이어야 합니다.",
    );
  }

  return [...new Set(value as number[])].sort((a, b) => a - b);
}

function readAssessedStatus(value: unknown): AssessedPlanStatus {
  if (
    typeof value !== "string" ||
    !assessedPlanStatuses.includes(value as AssessedPlanStatus)
  ) {
    throw new RequestValidationError(
      "occurrenceStatus는 completed 또는 incomplete여야 합니다.",
    );
  }

  return value as AssessedPlanStatus;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new RequestValidationError(
      `${label} 값은 ${allowed.join(", ")} 중 하나여야 합니다.`,
    );
  }

  return value as T;
}

function validatePlanInput(
  payload: InputObject,
  fallback?: ValidPlanInput,
): ValidPlanInput {
  const title =
    payload.title === undefined && fallback
      ? fallback.title
      : readRequiredText(payload.title, "제목", 120);
  const date =
    payload.date === undefined && fallback
      ? fallback.date
      : readDate(payload.date);
  const start =
    payload.start === undefined && fallback
      ? fallback.start
      : readTime(payload.start, "시작 시간");
  const end =
    payload.end === undefined && fallback
      ? fallback.end
      : readTime(payload.end, "종료 시간");
  const repeat = readRepeat(payload.repeat, fallback?.repeat ?? null);
  const category = readOptionalText(
    payload.category,
    "카테고리",
    40,
    fallback?.category ?? null,
  );
  const memo =
    readOptionalText(payload.memo, "메모", 1000, fallback?.memo ?? "") ?? "";
  const status = readEnum(
    payload.status,
    planStatuses,
    "상태",
    fallback?.status ?? "planned",
  );
  const source = readEnum(
    payload.source,
    planSources,
    "생성 방식",
    fallback?.source ?? "manual",
  );

  if (start >= end) {
    throw new RequestValidationError(
      "종료 시간은 시작 시간보다 늦어야 합니다.",
    );
  }

  return {
    title,
    date,
    start,
    end,
    repeat,
    category,
    memo,
    status,
    source,
  };
}

function toValidPlanInput(plan: typeof plans.$inferSelect): ValidPlanInput {
  return {
    title: plan.title,
    date: plan.date,
    start: plan.start,
    end: plan.end,
    repeat: plan.repeat,
    category: plan.category,
    memo: plan.memo,
    status: plan.status,
    source: plan.source,
  };
}

function databaseErrorResponse(error: unknown): Response {
  if (error instanceof RequestValidationError) {
    return jsonError(error.message, 400);
  }

  const message = error instanceof Error ? error.message : "";
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const details = `${message}\n${cause}`;

  if (details.includes("no such table") || details.includes('from "plans"')) {
    return jsonError(
      "계획 저장소를 준비하는 중입니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  console.error("Plans API error", error);
  return jsonError("계획을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clientId = readClientId(url.searchParams.get("clientId"));
    const fromValue = url.searchParams.get("from");
    const toValue = url.searchParams.get("to");
    const from = fromValue === null ? null : readDate(fromValue, "시작 날짜");
    const to = toValue === null ? null : readDate(toValue, "종료 날짜");

    if (from && to && from > to) {
      throw new RequestValidationError(
        "종료 날짜는 시작 날짜보다 빠를 수 없습니다.",
      );
    }

    const filters = [eq(plans.clientId, clientId)];
    if (from) filters.push(gte(plans.date, from));
    if (to) filters.push(lte(plans.date, to));

    const rows = await getDb()
      .select()
      .from(plans)
      .where(and(...filters))
      .orderBy(asc(plans.date), asc(plans.start), asc(plans.id))
      .limit(MAX_RESULTS);

    return Response.json({ plans: rows });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readJsonObject(request);
    const clientId = readClientId(payload.clientId);
    const input = validatePlanInput(payload);
    const now = new Date().toISOString();
    const values: NewPlan = {
      clientId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    const [plan] = await getDb().insert(plans).values(values).returning();
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await readJsonObject(request);
    const clientId = readClientId(payload.clientId);
    const id = readId(payload.id);
    const mutableFields = [
      "title",
      "date",
      "start",
      "end",
      "repeat",
      "category",
      "memo",
      "status",
      "occurrenceStatus",
      "source",
    ];

    if (!mutableFields.some((field) => field in payload)) {
      throw new RequestValidationError("변경할 계획 정보가 없습니다.");
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.clientId, clientId)))
      .limit(1);

    if (!existing) {
      return jsonError("계획을 찾을 수 없습니다.", 404);
    }

    const input = validatePlanInput(payload, toValidPlanInput(existing));
    const updatedAt = new Date().toISOString();

    if (existing.repeat?.length) {
      if (payload.status !== undefined) {
        throw new RequestValidationError(
          "반복 계획은 occurrenceStatus로 회차 상태를 변경해야 합니다.",
        );
      }

      if (payload.occurrenceStatus !== undefined) {
        const occurrenceDate = readDate(payload.occurrenceDate, "발생 날짜");
        if (!planOccursOnDate(existing, occurrenceDate)) {
          throw new RequestValidationError(
            "선택한 날짜에는 이 반복 계획이 없습니다.",
          );
        }

        const occurrenceStatus = readAssessedStatus(payload.occurrenceStatus);
        const occurrencePath = `$."${occurrenceDate}"`;
        const [plan] = await db
          .update(plans)
          .set({
            ...input,
            status: "planned",
            occurrenceStatuses: sql`json_set(coalesce(${plans.occurrenceStatuses}, '{}'), ${occurrencePath}, ${occurrenceStatus})`,
            updatedAt,
          })
          .where(and(eq(plans.id, id), eq(plans.clientId, clientId)))
          .returning();

        return Response.json({ plan });
      }
    } else if (payload.occurrenceStatus !== undefined) {
      throw new RequestValidationError(
        "반복하지 않는 계획은 status로 상태를 변경해야 합니다.",
      );
    }

    const [plan] = await db
      .update(plans)
      .set({
        ...input,
        ...(existing.repeat?.length ? { status: "planned" as const } : {}),
        updatedAt,
      })
      .where(and(eq(plans.id, id), eq(plans.clientId, clientId)))
      .returning();

    return Response.json({ plan });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const clientId = readClientId(url.searchParams.get("clientId"));
    const id = readId(url.searchParams.get("id"));
    const [deleted] = await getDb()
      .delete(plans)
      .where(and(eq(plans.id, id), eq(plans.clientId, clientId)))
      .returning({ id: plans.id });

    if (!deleted) {
      return jsonError("계획을 찾을 수 없습니다.", 404);
    }

    return Response.json({ deletedId: deleted.id });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
