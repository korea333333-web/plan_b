import { and, asc, eq, gt, gte, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { plans } from "../../../db/schema";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RESULTS = 500;

class RequestValidationError extends Error {}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readClientId(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_ID_PATTERN.test(value)) {
    throw new RequestValidationError(
      "clientId는 8~128자의 영문, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.",
    );
  }

  return value;
}

function readDate(value: unknown, label: string): string {
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

function readAfterId(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RequestValidationError(
      "afterId는 양의 정수여야 합니다.",
    );
  }

  const afterId = Number(value);
  if (!Number.isSafeInteger(afterId)) {
    throw new RequestValidationError(
      "afterId가 허용 범위를 벗어났습니다.",
    );
  }
  return afterId;
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
      "기존 계획 저장소를 준비하는 중입니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  console.error("Legacy plans API error", error);
  return jsonError(
    "기존 계획을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    500,
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clientId = readClientId(url.searchParams.get("clientId"));
    const fromValue = url.searchParams.get("from");
    const toValue = url.searchParams.get("to");
    const afterId = readAfterId(url.searchParams.get("afterId"));
    const from =
      fromValue === null ? null : readDate(fromValue, "시작 날짜");
    const to = toValue === null ? null : readDate(toValue, "종료 날짜");

    if (from && to && from > to) {
      throw new RequestValidationError(
        "종료 날짜는 시작 날짜보다 빠를 수 없습니다.",
      );
    }

    const filters = [eq(plans.clientId, clientId)];
    if (from) filters.push(gte(plans.date, from));
    if (to) filters.push(lte(plans.date, to));
    if (afterId !== null) filters.push(gt(plans.id, afterId));

    const rows = await getDb()
      .select()
      .from(plans)
      .where(and(...filters))
      .orderBy(asc(plans.id))
      .limit(MAX_RESULTS + 1);

    const page = rows.slice(0, MAX_RESULTS);
    const nextCursor =
      rows.length > MAX_RESULTS ? page.at(-1)?.id ?? null : null;

    return Response.json({
      plans: page,
      complete: nextCursor === null,
      nextCursor,
    });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

function writeBlockedResponse() {
  return jsonError(
    "기존 계획 저장소는 가져오기용 읽기만 허용합니다.",
    405,
  );
}

export async function POST() {
  return writeBlockedResponse();
}

export async function PATCH() {
  return writeBlockedResponse();
}

export async function DELETE() {
  return writeBlockedResponse();
}
