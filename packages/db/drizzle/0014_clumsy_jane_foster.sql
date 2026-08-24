CREATE TYPE "public"."webhook_source" AS ENUM('plex');--> statement-breakpoint
CREATE TABLE "webhook_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"source" "webhook_source" NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_name" text NOT NULL,
	"user_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_account_links" ADD CONSTRAINT "webhook_account_links_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_account_links" ADD CONSTRAINT "webhook_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_account_links_token_source_account_idx" ON "webhook_account_links" USING btree ("token_id","source","external_account_id");