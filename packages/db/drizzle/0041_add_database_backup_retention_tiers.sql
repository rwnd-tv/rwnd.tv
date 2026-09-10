ALTER TABLE "instance_settings" ADD COLUMN "database_backup_daily_retention_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "database_backup_weekly_retention_weeks" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "database_backup_monthly_retention_months" integer DEFAULT 12 NOT NULL;