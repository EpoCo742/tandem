CREATE TABLE `events` (
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`caused_by` text NOT NULL,
	`turn_id` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `events_id_idx` ON `events` (`id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`token` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`credential_id` text,
	`color` text NOT NULL,
	`consented_at` text,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`tag` blob NOT NULL,
	`fingerprint` text,
	`models` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`policy` text DEFAULT 'hybrid' NOT NULL,
	`payer_mode` text DEFAULT 'sponsor' NOT NULL,
	`pinned_model` text NOT NULL,
	`provider` text NOT NULL,
	`sponsor_credential_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`extracted_text` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer,
	`handle` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `yjs_documents` (
	`name` text PRIMARY KEY NOT NULL,
	`state` blob NOT NULL,
	`updated_at` text NOT NULL
);
