CREATE TABLE "webhook_claim_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"used_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_claim_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "webhook_claim_codes" ADD CONSTRAINT "webhook_claim_codes_link_id_webhook_account_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."webhook_account_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_claim_codes" ADD CONSTRAINT "webhook_claim_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_claim_codes" ADD CONSTRAINT "webhook_claim_codes_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;