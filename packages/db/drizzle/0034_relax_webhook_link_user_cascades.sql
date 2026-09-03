ALTER TABLE "webhook_account_links" DROP CONSTRAINT "webhook_account_links_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_link_codes" DROP CONSTRAINT "webhook_link_codes_used_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_account_links" ADD CONSTRAINT "webhook_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_link_codes" ADD CONSTRAINT "webhook_link_codes_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;