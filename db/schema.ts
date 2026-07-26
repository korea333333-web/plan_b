import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const planStatuses = [
  "planned",
  "completed",
  "incomplete",
  "unconfirmed",
] as const;

export const planSources = ["manual", "auto"] as const;
export const assessedPlanStatuses = ["completed", "incomplete"] as const;

export type PlanStatus = (typeof planStatuses)[number];
export type PlanSource = (typeof planSources)[number];
export type AssessedPlanStatus = (typeof assessedPlanStatuses)[number];
export type OccurrenceStatuses = Record<string, AssessedPlanStatus>;

export const plans = sqliteTable(
  "plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: text("client_id").notNull(),
    title: text("title").notNull(),
    date: text("date").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    repeat: text("repeat", { mode: "json" }).$type<number[] | null>(),
    category: text("category"),
    memo: text("memo").notNull().default(""),
    status: text("status", { enum: planStatuses })
      .notNull()
      .default("planned"),
    occurrenceStatuses: text("occurrence_statuses", { mode: "json" })
      .$type<OccurrenceStatuses>()
      .notNull()
      .default(sql`'{}'`),
    source: text("source", { enum: planSources }).notNull().default("manual"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("plans_client_date_idx").on(
      table.clientId,
      table.date,
      table.start,
    ),
    index("plans_client_status_idx").on(table.clientId, table.status),
    check(
      "plans_client_id_length_check",
      sql`length(${table.clientId}) between 8 and 128`,
    ),
    check(
      "plans_title_length_check",
      sql`length(${table.title}) between 1 and 120`,
    ),
    check(
      "plans_date_format_check",
      sql`${table.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "plans_start_format_check",
      sql`${table.start} glob '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "plans_end_format_check",
      sql`${table.end} glob '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check("plans_time_order_check", sql`${table.start} < ${table.end}`),
    check(
      "plans_repeat_json_check",
      sql`${table.repeat} is null or json_valid(${table.repeat})`,
    ),
    check(
      "plans_category_length_check",
      sql`${table.category} is null or length(${table.category}) <= 40`,
    ),
    check(
      "plans_memo_length_check",
      sql`length(${table.memo}) <= 1000`,
    ),
    check(
      "plans_status_check",
      sql`${table.status} in ('planned', 'completed', 'incomplete', 'unconfirmed')`,
    ),
    check(
      "plans_occurrence_statuses_json_check",
      sql`json_valid(${table.occurrenceStatuses}) and json_type(${table.occurrenceStatuses}) = 'object'`,
    ),
    check(
      "plans_source_check",
      sql`${table.source} in ('manual', 'auto')`,
    ),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
