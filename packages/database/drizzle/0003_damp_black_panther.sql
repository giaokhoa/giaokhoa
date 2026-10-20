CREATE TABLE "class_enrolments" (
	"class_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "class_enrolments_class_id_user_id_pk" PRIMARY KEY("class_id","user_id"),
	CONSTRAINT "class_enrolments_status_check" CHECK ("class_enrolments"."status" in ('pending', 'active', 'suspended', 'left'))
);
--> statement-breakpoint
CREATE TABLE "class_join_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"class_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "class_join_codes_max_uses_check" CHECK ("class_join_codes"."max_uses" is null or "class_join_codes"."max_uses" > 0),
	CONSTRAINT "class_join_codes_used_count_check" CHECK ("class_join_codes"."used_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"authz_context_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"join_mode" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "classes_authz_context_id_unique" UNIQUE("authz_context_id"),
	CONSTRAINT "classes_status_check" CHECK ("classes"."status" in ('active', 'archived')),
	CONSTRAINT "classes_join_mode_check" CHECK ("classes"."join_mode" in ('AUTO', 'APPROVAL')),
	CONSTRAINT "classes_name_check" CHECK (length(trim("classes"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_join_codes" ADD CONSTRAINT "class_join_codes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_join_codes" ADD CONSTRAINT "class_join_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_authz_context_id_authz_contexts_id_fk" FOREIGN KEY ("authz_context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_enrolments_user_idx" ON "class_enrolments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_join_codes_hash_unique" ON "class_join_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "class_join_codes_class_idx" ON "class_join_codes" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "classes_created_by_idx" ON "classes" USING btree ("created_by_user_id");