CREATE TYPE "public"."video_state" AS ENUM('pendingupload', 'downloading', 'queued', 'inprogress', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"uid" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"state" "video_state" DEFAULT 'pendingupload' NOT NULL,
	"pct_complete" real,
	"error_reason_code" text,
	"error_reason_text" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"creator" text,
	"require_signed_urls" boolean DEFAULT false NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thumbnail_timestamp_pct" real DEFAULT 0 NOT NULL,
	"scheduled_deletion" timestamp with time zone,
	"max_duration_seconds" integer,
	"max_size_bytes" bigint,
	"upload_expiry" timestamp with time zone,
	"size" bigint,
	"upload_offset" bigint DEFAULT 0 NOT NULL,
	"upload_id" text,
	"part_size" integer,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_key" text,
	"uploaded" timestamp with time zone,
	"duration" real,
	"width" integer,
	"height" integer,
	"ready_to_stream_at" timestamp with time zone,
	"created_by" uuid,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"modified" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_org_id_index" ON "api_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "videos_org_id_created_index" ON "videos" USING btree ("org_id","created");