ALTER TYPE "public"."play_source" ADD VALUE 'tautulli';--> statement-breakpoint
ALTER TYPE "public"."webhook_source" ADD VALUE 'tautulli';--> statement-breakpoint
ALTER TABLE "webhook_account_links" ADD COLUMN "external_server_id" text;