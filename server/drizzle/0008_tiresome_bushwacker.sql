CREATE TABLE `notification_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mcp_server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`target` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`last_sent_at` text,
	`last_error` text
);
