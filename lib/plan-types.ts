export const PLAN_STATUSES = [
  "planned",
  "completed",
  "incomplete",
  "unconfirmed",
] as const;

export const ASSESSED_PLAN_STATUSES = [
  "completed",
  "incomplete",
] as const;

export const PLAN_SOURCES = ["manual", "auto"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type AssessedPlanStatus = (typeof ASSESSED_PLAN_STATUSES)[number];
export type PlanSource = (typeof PLAN_SOURCES)[number];
export type OccurrenceStatuses = Record<string, AssessedPlanStatus>;

/**
 * 화면에서 사용하는 계획 모델이다.
 *
 * `clientId`는 기존 D1/localStorage 계획과의 호환을 위해 유지한다.
 * Supabase에서 읽은 계획은 해당 위치에 `user_id`를 넣는다.
 */
export type Plan = {
  id: number;
  clientId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  repeat: number[] | null;
  category: string | null;
  memo: string;
  status: PlanStatus;
  occurrenceStatuses?: OccurrenceStatuses;
  source: PlanSource;
  createdAt: string;
  updatedAt: string;
};

export type PlanDraft = Omit<Plan, "id" | "createdAt" | "updatedAt">;
export type UserPlanDraft = Omit<PlanDraft, "clientId">;

export type PlanWritableFields = Pick<
  Plan,
  | "title"
  | "date"
  | "start"
  | "end"
  | "repeat"
  | "category"
  | "memo"
  | "status"
  | "occurrenceStatuses"
  | "source"
>;

export type PlanUpdate = Partial<PlanWritableFields>;
