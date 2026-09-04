CREATE TYPE "public"."calendar_feed_type" AS ENUM('history', 'shows');--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feed_type" "calendar_feed_type" NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"include_movies" boolean DEFAULT true NOT NULL,
	"include_shows" boolean DEFAULT true NOT NULL,
	"include_dropped" boolean DEFAULT false NOT NULL,
	"future_only" boolean DEFAULT true NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_user_type_idx" ON "calendar_feeds" USING btree ("user_id","feed_type");--> statement-breakpoint
CREATE INDEX "episodes_first_aired_idx" ON "episodes" USING btree ("first_aired");