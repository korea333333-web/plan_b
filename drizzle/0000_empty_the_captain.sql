CREATE TABLE `plans` (
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
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "plans_client_id_length_check" CHECK(length("plans"."client_id") between 8 and 128),
	CONSTRAINT "plans_title_length_check" CHECK(length("plans"."title") between 1 and 120),
	CONSTRAINT "plans_date_format_check" CHECK("plans"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "plans_start_format_check" CHECK("plans"."start" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "plans_end_format_check" CHECK("plans"."end" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "plans_time_order_check" CHECK("plans"."start" < "plans"."end"),
	CONSTRAINT "plans_repeat_json_check" CHECK("plans"."repeat" is null or json_valid("plans"."repeat")),
	CONSTRAINT "plans_category_length_check" CHECK("plans"."category" is null or length("plans"."category") <= 40),
	CONSTRAINT "plans_memo_length_check" CHECK(length("plans"."memo") <= 1000),
	CONSTRAINT "plans_status_check" CHECK("plans"."status" in ('planned', 'completed', 'incomplete', 'unconfirmed')),
	CONSTRAINT "plans_source_check" CHECK("plans"."source" in ('manual', 'auto'))
);
--> statement-breakpoint
CREATE INDEX `plans_client_date_idx` ON `plans` (`client_id`,`date`,`start`);--> statement-breakpoint
CREATE INDEX `plans_client_status_idx` ON `plans` (`client_id`,`status`);