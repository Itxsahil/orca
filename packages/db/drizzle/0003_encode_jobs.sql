ALTER TABLE "videos" ADD COLUMN "encode_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "encode_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "videos_state_uploaded_index" ON "videos" USING btree ("state","uploaded");