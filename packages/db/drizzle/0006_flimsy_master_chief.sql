CREATE TABLE "dropped_shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"show_id" uuid NOT NULL,
	"trakt_dropped" boolean,
	"trakt_dropped_at" timestamp with time zone,
	"manual_dropped" boolean,
	"manual_dropped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "include_dropped" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dropped_shows" ADD CONSTRAINT "dropped_shows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropped_shows" ADD CONSTRAINT "dropped_shows_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dropped_shows_user_show_idx" ON "dropped_shows" USING btree ("user_id","show_id");