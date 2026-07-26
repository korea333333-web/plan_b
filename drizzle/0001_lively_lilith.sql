PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`repeat` text,
	`category` text,
	`memo` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`occurrence_statuses` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "plans_client_id_length_check" CHECK(length("__new_plans"."client_id") between 8 and 128),
	CONSTRAINT "plans_title_length_check" CHECK(length("__new_plans"."title") between 1 and 120),
	CONSTRAINT "plans_date_format_check" CHECK("__new_plans"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "plans_start_format_check" CHECK("__new_plans"."start" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "plans_end_format_check" CHECK("__new_plans"."end" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "plans_time_order_check" CHECK("__new_plans"."start" < "__new_plans"."end"),
	CONSTRAINT "plans_repeat_json_check" CHECK("__new_plans"."repeat" is null or json_valid("__new_plans"."repeat")),
	CONSTRAINT "plans_category_length_check" CHECK("__new_plans"."category" is null or length("__new_plans"."category") <= 40),
	CONSTRAINT "plans_memo_length_check" CHECK(length("__new_plans"."memo") <= 1000),
	CONSTRAINT "plans_status_check" CHECK("__new_plans"."status" in ('planned', 'completed', 'incomplete', 'unconfirmed')),
	CONSTRAINT "plans_occurrence_statuses_json_check" CHECK(json_valid("__new_plans"."occurrence_statuses") and json_type("__new_plans"."occurrence_statuses") = 'object'),
	CONSTRAINT "plans_source_check" CHECK("__new_plans"."source" in ('manual', 'auto'))
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "client_id", "title", "date", "start", "end", "repeat", "category", "memo", "status", "occurrence_statuses", "source", "created_at", "updated_at") SELECT "id", "client_id", "title", "date", "start", "end", "repeat", "category", "memo", CASE WHEN "repeat" IS NOT NULL AND "repeat" <> '[]' THEN 'planned' ELSE "status" END, '{}', "source", "created_at", "updated_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plans_client_date_idx` ON `plans` (`client_id`,`date`,`start`);--> statement-breakpoint
CREATE INDEX `plans_client_status_idx` ON `plans` (`client_id`,`status`);
