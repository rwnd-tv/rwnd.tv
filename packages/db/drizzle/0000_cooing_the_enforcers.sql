-- drizzle-kit doesn't manage extensions; citext backs the case-insensitive
-- email column on "users" (see packages/db/src/schema.ts).
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('local', 'oidc');--> statement-breakpoint
CREATE TYPE "public"."external_id_source" AS ENUM('tmdb', 'imdb', 'tvdb', 'trakt');--> statement-breakpoint
CREATE TYPE "public"."metadata_entity_type" AS ENUM('movie', 'show', 'episode');--> statement-breakpoint
CREATE TYPE "public"."play_source" AS ENUM('manual', 'plex', 'import');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('open', 'invite', 'closed');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text,
	"runtime_minutes" integer,
	"first_aired" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "metadata_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" "external_id_source" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"instance_name" text DEFAULT 'rwnd.tv' NOT NULL,
	"registration_mode" "registration_mode" DEFAULT 'closed' NOT NULL,
	"default_locale" text DEFAULT 'en-GB' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"used_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"runtime_minutes" integer,
	"overview" text,
	"poster_path" text,
	"metadata_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"movie_id" uuid,
	"episode_id" uuid,
	"watched_at" timestamp with time zone NOT NULL,
	"source" "play_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plays_exactly_one_media_ref" CHECK (("plays"."movie_id" IS NOT NULL)::int + ("plays"."episode_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"overview" text,
	"poster_path" text,
	"metadata_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "credential_type" NOT NULL,
	"password_hash" text,
	"oidc_issuer" text,
	"oidc_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_credentials_local_has_password" CHECK ("user_credentials"."type" <> 'local' OR "user_credentials"."password_hash" IS NOT NULL),
	CONSTRAINT "user_credentials_oidc_has_identity" CHECK ("user_credentials"."type" <> 'oidc' OR ("user_credentials"."oidc_issuer" IS NOT NULL AND "user_credentials"."oidc_subject" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'en-GB' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" "theme" DEFAULT 'system' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_show_season_episode_idx" ON "episodes" USING btree ("show_id","season_number","episode_number");--> statement-breakpoint
CREATE UNIQUE INDEX "external_ids_entity_source_idx" ON "external_ids" USING btree ("entity_type","entity_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "external_ids_source_lookup_idx" ON "external_ids" USING btree ("entity_type","source","external_id");--> statement-breakpoint
CREATE INDEX "plays_user_watched_at_idx" ON "plays" USING btree ("user_id","watched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_local_user_id_idx" ON "user_credentials" USING btree ("user_id") WHERE "user_credentials"."type" = 'local';--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_oidc_issuer_subject_idx" ON "user_credentials" USING btree ("oidc_issuer","oidc_subject") WHERE "user_credentials"."type" = 'oidc';