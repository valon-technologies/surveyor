CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`field_mapping_id` text,
	`entity_id` text,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_field_mapping_idx` ON `activity` (`field_mapping_id`);--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activity` (`entity_id`);--> statement-breakpoint
CREATE INDEX `activity_workspace_created_idx` ON `activity` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `batch_run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_entities` integer DEFAULT 0 NOT NULL,
	`completed_entities` integer DEFAULT 0 NOT NULL,
	`failed_entities` integer DEFAULT 0 NOT NULL,
	`total_fields` integer DEFAULT 0 NOT NULL,
	`completed_fields` integer DEFAULT 0 NOT NULL,
	`config` text,
	`started_at` text,
	`completed_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `batch_run_workspace_idx` ON `batch_run` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `batch_run_status_idx` ON `batch_run` (`status`);--> statement-breakpoint
CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_message_session_idx` ON `chat_message` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_message_session_created_idx` ON `chat_message` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_session` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`field_mapping_id` text,
	`target_field_id` text,
	`entity_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_mapping_id`) REFERENCES `field_mapping`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_field_id`) REFERENCES `field`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_session_workspace_idx` ON `chat_session` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `chat_session_mapping_idx` ON `chat_session` (`field_mapping_id`);--> statement-breakpoint
CREATE INDEX `chat_session_status_idx` ON `chat_session` (`status`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`body_format` text DEFAULT 'markdown' NOT NULL,
	`metadata` text,
	`edited_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `comment_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_thread_idx` ON `comment` (`thread_id`);--> statement-breakpoint
CREATE INDEX `comment_thread_created_idx` ON `comment` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `comment_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_id` text,
	`field_mapping_id` text,
	`subject` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_mapping_id`) REFERENCES `field_mapping`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_workspace_idx` ON `comment_thread` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `thread_entity_idx` ON `comment_thread` (`entity_id`);--> statement-breakpoint
CREATE INDEX `thread_mapping_idx` ON `comment_thread` (`field_mapping_id`);--> statement-breakpoint
CREATE INDEX `thread_status_idx` ON `comment_thread` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `context` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`subcategory` text,
	`entity_id` text,
	`field_id` text,
	`content` text DEFAULT '' NOT NULL,
	`content_format` text DEFAULT 'markdown' NOT NULL,
	`token_count` integer,
	`tags` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`import_source` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`field_id`) REFERENCES `field`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `context_workspace_idx` ON `context` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `context_category_idx` ON `context` (`workspace_id`,`category`);--> statement-breakpoint
CREATE INDEX `context_entity_idx` ON `context` (`entity_id`);--> statement-breakpoint
CREATE INDEX `context_field_idx` ON `context` (`field_id`);--> statement-breakpoint
CREATE TABLE `entity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`schema_asset_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`side` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schema_asset_id`) REFERENCES `schema_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_workspace_idx` ON `entity` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `entity_schema_asset_idx` ON `entity` (`schema_asset_id`);--> statement-breakpoint
CREATE INDEX `entity_side_idx` ON `entity` (`workspace_id`,`side`);--> statement-breakpoint
CREATE INDEX `entity_status_idx` ON `entity` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `entity_pipeline` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`parent_id` text,
	`is_latest` integer DEFAULT true NOT NULL,
	`yaml_spec` text NOT NULL,
	`table_name` text NOT NULL,
	`primary_key` text,
	`sources` text NOT NULL,
	`joins` text,
	`concat` text,
	`structure_type` text DEFAULT 'flat' NOT NULL,
	`is_stale` integer DEFAULT false NOT NULL,
	`generation_id` text,
	`batch_run_id` text,
	`edited_by` text,
	`change_summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_pipeline_workspace_idx` ON `entity_pipeline` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `entity_pipeline_entity_idx` ON `entity_pipeline` (`entity_id`);--> statement-breakpoint
CREATE INDEX `entity_pipeline_latest_idx` ON `entity_pipeline` (`entity_id`,`is_latest`);--> statement-breakpoint
CREATE TABLE `field` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`data_type` text,
	`is_required` integer DEFAULT false NOT NULL,
	`is_key` integer DEFAULT false NOT NULL,
	`description` text,
	`milestone` text,
	`sample_values` text,
	`enum_values` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `field_entity_name_idx` ON `field` (`entity_id`,`name`);--> statement-breakpoint
CREATE INDEX `field_entity_idx` ON `field` (`entity_id`);--> statement-breakpoint
CREATE TABLE `field_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target_field_id` text NOT NULL,
	`status` text DEFAULT 'unmapped' NOT NULL,
	`mapping_type` text,
	`assignee_id` text,
	`source_entity_id` text,
	`source_field_id` text,
	`transform` text,
	`default_value` text,
	`enum_mapping` text,
	`reasoning` text,
	`confidence` text,
	`notes` text,
	`created_by` text DEFAULT 'manual' NOT NULL,
	`generation_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`parent_id` text,
	`is_latest` integer DEFAULT true NOT NULL,
	`edited_by` text,
	`change_summary` text,
	`punt_note` text,
	`exclude_reason` text,
	`batch_run_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_field_id`) REFERENCES `field`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_field_id`) REFERENCES `field`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mapping_workspace_idx` ON `field_mapping` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `mapping_target_field_idx` ON `field_mapping` (`target_field_id`);--> statement-breakpoint
CREATE INDEX `mapping_source_field_idx` ON `field_mapping` (`source_field_id`);--> statement-breakpoint
CREATE INDEX `mapping_status_idx` ON `field_mapping` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `mapping_latest_idx` ON `field_mapping` (`target_field_id`,`is_latest`);--> statement-breakpoint
CREATE INDEX `mapping_assignee_idx` ON `field_mapping` (`assignee_id`);--> statement-breakpoint
CREATE TABLE `generation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_id` text,
	`generation_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`model` text,
	`prompt_snapshot` text,
	`output` text,
	`output_parsed` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`error` text,
	`batch_run_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generation_workspace_idx` ON `generation` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `generation_entity_idx` ON `generation` (`entity_id`);--> statement-breakpoint
CREATE INDEX `generation_status_idx` ON `generation` (`status`);--> statement-breakpoint
CREATE INDEX `generation_batch_run_idx` ON `generation` (`batch_run_id`);--> statement-breakpoint
CREATE TABLE `learning` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_id` text,
	`field_name` text,
	`scope` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`session_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `learning_workspace_idx` ON `learning` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_entity_idx` ON `learning` (`entity_id`);--> statement-breakpoint
CREATE INDEX `learning_scope_idx` ON `learning` (`scope`);--> statement-breakpoint
CREATE TABLE `mapping_context` (
	`id` text PRIMARY KEY NOT NULL,
	`field_mapping_id` text NOT NULL,
	`context_id` text,
	`context_type` text NOT NULL,
	`excerpt` text,
	`relevance` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`field_mapping_id`) REFERENCES `field_mapping`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `context`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mapping_context_mapping_idx` ON `mapping_context` (`field_mapping_id`);--> statement-breakpoint
CREATE INDEX `mapping_context_context_idx` ON `mapping_context` (`context_id`);--> statement-breakpoint
CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_id` text,
	`field_id` text,
	`question` text NOT NULL,
	`answer` text,
	`status` text DEFAULT 'open' NOT NULL,
	`asked_by` text DEFAULT 'user' NOT NULL,
	`answered_by` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`target_for_team` text,
	`field_mapping_id` text,
	`chat_session_id` text,
	`schema_asset_ids` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `field`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`field_mapping_id`) REFERENCES `field_mapping`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `question_workspace_idx` ON `question` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `question_entity_idx` ON `question` (`entity_id`);--> statement-breakpoint
CREATE INDEX `question_status_idx` ON `question` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `question_team_idx` ON `question` (`target_for_team`,`status`);--> statement-breakpoint
CREATE TABLE `schema_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`description` text,
	`source_file` text,
	`format` text DEFAULT 'csv' NOT NULL,
	`raw_content` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schema_asset_workspace_idx` ON `schema_asset` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `schema_asset_side_idx` ON `schema_asset` (`workspace_id`,`side`);--> statement-breakpoint
CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text,
	`applicability` text,
	`tags` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_workspace_idx` ON `skill` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `skill_context` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`context_id` text NOT NULL,
	`role` text DEFAULT 'reference' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `context`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_context_skill_idx` ON `skill_context` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_context_context_idx` ON `skill_context` (`context_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`email_verified` text,
	`image` text,
	`password_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`key_prefix` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_api_key_user_idx` ON `user_api_key` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_api_key_user_provider_idx` ON `user_api_key` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `user_bigquery_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text,
	`encrypted_refresh_token` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`scope` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_bq_token_user_idx` ON `user_bigquery_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`team` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_workspace_user_idx` ON `user_workspace` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_workspace_workspace_idx` ON `user_workspace` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `validation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`field_mapping_id` text NOT NULL,
	`entity_id` text,
	`status` text NOT NULL,
	`input` text,
	`output` text,
	`error_message` text,
	`duration_ms` integer,
	`ran_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_mapping_id`) REFERENCES `field_mapping`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `validation_field_mapping_idx` ON `validation` (`field_mapping_id`);--> statement-breakpoint
CREATE INDEX `validation_workspace_idx` ON `validation` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `verification_token` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_token_idx` ON `verification_token` (`identifier`,`token`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`settings` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_invite_workspace_idx` ON `workspace_invite` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_invite_email_idx` ON `workspace_invite` (`email`);