CREATE TABLE "image_sources" (
	"image_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_sources_kind_check" CHECK ("image_sources"."kind" = 'tikz')
);
--> statement-breakpoint
CREATE TABLE "image_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"image_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"filename" text NOT NULL,
	"orphaned_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_variants_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "image_variants_mime_type_check" CHECK ("image_variants"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "image_variants_byte_size_check" CHECK ("image_variants"."byte_size" > 0),
	CONSTRAINT "image_variants_dimensions_check" CHECK ("image_variants"."width" > 0 and "image_variants"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"original_filename" text NOT NULL,
	"orphaned_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "images_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "images_mime_type_check" CHECK ("images"."mime_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
	CONSTRAINT "images_byte_size_check" CHECK ("images"."byte_size" > 0),
	CONSTRAINT "images_dimensions_check" CHECK ("images"."width" > 0 and "images"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "question_image_refs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"question_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"image_variant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_object_deletions" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curricula" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subject_id" uuid NOT NULL,
	"grade" smallint NOT NULL,
	CONSTRAINT "curricula_subject_id_grade_unique" UNIQUE("subject_id","grade"),
	CONSTRAINT "curricula_grade_check" CHECK ("curricula"."grade" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "curriculum_nodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "curriculum_nodes_curriculum_id_id_unique" UNIQUE("curriculum_id","id"),
	CONSTRAINT "curriculum_nodes_parent_not_self_check" CHECK ("curriculum_nodes"."parent_id" is null or "curriculum_nodes"."parent_id" <> "curriculum_nodes"."id"),
	CONSTRAINT "curriculum_nodes_position_check" CHECK ("curriculum_nodes"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "learning_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"node_id" uuid NOT NULL,
	"content" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "learning_outcomes_position_check" CHECK ("learning_outcomes"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "question_learning_outcomes" (
	"question_id" uuid NOT NULL,
	"learning_outcome_id" uuid NOT NULL,
	CONSTRAINT "question_learning_outcomes_question_id_learning_outcome_id_pk" PRIMARY KEY("question_id","learning_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "question_subjects" (
	"question_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "question_subjects_question_id_subject_id_pk" PRIMARY KEY("question_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "subjects_position_check" CHECK ("subjects"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"stimulus_id" uuid,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"content" jsonb NOT NULL,
	"guidance" jsonb,
	"solution" jsonb,
	CONSTRAINT "questions_status_check" CHECK ("questions"."status" in ('draft', 'ready')),
	CONSTRAINT "questions_ready_solution_check" CHECK ("questions"."status" = 'draft' or "questions"."solution" is not null),
	CONSTRAINT "questions_type_check" CHECK ("questions"."type" in ('multiple_choice', 'true_false', 'short_answer', 'essay'))
);
--> statement-breakpoint
CREATE TABLE "stimuli" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_sources" ADD CONSTRAINT "image_sources_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variants" ADD CONSTRAINT "image_variants_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_image_refs" ADD CONSTRAINT "question_image_refs_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_image_refs" ADD CONSTRAINT "question_image_refs_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_image_refs" ADD CONSTRAINT "question_image_refs_image_variant_id_image_variants_id_fk" FOREIGN KEY ("image_variant_id") REFERENCES "public"."image_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_nodes" ADD CONSTRAINT "curriculum_nodes_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_nodes" ADD CONSTRAINT "curriculum_nodes_parent_fk" FOREIGN KEY ("curriculum_id","parent_id") REFERENCES "public"."curriculum_nodes"("curriculum_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_node_id_curriculum_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."curriculum_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_learning_outcomes" ADD CONSTRAINT "question_learning_outcomes_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_learning_outcomes" ADD CONSTRAINT "question_learning_outcomes_learning_outcome_id_learning_outcomes_id_fk" FOREIGN KEY ("learning_outcome_id") REFERENCES "public"."learning_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_subjects" ADD CONSTRAINT "question_subjects_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_subjects" ADD CONSTRAINT "question_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_stimulus_id_stimuli_id_fk" FOREIGN KEY ("stimulus_id") REFERENCES "public"."stimuli"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_variants_image_id_idx" ON "image_variants" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "image_variants_orphaned_at_idx" ON "image_variants" USING btree ("orphaned_at");--> statement-breakpoint
CREATE INDEX "images_created_by_user_id_idx" ON "images" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "images_orphaned_at_idx" ON "images" USING btree ("orphaned_at");--> statement-breakpoint
CREATE INDEX "question_image_refs_question_id_idx" ON "question_image_refs" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_image_refs_image_id_idx" ON "question_image_refs" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "question_image_refs_image_variant_id_idx" ON "question_image_refs" USING btree ("image_variant_id");--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "curriculum_nodes_tree_idx" ON "curriculum_nodes" USING btree ("curriculum_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "learning_outcomes_node_id_idx" ON "learning_outcomes" USING btree ("node_id","position");--> statement-breakpoint
CREATE INDEX "question_learning_outcomes_learning_outcome_id_idx" ON "question_learning_outcomes" USING btree ("learning_outcome_id");--> statement-breakpoint
CREATE INDEX "question_subjects_subject_id_idx" ON "question_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "questions_created_by_user_id_idx" ON "questions" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "questions_stimulus_id_idx" ON "questions" USING btree ("stimulus_id");