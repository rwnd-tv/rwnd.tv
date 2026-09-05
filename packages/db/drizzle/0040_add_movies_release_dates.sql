ALTER TYPE "public"."calendar_feed_type" ADD VALUE 'movies';--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "release_dates" jsonb;