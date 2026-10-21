CREATE TABLE "file_blobs" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_blobs_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "file_blobs_content_hash_check" CHECK ("file_blobs"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_blobs_byte_size_check" CHECK ("file_blobs"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_object_deletions" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_sources" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_sources_kind_check" CHECK ("file_sources"."kind" = 'tikz')
);
--> statement-breakpoint
CREATE TABLE "file_uses" (
	"file_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"component" text NOT NULL,
	"file_area" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_uses_identity_unique" UNIQUE("file_id","context_id","component","file_area","item_id"),
	CONSTRAINT "file_uses_component_check" CHECK (length(trim("file_uses"."component")) > 0),
	CONSTRAINT "file_uses_file_area_check" CHECK (length(trim("file_uses"."file_area")) > 0),
	CONSTRAINT "file_uses_item_id_check" CHECK (length(trim("file_uses"."item_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"original_filename" text NOT NULL,
	"parent_file_id" uuid,
	"orphaned_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "files_dimensions_check" CHECK ("files"."width" > 0 and "files"."height" > 0),
	CONSTRAINT "files_parent_not_self_check" CHECK ("files"."parent_file_id" is null or "files"."parent_file_id" <> "files"."id")
);
--> statement-breakpoint
ALTER TABLE "file_sources" ADD CONSTRAINT "file_sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uses" ADD CONSTRAINT "file_uses_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uses" ADD CONSTRAINT "file_uses_context_id_authz_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_content_hash_file_blobs_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."file_blobs"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_file_id_files_id_fk" FOREIGN KEY ("parent_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_uses_file_id_idx" ON "file_uses" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_uses_context_idx" ON "file_uses" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "files_created_by_user_id_idx" ON "files" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "files_content_hash_idx" ON "files" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "files_parent_file_id_idx" ON "files" USING btree ("parent_file_id");--> statement-breakpoint
CREATE INDEX "files_orphaned_at_idx" ON "files" USING btree ("orphaned_at");