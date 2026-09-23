CREATE TYPE "public"."landing_mode" AS ENUM('marketing', 'login');--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "landing_mode" "landing_mode" DEFAULT 'marketing' NOT NULL;