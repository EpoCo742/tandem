CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`tag` blob NOT NULL,
	`summary` text NOT NULL,
	`tools` text,
	`status` text DEFAULT 'untested' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`tested_at` text
);
