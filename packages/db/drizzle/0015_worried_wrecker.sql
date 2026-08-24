CREATE TABLE "pending_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"source" "webhook_source" NOT NULL,
	"external_account_id" text NOT NULL,
	"watched_at" timestamp with time zone NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_webhook_events" ADD CONSTRAINT "pending_webhook_events_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_webhook_events_token_source_account_idx" ON "pending_webhook_events" USING btree ("token_id","source","external_account_id");