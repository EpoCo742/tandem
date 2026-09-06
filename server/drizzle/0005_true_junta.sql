CREATE TABLE `publication_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`no` integer NOT NULL,
	`doc_version_no` integer NOT NULL,
	`commit_id` text,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`published_by` text,
	`published_by_name` text NOT NULL,
	`published_at` text NOT NULL,
	`note` text,
	`approval` text
);
--> statement-breakpoint
CREATE INDEX `publication_versions_pub_idx` ON `publication_versions` (`publication_id`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_slug_unique` ON `publications` (`slug`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `library_fts` USING fts5(`kind`, `session_id` UNINDEXED, `ref_id` UNINDEXED, `title`, `body`, `people`, `session_title`, `is_public` UNINDEXED, `updated_at` UNINDEXED, `link` UNINDEXED, `artifact_id` UNINDEXED, tokenize = 'porter unicode61');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_index_state` (`session_id` text PRIMARY KEY NOT NULL, `indexed_seq` integer NOT NULL, `indexed_at` text NOT NULL);
