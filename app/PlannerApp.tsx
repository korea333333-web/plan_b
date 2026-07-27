"use client";

import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  calculateCompletionRate,
  calculateCompletionStreak,
  generateAutoPlan,
  getAssessedPlanOccurrences,
  getDateRange,
  getCharacterDialogue,
  getScheduleStatus,
  materializePlanOccurrences,
  planOccursOnDate,
  type Weekday,
} from "../lib/planner";

type PageId = "planner" | "create" | "records";
type PlannerView = "week" | "today";
type TodayView = "list" | "circle";
type PlanStatus = "planned" | "completed" | "incomplete" | "unconfirmed";
type AssessedPlanStatus = "completed" | "incomplete";
type PlanSource = "manual" | "auto";
type StorageMode = "server" | "local";

type Plan = {
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
  occurrenceStatuses?: Record<string, AssessedPlanStatus>;
  source: PlanSource;
  createdAt: string;
  updatedAt: string;
};

type PlanOccurrence = Plan & {
  occurrenceDate: string;
};

type PlanDraft = Omit<Plan, "id" | "createdAt" | "updatedAt">;

type AutoTask = {
  id: string;
  title: string;
  minutes: number;
};

type Reaction = {
  name: string;
  line: string;
  kind: "completed" | "incomplete";
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAYS_LONG = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const subscribeToClientId = () => () => {};
const NAV_ITEMS: { id: PageId; icon: string; label: string }[] = [
  { id: "planner", icon: "週", label: "내 계획표" },
  { id: "create", icon: "作", label: "계획 만들기" },
  { id: "records", icon: "錄", label: "수련 기록" },
];
const CATEGORY_COLORS = ["#ad344b", "#4f6b5b", "#b27b42", "#625f5a", "#7a5f80"];
const CHARACTER_NAMES = ["청명", "백천", "유이설", "조걸", "윤종"] as const;
const LOCAL_PLAN_STORAGE_PREFIX = "maewha-plans:";
const BROWSER_ONLY_STORAGE =
  process.env.NEXT_PUBLIC_PLAN_STORAGE_MODE === "local";
let memoryClientId = "";

function makeBrowserId() {
  const browserCrypto =
    typeof globalThis.crypto === "undefined" ? null : globalThis.crypto;
  if (browserCrypto && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  if (browserCrypto && typeof browserCrypto.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatKoreanDate(date: Date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function startOfWeek(anchor: Date) {
  const date = new Date(anchor);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getWeekDates(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(minutes: number) {
  const safe = Math.max(0, Math.min(24 * 60, minutes));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function planOccursOn(plan: Plan, date: Date) {
  return planOccursOnDate(plan, toDateKey(date));
}

function effectiveStatus(
  plan: Plan | PlanOccurrence,
  now = new Date(),
  occurrenceDate =
    "occurrenceDate" in plan ? plan.occurrenceDate : plan.date,
): PlanStatus {
  return getScheduleStatus(plan, now, occurrenceDate);
}

function statusLabel(status: PlanStatus) {
  if (status === "completed") return "완료";
  if (status === "incomplete") return "미완료";
  if (status === "unconfirmed") return "미확인";
  return "예정";
}

function statusClass(status: PlanStatus) {
  if (status === "completed") return "status-completed";
  if (status === "incomplete") return "status-incomplete";
  if (status === "unconfirmed") return "status-unconfirmed";
  return "status-planned";
}

function getOrCreateClientId() {
  const storageKey = "maewha-client-id";
  if (memoryClientId) return memoryClientId;

  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      memoryClientId = existing;
      return memoryClientId;
    }
    const created = makeBrowserId();
    window.localStorage.setItem(storageKey, created);
    memoryClientId = created;
  } catch {
    // Private browsing or a locked-down browser may not expose localStorage.
    memoryClientId = makeBrowserId();
  }

  return memoryClientId;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new ApiRequestError(
      payload.error || "요청을 처리하지 못했습니다.",
      response.status,
    );
  }
  return payload;
}

function shouldUseLocalFallback(error: unknown) {
  return (
    !(error instanceof ApiRequestError) ||
    error.status === 404 ||
    error.status >= 500
  );
}

function localPlanStorageKey(clientId: string) {
  return `${LOCAL_PLAN_STORAGE_PREFIX}${clientId}`;
}

function isStoredPlan(value: unknown, clientId: string): value is Plan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<Plan>;

  return (
    typeof plan.id === "number" &&
    Number.isSafeInteger(plan.id) &&
    plan.clientId === clientId &&
    typeof plan.title === "string" &&
    typeof plan.date === "string" &&
    typeof plan.start === "string" &&
    typeof plan.end === "string" &&
    (plan.repeat === null ||
      (Array.isArray(plan.repeat) &&
        plan.repeat.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))) &&
    (plan.category === null || typeof plan.category === "string") &&
    typeof plan.memo === "string" &&
    ["planned", "completed", "incomplete", "unconfirmed"].includes(
      plan.status ?? "",
    ) &&
    (plan.occurrenceStatuses === undefined ||
      (typeof plan.occurrenceStatuses === "object" &&
        plan.occurrenceStatuses !== null &&
        !Array.isArray(plan.occurrenceStatuses) &&
        Object.entries(plan.occurrenceStatuses).every(
          ([date, status]) =>
            /^\d{4}-\d{2}-\d{2}$/.test(date) &&
            (status === "completed" || status === "incomplete"),
        ))) &&
    ["manual", "auto"].includes(plan.source ?? "") &&
    typeof plan.createdAt === "string" &&
    typeof plan.updatedAt === "string"
  );
}

function readLocalPlans(clientId: string): Plan[] {
  try {
    const stored = window.localStorage.getItem(localPlanStorageKey(clientId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((plan) => isStoredPlan(plan, clientId))
      .map((plan) => ({
        ...plan,
        status: plan.repeat?.length ? ("planned" as const) : plan.status,
        occurrenceStatuses: plan.occurrenceStatuses ?? {},
      }));
  } catch {
    return [];
  }
}

function writeLocalPlans(clientId: string, plansToStore: Plan[]) {
  try {
    window.localStorage.setItem(
      localPlanStorageKey(clientId),
      JSON.stringify(plansToStore),
    );
  } catch {
    throw new Error("브라우저 저장 공간을 사용할 수 없습니다.");
  }
}

function makeLocalPlanId() {
  const browserCrypto =
    typeof globalThis.crypto === "undefined" ? null : globalThis.crypto;
  const random =
    browserCrypto && typeof browserCrypto.getRandomValues === "function"
      ? browserCrypto.getRandomValues(new Uint16Array(1))[0]
      : Math.floor(Math.random() * 65_536);
  return -(Date.now() * 1_000 + random);
}

function Petals() {
  return (
    <div className="petal-layer" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => (
        <span
          className="falling-petal"
          key={index}
          style={
            {
              "--petal-left": `${(index * 19 + 7) % 100}%`,
              "--petal-delay": `${-(index * 1.4)}s`,
              "--petal-duration": `${10 + (index % 6) * 1.8}s`,
              "--petal-size": `${8 + (index % 4) * 3}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function EmptyPlanner({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-planner paper-card">
      <div className="empty-branch" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span className="eyebrow">첫 매화를 피울 시간</span>
      <h2>아직 계획이 없습니다.</h2>
      <p>오늘의 할 일을 직접 적거나, 목표를 넣어 한 주 계획을 만들어보세요.</p>
      <button className="seal-button" type="button" onClick={onCreate}>
        계획 만들기
      </button>
    </section>
  );
}

function WeeklyTimeline({
  plans,
  dates,
  slotMinutes,
  now,
  onSelect,
}: {
  plans: Plan[];
  dates: Date[];
  slotMinutes: 30 | 60;
  now: Date;
  onSelect: (plan: PlanOccurrence) => void;
}) {
  const startMinute = 6 * 60;
  const endMinute = 24 * 60;
  const slotHeight = slotMinutes === 30 ? 42 : 64;
  const pixelsPerMinute = slotHeight / slotMinutes;
  const timelineHeight = (endMinute - startMinute) * pixelsPerMinute;
  const labels = Array.from(
    { length: (endMinute - startMinute) / slotMinutes + 1 },
    (_, index) => startMinute + index * slotMinutes,
  );
  const todayKey = toDateKey(now);
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const showCurrentLine =
    dates.some((date) => toDateKey(date) === todayKey) &&
    currentMinute >= startMinute &&
    currentMinute <= endMinute;

  return (
    <div className="weekly-scroll">
      <div className="weekly-board" style={{ minWidth: 790 }}>
        <div className="week-header-spacer">시간</div>
        <div className="week-days">
          {dates.map((date) => {
            const selected = toDateKey(date) === todayKey;
            return (
              <div className={selected ? "week-day is-today" : "week-day"} key={toDateKey(date)}>
                <span>{WEEKDAYS_LONG[date.getDay()]}</span>
                <strong>{date.getDate()}</strong>
              </div>
            );
          })}
        </div>
        <div className="timeline-labels" style={{ height: timelineHeight }}>
          {labels.map((minute) => (
            <span
              key={minute}
              style={{ top: (minute - startMinute) * pixelsPerMinute }}
            >
              {minutesToTime(minute)}
            </span>
          ))}
        </div>
        <div
          className="week-grid"
          style={
            {
              height: timelineHeight,
              "--slot-height": `${slotHeight}px`,
            } as CSSProperties
          }
        >
          <div className="day-column-lines">
            {dates.map((date) => (
              <i key={toDateKey(date)} />
            ))}
          </div>
          {plans.flatMap((plan) =>
            dates.map((date, dayIndex) => {
              if (!planOccursOn(plan, date)) return null;
              const start = Math.max(timeToMinutes(plan.start), startMinute);
              const end = Math.min(timeToMinutes(plan.end), endMinute);
              if (end <= start) return null;
              const occurrenceDate = toDateKey(date);
              const status = effectiveStatus(plan, now, occurrenceDate);
              return (
                <button
                  className={`schedule-block ${statusClass(status)}`}
                  key={`${plan.id}-${occurrenceDate}`}
                  onClick={() => onSelect({ ...plan, occurrenceDate })}
                  style={
                    {
                      left: `calc(${dayIndex} * (100% / 7) + 5px)`,
                      top: (start - startMinute) * pixelsPerMinute + 4,
                      width: "calc(100% / 7 - 10px)",
                      height: Math.max(34, (end - start) * pixelsPerMinute - 8),
                      "--plan-color": plan.category || CATEGORY_COLORS[0],
                    } as CSSProperties
                  }
                  aria-label={`${plan.title}, ${plan.start}부터 ${plan.end}`}
                >
                  <strong>{plan.title}</strong>
                  <span>
                    {plan.start}–{plan.end}
                  </span>
                </button>
              );
            }),
          )}
          {showCurrentLine ? (
            <div
              className="current-time-line"
              style={{ top: (currentMinute - startMinute) * pixelsPerMinute }}
            >
              <b>{minutesToTime(currentMinute)}</b>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CircularDay({ plans }: { plans: PlanOccurrence[] }) {
  const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start));
  let cursor = 0;
  const stops: string[] = [];
  sorted.forEach((plan) => {
    const start = (timeToMinutes(plan.start) / 1440) * 100;
    const end = (timeToMinutes(plan.end) / 1440) * 100;
    if (start > cursor) {
      stops.push(`rgba(98, 95, 90, 0.11) ${cursor}% ${start}%`);
    }
    stops.push(`${plan.category || CATEGORY_COLORS[0]} ${start}% ${end}%`);
    cursor = Math.max(cursor, end);
  });
  if (cursor < 100) stops.push(`rgba(98, 95, 90, 0.11) ${cursor}% 100%`);
  const background = stops.length
    ? `conic-gradient(from -90deg, ${stops.join(", ")})`
    : "conic-gradient(rgba(98, 95, 90, 0.11) 0 100%)";

  return (
    <div className="circle-layout">
      <div className="day-circle" style={{ background }}>
        <div>
          <span>오늘의 계획</span>
          <strong>{plans.length}</strong>
          <small>개의 약속</small>
        </div>
        <i className="time-mark mark-0">0</i>
        <i className="time-mark mark-6">6</i>
        <i className="time-mark mark-12">12</i>
        <i className="time-mark mark-18">18</i>
      </div>
      <div className="circle-legend">
        {sorted.length ? (
          sorted.map((plan) => (
            <div key={`${plan.id}-${plan.occurrenceDate}`}>
              <i style={{ background: plan.category || CATEGORY_COLORS[0] }} />
              <span>{plan.title}</span>
              <b>
                {plan.start}–{plan.end}
              </b>
            </div>
          ))
        ) : (
          <p>오늘 등록된 계획이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function TodayList({
  plans,
  now,
  onStatus,
  onDelete,
}: {
  plans: PlanOccurrence[];
  now: Date;
  onStatus: (
    plan: PlanOccurrence,
    status: "completed" | "incomplete",
  ) => void;
  onDelete: (plan: Plan) => void;
}) {
  const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="today-list">
      {sorted.map((plan) => {
        const status = effectiveStatus(plan, now);
        return (
          <article
            className="today-plan-card paper-card"
            key={`${plan.id}-${plan.occurrenceDate}`}
          >
            <time>
              <strong>{plan.start}</strong>
              <span>{plan.end}</span>
            </time>
            <i
              className="plan-color-bar"
              style={{ background: plan.category || CATEGORY_COLORS[0] }}
            />
            <div className="today-plan-copy">
              <div>
                <h3>{plan.title}</h3>
                <span className={`status-pill ${statusClass(status)}`}>{statusLabel(status)}</span>
              </div>
              {plan.memo ? <p>{plan.memo}</p> : <p className="muted">메모 없음</p>}
              {status === "unconfirmed" ? (
                <div className="completion-actions">
                  <button onClick={() => onStatus(plan, "completed")}>완료했어</button>
                  <button onClick={() => onStatus(plan, "incomplete")}>못 했어</button>
                </div>
              ) : null}
            </div>
            <button
              className="quiet-delete"
              onClick={() => onDelete(plan)}
              aria-label={
                plan.repeat?.length
                  ? `${plan.title} 반복 계획 전체 삭제`
                  : `${plan.title} 삭제`
              }
            >
              ×
            </button>
          </article>
        );
      })}
    </div>
  );
}

function UnconfirmedCallout({ count }: { count: number }) {
  if (!count) return null;
  return (
    <aside className="unconfirmed-callout">
      <div className="five-seals" aria-label="화산오검">
        {CHARACTER_NAMES.map((name) => (
          <i key={name}>{name.slice(0, 1)}</i>
        ))}
      </div>
      <div>
        <strong>뭐야, 왜 안 왔어?</strong>
        <span>확인하지 않은 계획이 {count}개 있어요.</span>
      </div>
    </aside>
  );
}

function PlumProgress({ rate, label }: { rate: number; label: string }) {
  const active = Math.round(rate / 10);
  return (
    <div className="plum-progress" aria-label={label}>
      <div className="plum-branch branch-main" />
      <div className="plum-branch branch-a" />
      <div className="plum-branch branch-b" />
      {Array.from({ length: 10 }, (_, index) => (
        <i className={index < active ? "plum-blossom is-open" : "plum-blossom"} key={index}>
          <b />
        </i>
      ))}
      <span>{label}</span>
    </div>
  );
}

export function PlannerApp() {
  const [page, setPage] = useState<PageId>("planner");
  const [plannerView, setPlannerView] = useState<PlannerView>("week");
  const [todayView, setTodayView] = useState<TodayView>("list");
  const [slotMinutes, setSlotMinutes] = useState<30 | 60>(60);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const clientId = useSyncExternalStore(
    subscribeToClientId,
    getOrCreateClientId,
    () => "",
  );
  const [plans, setPlans] = useState<Plan[]>([]);
  const plansRef = useRef<Plan[]>([]);
  const storageModeRef = useRef<StorageMode>(
    BROWSER_ONLY_STORAGE ? "local" : "server",
  );
  const [storageMode, setStorageMode] = useState<StorageMode>(
    BROWSER_ONLY_STORAGE ? "local" : "server",
  );
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] =
    useState<PlanOccurrence | null>(null);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [reactionIndex, setReactionIndex] = useState(0);

  const navigateToPage = useCallback((nextPage: PageId) => {
    setSelectedPlan(null);
    setPage(nextPage);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }, []);

  const replacePlans = useCallback((nextPlans: Plan[]) => {
    plansRef.current = nextPlans;
    setPlans(nextPlans);
  }, []);

  const setActiveStorageMode = useCallback((mode: StorageMode) => {
    storageModeRef.current = mode;
    setStorageMode(mode);
  }, []);

  const replaceWithLocalPlans = useCallback(
    (id: string, nextPlans: Plan[]) => {
      writeLocalPlans(id, nextPlans);
      replacePlans(nextPlans);
      setActiveStorageMode("local");
    },
    [replacePlans, setActiveStorageMode],
  );

  const weekDates = useMemo(() => getWeekDates(anchorDate), [anchorDate]);
  const weekPlans = useMemo(
    () => plans.filter((plan) => weekDates.some((date) => planOccursOn(plan, date))),
    [plans, weekDates],
  );
  const todayPlans = useMemo(() => {
    const todayKey = toDateKey(now);
    return plans
      .filter((plan) => planOccursOn(plan, now))
      .map((plan) => ({ ...plan, occurrenceDate: todayKey }));
  }, [now, plans]);

  const loadPlans = useCallback(async (id: string) => {
    if (BROWSER_ONLY_STORAGE) {
      replacePlans(readLocalPlans(id));
      setActiveStorageMode("local");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/plans?clientId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const payload = await readJson<{ plans: Plan[] }>(response);
      replacePlans(payload.plans);
      setActiveStorageMode("server");
    } catch (error) {
      if (!shouldUseLocalFallback(error)) throw error;
      replacePlans(readLocalPlans(id));
      setActiveStorageMode("local");
    } finally {
      setLoading(false);
    }
  }, [replacePlans, setActiveStorageMode]);

  useEffect(() => {
    if (!clientId) return;
    const timer = window.setTimeout(() => void loadPlans(clientId), 0);
    return () => window.clearTimeout(timer);
  }, [clientId, loadPlans]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => setReaction(null), 5200);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  const createPlan = useCallback(
    async (draft: Omit<PlanDraft, "clientId">) => {
      if (!clientId) throw new Error("저장 준비 중입니다.");

      const saveInBrowser = () => {
        const now = new Date().toISOString();
        const localPlan: Plan = {
          ...draft,
          id: makeLocalPlanId(),
          clientId,
          occurrenceStatuses: draft.occurrenceStatuses ?? {},
          createdAt: now,
          updatedAt: now,
        };
        replaceWithLocalPlans(clientId, [...plansRef.current, localPlan]);
        return localPlan;
      };

      if (storageModeRef.current === "local") return saveInBrowser();

      try {
        const response = await fetch("/api/plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...draft, clientId }),
        });
        const payload = await readJson<{ plan: Plan }>(response);
        replacePlans([...plansRef.current, payload.plan]);
        return payload.plan;
      } catch (error) {
        if (!shouldUseLocalFallback(error)) throw error;
        return saveInBrowser();
      }
    },
    [clientId, replacePlans, replaceWithLocalPlans],
  );

  const changeStatus = useCallback(
    async (
      plan: PlanOccurrence,
      status: "completed" | "incomplete",
    ) => {
      const updateInBrowser = () => {
        const storedPlan =
          plansRef.current.find((item) => item.id === plan.id) ?? plan;
        const isRecurring = Boolean(storedPlan.repeat?.length);
        const updatedPlan: Plan = {
          ...storedPlan,
          status: isRecurring ? "planned" : status,
          occurrenceStatuses: isRecurring
            ? {
                ...(storedPlan.occurrenceStatuses ?? {}),
                [plan.occurrenceDate]: status,
              }
            : storedPlan.occurrenceStatuses,
          updatedAt: new Date().toISOString(),
        };
        replaceWithLocalPlans(
          clientId,
          plansRef.current.map((item) =>
            item.id === plan.id ? updatedPlan : item,
          ),
        );
        return updatedPlan;
      };

      let updatedPlan: Plan;
      if (storageModeRef.current === "local") {
        updatedPlan = updateInBrowser();
      } else {
        try {
          const response = await fetch("/api/plans", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              plan.repeat?.length
                ? {
                    clientId,
                    id: plan.id,
                    occurrenceDate: plan.occurrenceDate,
                    occurrenceStatus: status,
                  }
                : { clientId, id: plan.id, status },
            ),
          });
          const payload = await readJson<{ plan: Plan }>(response);
          updatedPlan = payload.plan;
          replacePlans(
            plansRef.current.map((item) =>
              item.id === plan.id ? updatedPlan : item,
            ),
          );
        } catch (error) {
          if (!shouldUseLocalFallback(error)) throw error;
          updatedPlan = updateInBrowser();
        }
      }

      setSelectedPlan((current) =>
        current?.id === plan.id &&
        current.occurrenceDate === plan.occurrenceDate
          ? {
              ...updatedPlan,
              occurrenceDate: current.occurrenceDate,
            }
          : current,
      );
      const dialogue = getCharacterDialogue(status, reactionIndex);
      if (dialogue) {
        setReaction({
          name: dialogue.character,
          line: dialogue.message,
          kind: status,
        });
      }
      setReactionIndex((value) => value + 1);
    },
    [clientId, reactionIndex, replacePlans, replaceWithLocalPlans],
  );

  const deletePlan = useCallback(
    async (plan: Plan) => {
      const deleteInBrowser = () => {
        replaceWithLocalPlans(
          clientId,
          plansRef.current.filter((item) => item.id !== plan.id),
        );
      };

      if (storageModeRef.current === "local") {
        deleteInBrowser();
      } else {
        try {
          const response = await fetch(
            `/api/plans?clientId=${encodeURIComponent(clientId)}&id=${plan.id}`,
            { method: "DELETE" },
          );
          await readJson<{ deletedId: number }>(response);
          replacePlans(
            plansRef.current.filter((item) => item.id !== plan.id),
          );
        } catch (error) {
          if (!shouldUseLocalFallback(error)) throw error;
          deleteInBrowser();
        }
      }

      setSelectedPlan(null);
    },
    [clientId, replacePlans, replaceWithLocalPlans],
  );

  const decidedPlans = getAssessedPlanOccurrences(plans);
  const completedPlans = decidedPlans.filter(
    (plan) => plan.status === "completed",
  );
  const completionRate = calculateCompletionRate(decidedPlans);
  const currentWeekDates = getWeekDates(now);
  const currentWeekOccurrences = materializePlanOccurrences(
    plans,
    currentWeekDates.map(toDateKey),
    now,
  );
  const currentWeekAssessed = currentWeekOccurrences.filter(
    (plan) =>
      plan.status === "completed" || plan.status === "incomplete",
  );
  const weekCompletionRate = calculateCompletionRate(currentWeekAssessed);
  const incompleteCount = decidedPlans.filter(
    (plan) => plan.status === "incomplete",
  ).length;
  const todayKey = toDateKey(now);
  const earliestHistoryDate = plans.reduce(
    (earliest, plan) => (plan.date < earliest ? plan.date : earliest),
    todayKey,
  );
  const historyBoundary = toDateKey(addDays(now, -365));
  const historyStart =
    earliestHistoryDate > historyBoundary
      ? earliestHistoryDate
      : historyBoundary;
  const historyOccurrences = materializePlanOccurrences(
    plans,
    getDateRange(historyStart, todayKey),
    now,
  );
  const unconfirmedCount = historyOccurrences.filter(
    (plan) => plan.status === "unconfirmed",
  ).length;
  const streak = calculateCompletionStreak(
    historyOccurrences,
    todayKey,
  );

  return (
    <div className="site-shell">
      <Petals />
      <aside className="desktop-sidebar">
        <div className="brand-block">
          <strong>매화수련록</strong>
          <span>MAEWHASURYEONROK</span>
        </div>
        <div className="profile-block">
          <i>梅</i>
          <div>
            <strong>수련생</strong>
            <span>오늘도 한 걸음</span>
          </div>
        </div>
        <nav aria-label="주요 메뉴">
          {NAV_ITEMS.map((item) => (
            <button
              className={page === item.id ? "is-active" : ""}
              key={item.id}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => navigateToPage(item.id)}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-quote">
          <i />
          <p>매화는 추위를 견딘 뒤에야 향기를 낸다.</p>
        </div>
      </aside>

      <header className="mobile-header">
        <i className="mobile-seal">梅</i>
        <strong>매화수련록</strong>
        <span>{formatKoreanDate(new Date())}</span>
      </header>

      <main className="main-content">
        {storageMode === "local" ? (
          <div className="sync-message" role="status">
            <span>이 브라우저에 저장 중</span>
            {!BROWSER_ONLY_STORAGE ? (
              <button onClick={() => clientId && void loadPlans(clientId)}>
                서버 다시 연결
              </button>
            ) : null}
          </div>
        ) : null}

        {page === "planner" ? (
          <section className="page-section planner-page">
            <header className="page-heading planner-heading">
              <div>
                <span className="eyebrow">나의 한 주</span>
                <h1>내 계획표</h1>
                <p>약속한 시간을 지키며 오늘의 매화를 피워보세요.</p>
              </div>
              <div className="view-switch" aria-label="계획표 보기 방식">
                <button
                  className={plannerView === "week" ? "is-active" : ""}
                  onClick={() => setPlannerView("week")}
                >
                  주간
                </button>
                <button
                  className={plannerView === "today" ? "is-active" : ""}
                  onClick={() => setPlannerView("today")}
                >
                  오늘
                </button>
              </div>
            </header>

            {loading ? (
              <div className="loading-paper paper-card">계획표를 펼치는 중…</div>
            ) : plans.length === 0 ? (
              <EmptyPlanner onCreate={() => navigateToPage("create")} />
            ) : plannerView === "week" ? (
              <div className="planner-panel paper-card">
                <div className="planner-toolbar">
                  <div className="week-navigation">
                    <button
                      aria-label="이전 주"
                      onClick={() => setAnchorDate((date) => addDays(date, -7))}
                    >
                      ‹
                    </button>
                    <strong>
                      {weekDates[0].getFullYear()}년 {weekDates[0].getMonth() + 1}월
                    </strong>
                    <button
                      aria-label="다음 주"
                      onClick={() => setAnchorDate((date) => addDays(date, 7))}
                    >
                      ›
                    </button>
                  </div>
                  <div className="slot-switch" aria-label="시간 간격">
                    <button
                      className={slotMinutes === 30 ? "is-active" : ""}
                      onClick={() => setSlotMinutes(30)}
                    >
                      30분
                    </button>
                    <button
                      className={slotMinutes === 60 ? "is-active" : ""}
                      onClick={() => setSlotMinutes(60)}
                    >
                      1시간
                    </button>
                  </div>
                </div>
                {weekPlans.length ? (
                  <WeeklyTimeline
                    plans={weekPlans}
                    dates={weekDates}
                    slotMinutes={slotMinutes}
                    now={now}
                    onSelect={setSelectedPlan}
                  />
                ) : (
                  <div className="week-empty">
                    <strong>이번 주에는 아직 계획이 없습니다.</strong>
                    <button onClick={() => navigateToPage("create")}>계획 만들기</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="today-layout">
                <div className="today-main">
                  <div className="today-toolbar paper-card">
                    <div>
                      <span className="eyebrow">오늘</span>
                      <strong>
                        {formatKoreanDate(new Date())} {WEEKDAYS_LONG[new Date().getDay()]}
                      </strong>
                    </div>
                    <div className="icon-switch">
                      <button
                        className={todayView === "list" ? "is-active" : ""}
                        onClick={() => setTodayView("list")}
                        aria-label="목록 보기"
                      >
                        표
                      </button>
                      <button
                        className={todayView === "circle" ? "is-active" : ""}
                        onClick={() => setTodayView("circle")}
                        aria-label="원형 보기"
                      >
                        원
                      </button>
                    </div>
                  </div>
                  <UnconfirmedCallout
                    count={todayPlans.filter((plan) => effectiveStatus(plan, now) === "unconfirmed").length}
                  />
                  {todayPlans.length ? (
                    todayView === "list" ? (
                      <TodayList
                        plans={todayPlans}
                        now={now}
                        onStatus={(plan, status) => void changeStatus(plan, status)}
                        onDelete={(plan) => void deletePlan(plan)}
                      />
                    ) : (
                      <section className="paper-card circle-card">
                        <CircularDay plans={todayPlans} />
                      </section>
                    )
                  ) : (
                    <EmptyPlanner onCreate={() => navigateToPage("create")} />
                  )}
                </div>
                <aside className="today-summary paper-card">
                  <span className="eyebrow">오늘의 흐름</span>
                  <strong>{todayPlans.length}개의 계획</strong>
                  <div>
                    <b>
                      {
                        todayPlans.filter(
                          (plan) =>
                            effectiveStatus(plan, now) === "completed",
                        ).length
                      }
                    </b>
                    <span>완료</span>
                  </div>
                  <div>
                    <b>{todayPlans.filter((plan) => effectiveStatus(plan, now) === "unconfirmed").length}</b>
                    <span>미확인</span>
                  </div>
                </aside>
              </div>
            )}
          </section>
        ) : null}

        {page === "create" ? (
          <CreatePlanPage
            clientReady={Boolean(clientId)}
            onCreate={createPlan}
            onFinished={() => {
              setPlannerView("week");
              setAnchorDate(new Date());
              navigateToPage("planner");
            }}
          />
        ) : null}

        {page === "records" ? (
          <section className="page-section records-page">
            <header className="page-heading">
              <div>
                <span className="eyebrow">자동으로 쌓이는 실행 기록</span>
                <h1>수련 기록</h1>
                <p>계획에서 ‘완료했어’ 또는 ‘못 했어’를 선택하면 여기에 자동으로 기록돼요.</p>
              </div>
            </header>
            {plans.length === 0 ? (
              <EmptyPlanner onCreate={() => navigateToPage("create")} />
            ) : decidedPlans.length === 0 ? (
              <article className="paper-card records-guide">
                <i aria-hidden="true">錄</i>
                <div>
                  <span className="eyebrow">기록이 쌓이는 방법</span>
                  <h2>
                    {unconfirmedCount > 0
                      ? `결과를 기다리는 계획이 ${unconfirmedCount}개 있어요.`
                      : "아직 남겨진 결과가 없어요."}
                  </h2>
                  <p>
                    계획 시간이 지난 뒤 내 계획표에서 ‘완료했어’ 또는 ‘못 했어’를
                    선택하세요. 선택한 결과가 이곳에 차곡차곡 쌓여요.
                  </p>
                  <button
                    className="seal-button"
                    type="button"
                    onClick={() => navigateToPage("planner")}
                  >
                    내 계획표 보기
                  </button>
                </div>
              </article>
            ) : (
              <>
                <article className="paper-card record-summary">
                  <div className="record-summary-rate">
                    <span className="eyebrow">한눈에 보기</span>
                    <h2>확인한 계획 완료율</h2>
                    <strong>{completionRate}%</strong>
                    <p>
                      결과를 남긴 {decidedPlans.length}회 중 {completedPlans.length}회 완료
                      <small>예정과 미확인은 완료율에서 제외해요.</small>
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>연속 완료</dt>
                      <dd>{streak}일</dd>
                      <small>계획이 있던 날을 모두 완료</small>
                    </div>
                    <div>
                      <dt>확인 대기</dt>
                      <dd>{unconfirmedCount}개</dd>
                      <small>시간이 지났지만 결과가 없음</small>
                    </div>
                    <div>
                      <dt>미완료</dt>
                      <dd>{incompleteCount}개</dd>
                      <small>‘못 했어’로 남긴 계획</small>
                    </div>
                  </dl>
                </article>
                <div className="record-detail-grid">
                  <article className="paper-card recent-records">
                    <div>
                      <span className="eyebrow">최근 확인</span>
                      <h2>최근에 결과를 남긴 계획</h2>
                    </div>
                    <ul>
                      {[...decidedPlans]
                        .sort(
                          (a, b) =>
                            b.occurrenceDate.localeCompare(a.occurrenceDate) ||
                            b.updatedAt.localeCompare(a.updatedAt),
                        )
                        .slice(0, 6)
                        .map((plan) => {
                          const status = effectiveStatus(plan, now);
                          return (
                            <li key={`${plan.id}-${plan.occurrenceDate}`}>
                              <i style={{ background: plan.category || CATEGORY_COLORS[0] }} />
                              <div>
                                <strong>{plan.title}</strong>
                                <span>{plan.occurrenceDate} · {plan.start}</span>
                              </div>
                              <b className={statusClass(status)}>{statusLabel(status)}</b>
                            </li>
                          );
                        })}
                    </ul>
                  </article>
                  <article className="paper-card blossom-card">
                    <div>
                      <span className="eyebrow">이번 주 완료율</span>
                      <h2>
                        {currentWeekAssessed.length > 0
                          ? "완료할수록 매화가 피어요"
                          : "이번 주에 확인한 계획이 아직 없어요"}
                      </h2>
                    </div>
                    <PlumProgress
                      rate={weekCompletionRate}
                      label={
                        currentWeekAssessed.length > 0
                          ? `이번 주 확인한 계획 중 ${weekCompletionRate}% 완료`
                          : "계획의 결과를 남기면 매화가 피어나요."
                      }
                    />
                  </article>
                </div>
              </>
            )}
          </section>
        ) : null}
      </main>

      <nav className="mobile-bottom-nav" aria-label="주요 메뉴">
        {NAV_ITEMS.map((item) => (
          <button
            className={page === item.id ? "is-active" : ""}
            key={item.id}
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => navigateToPage(item.id)}
          >
            <i>{item.icon}</i>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {selectedPlan ? (
        <div className="sheet-backdrop" onClick={() => setSelectedPlan(null)}>
          <section className="plan-sheet" onClick={(event) => event.stopPropagation()}>
            <i className="sheet-handle" />
            <span className="eyebrow">계획 상세</span>
            <h2>{selectedPlan.title}</h2>
            <dl>
              <div>
                <dt>날짜</dt>
                <dd>{selectedPlan.occurrenceDate}</dd>
              </div>
              <div>
                <dt>시간</dt>
                <dd>{selectedPlan.start}–{selectedPlan.end}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>{statusLabel(effectiveStatus(selectedPlan, now))}</dd>
              </div>
            </dl>
            {selectedPlan.memo ? <p>{selectedPlan.memo}</p> : null}
            {effectiveStatus(selectedPlan, now) === "unconfirmed" ? (
              <div className="sheet-actions">
                <button onClick={() => void changeStatus(selectedPlan, "completed")}>완료했어</button>
                <button onClick={() => void changeStatus(selectedPlan, "incomplete")}>못 했어</button>
              </div>
            ) : null}
            <button className="sheet-delete" onClick={() => void deletePlan(selectedPlan)}>
              {selectedPlan.repeat?.length
                ? "반복 계획 전체 삭제"
                : "이 계획 삭제"}
            </button>
          </section>
        </div>
      ) : null}

      {reaction ? (
        <aside className={`reaction-toast reaction-${reaction.kind}`}>
          <i>{reaction.name.slice(0, 1)}</i>
          <div>
            <span>{reaction.name}</span>
            <strong>{reaction.line}</strong>
          </div>
          <button onClick={() => setReaction(null)} aria-label="닫기">×</button>
        </aside>
      ) : null}
    </div>
  );
}

function CreatePlanPage({
  clientReady,
  onCreate,
  onFinished,
}: {
  clientReady: boolean;
  onCreate: (draft: Omit<PlanDraft, "clientId">) => Promise<Plan>;
  onFinished: () => void;
}) {
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const todayKey = toDateKey(new Date());

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [repeat, setRepeat] = useState<number[]>([]);
  const [category, setCategory] = useState(CATEGORY_COLORS[0]);
  const [memo, setMemo] = useState("");

  const [tasks, setTasks] = useState<AutoTask[]>([
    { id: makeBrowserId(), title: "", minutes: 60 },
  ]);
  const [autoStartDate, setAutoStartDate] = useState(todayKey);
  const [autoEndDate, setAutoEndDate] = useState(toDateKey(addDays(new Date(), 7)));
  const [allowedDays, setAllowedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [availableStart, setAvailableStart] = useState("18:00");
  const [availableEnd, setAvailableEnd] = useState("22:00");
  const [maxMinutes, setMaxMinutes] = useState(120);
  const [autoSlot, setAutoSlot] = useState<30 | 60>(30);
  const [preview, setPreview] = useState<Omit<PlanDraft, "clientId">[]>([]);

  const toggleDay = (day: number, setter: (days: number[]) => void, values: number[]) => {
    setter(values.includes(day) ? values.filter((value) => value !== day) : [...values, day]);
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!title.trim()) {
      setMessage("계획 이름을 적어주세요.");
      return;
    }
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      setMessage("끝나는 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        date,
        start,
        end,
        repeat: repeat.length ? repeat : null,
        category,
        memo: memo.trim(),
        status: "planned",
        source: "manual",
      });
      onFinished();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계획을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const makePreview = () => {
    setMessage("");
    const validTasks = tasks.filter((task) => task.title.trim() && task.minutes > 0);
    if (!validTasks.length) {
      setMessage("자동으로 나눌 할 일을 하나 이상 적어주세요.");
      return;
    }
    if (!allowedDays.length) {
      setMessage("계획을 배치할 요일을 골라주세요.");
      return;
    }
    const dayCapacity = Math.min(
      maxMinutes,
      Math.max(0, timeToMinutes(availableEnd) - timeToMinutes(availableStart)),
    );
    if (dayCapacity < autoSlot) {
      setMessage("가능 시간과 하루 최대 시간을 확인해 주세요.");
      return;
    }

    try {
      const result = generateAutoPlan({
        tasks: validTasks.map((task, index) => ({
          id: task.id,
          title: task.title,
          totalMinutes: task.minutes,
          category: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
          memo: "자동 생성된 계획",
        })),
        startDate: autoStartDate,
        endDate: autoEndDate,
        allowedWeekdays: allowedDays as Weekday[],
        availability: allowedDays.map((weekday) => ({
          weekday: weekday as Weekday,
          startTime: availableStart,
          endTime: availableEnd,
        })),
        maxMinutesPerDay: maxMinutes,
        slotMinutes: autoSlot,
      });
      const generated: Omit<PlanDraft, "clientId">[] = result.plans.map(
        ({ title, date, start, end, repeat, category, memo, status, source }) => ({
          title,
          date,
          start,
          end,
          repeat: repeat.length ? repeat : null,
          category,
          memo,
          status,
          source,
        }),
      );
      setPreview(generated);
      if (result.unscheduledMinutes > 0) {
        setMessage(
          `기간이 짧아 ${result.unscheduledMinutes}분을 배치하지 못했습니다. 기간이나 하루 시간을 늘려주세요.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자동 계획을 만들지 못했습니다.");
    }
  };

  const savePreview = async () => {
    if (!preview.length) return;
    setSaving(true);
    setMessage("");
    try {
      for (const item of preview) {
        await onCreate(item);
      }
      onFinished();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계획표를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page-section create-page">
      <header className="page-heading create-heading">
        <div>
          <span className="eyebrow">새로운 약속</span>
          <h1>계획 만들기</h1>
          <p>직접 한 칸을 채우거나, 목표를 가능한 시간에 고르게 나눠보세요.</p>
        </div>
        <div className="mode-tabs">
          <button className={mode === "manual" ? "is-active" : ""} onClick={() => setMode("manual")}>
            직접 작성
          </button>
          <button className={mode === "auto" ? "is-active" : ""} onClick={() => setMode("auto")}>
            자동 생성
          </button>
        </div>
      </header>

      {mode === "manual" ? (
        <form className="create-grid" onSubmit={submitManual}>
          <div className="paper-card form-paper">
            <div className="form-section-title">
              <i>一</i>
              <div>
                <span>기본 정보</span>
                <strong>언제, 무엇을 할까요?</strong>
              </div>
            </div>
            <label className="field full-field">
              <span>계획 이름</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="예: 영어 단어 복습"
                maxLength={80}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>날짜</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="field">
                <span>시작 시간</span>
                <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="field">
                <span>종료 시간</span>
                <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>
            <fieldset className="day-fieldset">
              <legend>반복 요일 <small>선택하지 않으면 한 번만 실행</small></legend>
              <div>
                {WEEKDAYS.map((label, day) => (
                  <button
                    type="button"
                    className={repeat.includes(day) ? "is-active" : ""}
                    key={label}
                    onClick={() => toggleDay(day, setRepeat, repeat)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="color-fieldset">
              <legend>분류 색상</legend>
              <div>
                {CATEGORY_COLORS.map((color) => (
                  <button
                    type="button"
                    className={category === color ? "is-active" : ""}
                    style={{ background: color }}
                    key={color}
                    onClick={() => setCategory(color)}
                    aria-label={`${color} 색상 선택`}
                  />
                ))}
              </div>
            </fieldset>
            <label className="field full-field">
              <span>메모 <small>선택</small></span>
              <textarea
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="기억할 내용을 적어주세요."
                rows={3}
                maxLength={300}
              />
            </label>
          </div>
          <aside className="paper-card save-paper">
            <span className="eyebrow">미리보기</span>
            <div className="mini-plan-preview" style={{ "--plan-color": category } as CSSProperties}>
              <time>{start}</time>
              <i />
              <div>
                <strong>{title || "계획 이름"}</strong>
                <span>{date} · {start}–{end}</span>
              </div>
            </div>
            {message ? <p className="form-message">{message}</p> : null}
            <button className="seal-button full-button" disabled={saving || !clientReady}>
              {saving ? "저장하는 중…" : "계획표에 저장"}
            </button>
          </aside>
        </form>
      ) : (
        <div className="auto-create-grid">
          <div className="paper-card form-paper">
            <div className="form-section-title">
              <i>自</i>
              <div>
                <span>자동 배치</span>
                <strong>목표를 가능한 시간에 나눕니다</strong>
              </div>
            </div>
            <div className="task-builder">
              <label>해야 할 일</label>
              {tasks.map((task, index) => (
                <div className="task-row" key={task.id}>
                  <input
                    value={task.title}
                    onChange={(event) =>
                      setTasks((current) =>
                        current.map((item) =>
                          item.id === task.id ? { ...item, title: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder={`할 일 ${index + 1}`}
                    maxLength={80}
                  />
                  <input
                    type="number"
                    min={30}
                    step={30}
                    value={task.minutes}
                    onChange={(event) =>
                      setTasks((current) =>
                        current.map((item) =>
                          item.id === task.id
                            ? { ...item, minutes: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                    aria-label={`${index + 1}번째 할 일의 총 소요 시간`}
                  />
                  <span>분</span>
                  <button
                    type="button"
                    onClick={() =>
                      setTasks((current) =>
                        current.length === 1 ? current : current.filter((item) => item.id !== task.id),
                      )
                    }
                    aria-label={`${index + 1}번째 할 일 삭제`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-task"
                onClick={() =>
                  setTasks((current) => [
                    ...current,
                    { id: makeBrowserId(), title: "", minutes: 60 },
                  ])
                }
              >
                + 할 일 추가
              </button>
            </div>
            <div className="field-row two-columns">
              <label className="field">
                <span>시작일</span>
                <input
                  type="date"
                  value={autoStartDate}
                  onChange={(event) => setAutoStartDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>마감일</span>
                <input
                  type="date"
                  value={autoEndDate}
                  min={autoStartDate}
                  onChange={(event) => setAutoEndDate(event.target.value)}
                />
              </label>
            </div>
            <fieldset className="day-fieldset">
              <legend>가능한 요일</legend>
              <div>
                {WEEKDAYS.map((label, day) => (
                  <button
                    type="button"
                    className={allowedDays.includes(day) ? "is-active" : ""}
                    key={label}
                    onClick={() => toggleDay(day, setAllowedDays, allowedDays)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field-row auto-time-row">
              <label className="field">
                <span>가능 시작</span>
                <input
                  type="time"
                  value={availableStart}
                  onChange={(event) => setAvailableStart(event.target.value)}
                />
              </label>
              <label className="field">
                <span>가능 종료</span>
                <input
                  type="time"
                  value={availableEnd}
                  onChange={(event) => setAvailableEnd(event.target.value)}
                />
              </label>
              <label className="field">
                <span>하루 최대</span>
                <select value={maxMinutes} onChange={(event) => setMaxMinutes(Number(event.target.value))}>
                  <option value={60}>1시간</option>
                  <option value={120}>2시간</option>
                  <option value={180}>3시간</option>
                  <option value={240}>4시간</option>
                </select>
              </label>
              <label className="field">
                <span>계획 단위</span>
                <select
                  value={autoSlot}
                  onChange={(event) => setAutoSlot(Number(event.target.value) as 30 | 60)}
                >
                  <option value={30}>30분</option>
                  <option value={60}>1시간</option>
                </select>
              </label>
            </div>
            <button type="button" className="outline-button" onClick={makePreview}>
              자동 계획 만들기
            </button>
          </div>
          <aside className="paper-card auto-preview-paper">
            <span className="eyebrow">배치 미리보기</span>
            <h2>{preview.length ? `${preview.length}개의 일정` : "아직 생성 전입니다"}</h2>
            <div className="auto-preview-list">
              {preview.length ? (
                preview.slice(0, 12).map((item, index) => (
                  <article key={`${item.date}-${item.start}-${index}`}>
                    <time>{item.date.slice(5)}</time>
                    <i style={{ background: item.category || CATEGORY_COLORS[0] }} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.start}–{item.end}</span>
                    </div>
                  </article>
                ))
              ) : (
                <p>할 일과 가능한 시간을 입력하면 이곳에 배치 결과가 나타납니다.</p>
              )}
            </div>
            {message ? <p className="form-message">{message}</p> : null}
            <button
              type="button"
              className="seal-button full-button"
              onClick={() => void savePreview()}
              disabled={!preview.length || saving || !clientReady}
            >
              {saving ? "저장하는 중…" : "계획표에 저장"}
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}
