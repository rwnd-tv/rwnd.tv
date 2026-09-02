ALTER TABLE "webhook_claim_codes" RENAME TO "webhook_link_codes";--> statement-breakpoint
ALTER TABLE "webhook_link_codes" RENAME CONSTRAINT "webhook_claim_codes_link_id_webhook_account_links_id_fk" TO "webhook_link_codes_link_id_webhook_account_links_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_link_codes" RENAME CONSTRAINT "webhook_claim_codes_created_by_users_id_fk" TO "webhook_link_codes_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_link_codes" RENAME CONSTRAINT "webhook_claim_codes_used_by_users_id_fk" TO "webhook_link_codes_used_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_link_codes" RENAME CONSTRAINT "webhook_claim_codes_code_hash_unique" TO "webhook_link_codes_code_hash_unique";
