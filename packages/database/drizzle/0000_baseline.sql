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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL
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
	"banned" boolean DEFAULT false NOT NULL,
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
	"question_bank_entry_id" uuid NOT NULL,
	"learning_outcome_id" uuid NOT NULL,
	CONSTRAINT "question_learning_outcomes_question_bank_entry_id_learning_outcome_id_pk" PRIMARY KEY("question_bank_entry_id","learning_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "question_subjects" (
	"question_bank_entry_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "question_subjects_question_bank_entry_id_subject_id_pk" PRIMARY KEY("question_bank_entry_id","subject_id")
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
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"stimulus_id" uuid,
	"type" text NOT NULL,
	"content" jsonb NOT NULL,
	"guidance" jsonb,
	"solution" jsonb,
	CONSTRAINT "question_type_check" CHECK ("question"."type" in ('multiple_choice', 'true_false', 'short_answer', 'essay'))
);
--> statement-breakpoint
CREATE TABLE "question_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"question_bank_entry_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "question_versions_entry_version_unique" UNIQUE("question_bank_entry_id","version"),
	CONSTRAINT "question_versions_question_unique" UNIQUE("question_id"),
	CONSTRAINT "question_versions_version_check" CHECK ("question_versions"."version" > 0),
	CONSTRAINT "question_versions_status_check" CHECK ("question_versions"."status" in ('draft', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "stimuli" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_by_user_id" uuid,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"context_kind" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "authz_capabilities_key_unique" UNIQUE("key"),
	CONSTRAINT "authz_capabilities_context_kind_check" CHECK ("authz_capabilities"."context_kind" in ('system', 'class'))
);
--> statement-breakpoint
CREATE TABLE "authz_contexts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authz_contexts_kind_resource_unique" UNIQUE("kind","resource_key"),
	CONSTRAINT "authz_contexts_kind_check" CHECK ("authz_contexts"."kind" in ('system', 'user', 'bank', 'question', 'exam', 'class', 'assignment')),
	CONSTRAINT "authz_contexts_parent_not_self_check" CHECK ("authz_contexts"."parent_id" is null or "authz_contexts"."parent_id" <> "authz_contexts"."id")
);
--> statement-breakpoint
CREATE TABLE "authz_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"source" text NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "authz_role_permissions" (
	"role_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"effect" text NOT NULL,
	CONSTRAINT "authz_role_permissions_role_capability_unique" UNIQUE("role_id","capability_id"),
	CONSTRAINT "authz_role_permissions_effect_check" CHECK ("authz_role_permissions"."effect" in ('INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT'))
);
--> statement-breakpoint
CREATE TABLE "authz_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"context_kind" text NOT NULL,
	"is_builtin" boolean DEFAULT true NOT NULL,
	CONSTRAINT "authz_roles_key_unique" UNIQUE("key"),
	CONSTRAINT "authz_roles_context_kind_check" CHECK ("authz_roles"."context_kind" in ('system', 'class'))
);
--> statement-breakpoint
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
CREATE TABLE "exam_revision_questions" (
	"exam_revision_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"question_snapshot" jsonb NOT NULL,
	"stimulus_snapshot" jsonb,
	CONSTRAINT "exam_revision_questions_position_unique" UNIQUE("exam_revision_id","position"),
	CONSTRAINT "exam_revision_questions_version_unique" UNIQUE("exam_revision_id","question_version_id"),
	CONSTRAINT "exam_revision_questions_position_check" CHECK ("exam_revision_questions"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "exam_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exam_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exam_revisions_exam_revision_unique" UNIQUE("exam_id","revision"),
	CONSTRAINT "exam_revisions_revision_check" CHECK ("exam_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exams_title_check" CHECK (length(trim("exams"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "assignment_recipients" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "assignment_recipients_assignment_id_user_id_pk" PRIMARY KEY("assignment_id","user_id"),
	CONSTRAINT "assignment_recipients_status_check" CHECK ("assignment_recipients"."status" in ('active', 'revoked')),
	CONSTRAINT "assignment_recipients_source_check" CHECK ("assignment_recipients"."source" in ('all_class', 'selected_users')),
	CONSTRAINT "assignment_recipients_revocation_check" CHECK (("assignment_recipients"."status" = 'revoked') = ("assignment_recipients"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"class_id" uuid NOT NULL,
	"exam_revision_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"audience_mode" text NOT NULL,
	"selected_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"open_at" timestamp NOT NULL,
	"close_at" timestamp NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"release_score_at" timestamp,
	"release_feedback_at" timestamp,
	"release_solutions_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "assignments_audience_check" CHECK ("assignments"."audience_mode" in ('ALL_CLASS', 'SELECTED_USERS')),
	CONSTRAINT "assignments_status_check" CHECK ("assignments"."status" in ('draft', 'published')),
	CONSTRAINT "assignments_window_check" CHECK ("assignments"."open_at" < "assignments"."close_at"),
	CONSTRAINT "assignments_max_attempts_check" CHECK ("assignments"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "attempt_responses" (
	"attempt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"answer" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_responses_attempt_id_position_pk" PRIMARY KEY("attempt_id","position"),
	CONSTRAINT "attempt_responses_position_check" CHECK ("attempt_responses"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"graded_at" timestamp,
	"score_basis_points" integer,
	"feedback" text,
	CONSTRAINT "attempts_assignment_user_number_unique" UNIQUE("assignment_id","user_id","attempt_number"),
	CONSTRAINT "attempts_number_check" CHECK ("attempts"."attempt_number" > 0),
	CONSTRAINT "attempts_status_check" CHECK ("attempts"."status" in ('in_progress', 'submitted', 'graded')),
	CONSTRAINT "attempts_score_check" CHECK ("attempts"."score_basis_points" is null or "attempts"."score_basis_points" between 0 and 10000),
	CONSTRAINT "attempts_lifecycle_check" CHECK (
      ("attempts"."status" = 'in_progress' and "attempts"."submitted_at" is null and "attempts"."graded_at" is null and "attempts"."score_basis_points" is null)
      or ("attempts"."status" = 'submitted' and "attempts"."submitted_at" is not null and "attempts"."graded_at" is null and "attempts"."score_basis_points" is null)
      or ("attempts"."status" = 'graded' and "attempts"."submitted_at" is not null and "attempts"."graded_at" is not null and "attempts"."score_basis_points" is not null)
    )
);
--> statement-breakpoint
ALTER TABLE "file_sources" ADD CONSTRAINT "file_sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uses" ADD CONSTRAINT "file_uses_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uses" ADD CONSTRAINT "file_uses_context_id_authz_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_content_hash_file_blobs_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."file_blobs"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_file_id_files_id_fk" FOREIGN KEY ("parent_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_nodes" ADD CONSTRAINT "curriculum_nodes_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_nodes" ADD CONSTRAINT "curriculum_nodes_parent_fk" FOREIGN KEY ("curriculum_id","parent_id") REFERENCES "public"."curriculum_nodes"("curriculum_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_node_id_curriculum_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."curriculum_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_learning_outcomes" ADD CONSTRAINT "question_learning_outcomes_question_bank_entry_id_question_bank_entries_id_fk" FOREIGN KEY ("question_bank_entry_id") REFERENCES "public"."question_bank_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_learning_outcomes" ADD CONSTRAINT "question_learning_outcomes_learning_outcome_id_learning_outcomes_id_fk" FOREIGN KEY ("learning_outcome_id") REFERENCES "public"."learning_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_subjects" ADD CONSTRAINT "question_subjects_question_bank_entry_id_question_bank_entries_id_fk" FOREIGN KEY ("question_bank_entry_id") REFERENCES "public"."question_bank_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_subjects" ADD CONSTRAINT "question_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_stimulus_id_stimuli_id_fk" FOREIGN KEY ("stimulus_id") REFERENCES "public"."stimuli"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD CONSTRAINT "question_bank_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_bank_entry_id_question_bank_entries_id_fk" FOREIGN KEY ("question_bank_entry_id") REFERENCES "public"."question_bank_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stimuli" ADD CONSTRAINT "stimuli_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_contexts" ADD CONSTRAINT "authz_contexts_parent_id_authz_contexts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_context_id_authz_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_permissions" ADD CONSTRAINT "authz_role_permissions_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_permissions" ADD CONSTRAINT "authz_role_permissions_capability_id_authz_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."authz_capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_join_codes" ADD CONSTRAINT "class_join_codes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_join_codes" ADD CONSTRAINT "class_join_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_authz_context_id_authz_contexts_id_fk" FOREIGN KEY ("authz_context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_revision_questions" ADD CONSTRAINT "exam_revision_questions_exam_revision_id_exam_revisions_id_fk" FOREIGN KEY ("exam_revision_id") REFERENCES "public"."exam_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_revision_questions" ADD CONSTRAINT "exam_revision_questions_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_revisions" ADD CONSTRAINT "exam_revisions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_exam_revision_id_exam_revisions_id_fk" FOREIGN KEY ("exam_revision_id") REFERENCES "public"."exam_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_responses" ADD CONSTRAINT "attempt_responses_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_recipient_fk" FOREIGN KEY ("assignment_id","user_id") REFERENCES "public"."assignment_recipients"("assignment_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_uses_file_id_idx" ON "file_uses" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_uses_context_idx" ON "file_uses" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "files_created_by_user_id_idx" ON "files" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "files_content_hash_idx" ON "files" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "files_parent_file_id_idx" ON "files" USING btree ("parent_file_id");--> statement-breakpoint
CREATE INDEX "files_orphaned_at_idx" ON "files" USING btree ("orphaned_at");--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "curriculum_nodes_tree_idx" ON "curriculum_nodes" USING btree ("curriculum_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "learning_outcomes_node_id_idx" ON "learning_outcomes" USING btree ("node_id","position");--> statement-breakpoint
CREATE INDEX "question_learning_outcomes_learning_outcome_id_idx" ON "question_learning_outcomes" USING btree ("learning_outcome_id");--> statement-breakpoint
CREATE INDEX "question_subjects_subject_id_idx" ON "question_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "question_created_by_user_id_idx" ON "question" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "question_stimulus_id_idx" ON "question" USING btree ("stimulus_id");--> statement-breakpoint
CREATE INDEX "question_bank_entries_created_by_user_id_idx" ON "question_bank_entries" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "question_versions_entry_id_idx" ON "question_versions" USING btree ("question_bank_entry_id");--> statement-breakpoint
CREATE INDEX "authz_contexts_parent_idx" ON "authz_contexts" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authz_role_assignments_active_unique" ON "authz_role_assignments" USING btree ("user_id","role_id","context_id") WHERE "authz_role_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "authz_role_assignments_context_idx" ON "authz_role_assignments" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "authz_role_assignments_user_idx" ON "authz_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "class_enrolments_user_idx" ON "class_enrolments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_join_codes_hash_unique" ON "class_join_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "class_join_codes_class_idx" ON "class_join_codes" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "classes_created_by_idx" ON "classes" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "exam_revision_questions_version_idx" ON "exam_revision_questions" USING btree ("question_version_id");--> statement-breakpoint
CREATE INDEX "exam_revisions_exam_idx" ON "exam_revisions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exams_created_by_idx" ON "exams" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "assignment_recipients_user_idx" ON "assignment_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assignments_class_idx" ON "assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "assignments_exam_revision_idx" ON "assignments" USING btree ("exam_revision_id");--> statement-breakpoint
CREATE INDEX "attempts_assignment_idx" ON "attempts" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "authz_role_context_levels" (
	"role_id" uuid NOT NULL,
	"context_kind" text NOT NULL,
	CONSTRAINT "authz_role_context_levels_unique" UNIQUE("role_id","context_kind"),
	CONSTRAINT "authz_role_context_levels_kind_check" CHECK ("authz_role_context_levels"."context_kind" in ('system', 'user', 'bank', 'question', 'exam', 'class', 'assignment'))
);
--> statement-breakpoint
CREATE TABLE "authz_role_overrides" (
	"role_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"effect" text NOT NULL,
	CONSTRAINT "authz_role_overrides_unique" UNIQUE("role_id","capability_id","context_id"),
	CONSTRAINT "authz_role_overrides_effect_check" CHECK ("authz_role_overrides"."effect" in ('INHERIT', 'ALLOW', 'PREVENT', 'PROHIBIT'))
);
--> statement-breakpoint
ALTER TABLE "authz_role_context_levels" ADD CONSTRAINT "authz_role_context_levels_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_overrides" ADD CONSTRAINT "authz_role_overrides_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_overrides" ADD CONSTRAINT "authz_role_overrides_capability_id_authz_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."authz_capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_overrides" ADD CONSTRAINT "authz_role_overrides_context_id_authz_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authz_role_overrides_context_idx" ON "authz_role_overrides" USING btree ("context_id");
CREATE TABLE "authz_role_allow_assignments" (
	"actor_role_id" uuid NOT NULL,
	"target_role_id" uuid NOT NULL,
	CONSTRAINT "authz_role_allow_assignments_unique" UNIQUE("actor_role_id","target_role_id")
);
--> statement-breakpoint
CREATE TABLE "authz_role_allow_overrides" (
	"actor_role_id" uuid NOT NULL,
	"target_role_id" uuid NOT NULL,
	CONSTRAINT "authz_role_allow_overrides_unique" UNIQUE("actor_role_id","target_role_id")
);
--> statement-breakpoint
ALTER TABLE "authz_role_allow_assignments" ADD CONSTRAINT "authz_role_allow_assignments_actor_role_id_authz_roles_id_fk" FOREIGN KEY ("actor_role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_allow_assignments" ADD CONSTRAINT "authz_role_allow_assignments_target_role_id_authz_roles_id_fk" FOREIGN KEY ("target_role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_allow_overrides" ADD CONSTRAINT "authz_role_allow_overrides_actor_role_id_authz_roles_id_fk" FOREIGN KEY ("actor_role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_allow_overrides" ADD CONSTRAINT "authz_role_allow_overrides_target_role_id_authz_roles_id_fk" FOREIGN KEY ("target_role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Vai trò người dùng đăng nhập áp dụng ngầm tại system context; vai trò giáo viên/quản trị viên phải được cấp riêng trong authz_role_assignments. Không cấp mặc định class:manage_any hoặc class:grant_teacher.
INSERT INTO "authz_contexts" ("kind", "resource_key", "parent_id") VALUES ('system', 'giaokhoa', NULL) ON CONFLICT ("kind", "resource_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_roles" ("key", "context_kind") VALUES
  ('system:user', 'system'),
  ('system:teacher', 'system'),
  ('system:admin', 'system'),
  ('class:owner', 'class'),
  ('class:teacher', 'class'),
  ('class:student', 'class')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_role_context_levels" ("role_id", "context_kind")
SELECT r."id", allowed."context_kind"
FROM (VALUES
  ('system:user', 'system'), ('system:teacher', 'system'), ('system:admin', 'system'),
  ('class:owner', 'class'), ('class:teacher', 'class'), ('class:teacher', 'assignment'),
  ('class:student', 'class'), ('class:student', 'assignment')
) AS allowed("role_key", "context_kind") JOIN "authz_roles" r ON r."key" = allowed."role_key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_role_allow_assignments" ("actor_role_id", "target_role_id")
SELECT actor."id", target."id" FROM "authz_roles" actor JOIN "authz_roles" target ON
 (actor."key" = 'system:admin') OR
 (actor."key" = 'class:owner' AND target."key" IN ('class:student','class:teacher')) OR
 (actor."key" = 'class:teacher' AND target."key" = 'class:student')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_role_allow_overrides" ("actor_role_id", "target_role_id")
SELECT actor."id", target."id" FROM "authz_roles" actor JOIN "authz_roles" target ON
 (actor."key" = 'system:admin') OR
 (actor."key" = 'class:owner' AND target."key" IN ('class:student','class:teacher')) OR
 (actor."key" = 'class:teacher' AND target."key" = 'class:student')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_capabilities" ("key", "context_kind", "description") VALUES
  ('resource:view_public', 'system', 'resource:view_public'),
  ('practice:attempt_public', 'system', 'practice:attempt_public'),
  ('class:join', 'system', 'class:join'),
  ('file:read_own', 'system', 'file:read_own'),
  ('question:create_own', 'system', 'question:create_own'),
  ('question:manage_own', 'system', 'question:manage_own'),
  ('exam:create_own', 'system', 'exam:create_own'),
  ('exam:manage_own', 'system', 'exam:manage_own'),
  ('class:create', 'system', 'class:create'),
  ('platform:moderate', 'system', 'platform:moderate'),
  ('role:assign_system', 'system', 'role:assign_system'),
  ('role:manage', 'system', 'role:manage'),
  ('role:assign', 'class', 'role:assign'),
  ('role:override', 'class', 'role:override'),
  ('class:manage_any', 'system', 'class:manage_any'),
  ('class:view', 'class', 'class:view'),
  ('class:update', 'class', 'class:update'),
  ('class:enrolment_manage', 'class', 'class:enrolment_manage'),
  ('assignment:create', 'class', 'assignment:create'),
  ('assignment:publish', 'class', 'assignment:publish'),
  ('assignment:grade', 'class', 'assignment:grade'),
  ('assignment:view_assigned', 'class', 'assignment:view_assigned'),
  ('assignment:attempt', 'class', 'assignment:attempt'),
  ('result:view_own', 'class', 'result:view_own'),
  ('result:view_class', 'class', 'result:view_class'),
  ('class:grant_teacher', 'class', 'class:grant_teacher')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "authz_role_permissions" ("role_id", "capability_id", "effect")
SELECT r."id", c."id", 'ALLOW'
FROM (VALUES
  ('system:user', 'resource:view_public'),
  ('system:user', 'practice:attempt_public'),
  ('system:user', 'class:join'),
  ('system:user', 'file:read_own'),
  ('system:teacher', 'resource:view_public'),
  ('system:teacher', 'practice:attempt_public'),
  ('system:teacher', 'class:join'),
  ('system:teacher', 'question:create_own'),
  ('system:teacher', 'question:manage_own'),
  ('system:teacher', 'exam:create_own'),
  ('system:teacher', 'exam:manage_own'),
  ('system:teacher', 'class:create'),
  ('system:admin', 'resource:view_public'),
  ('system:admin', 'practice:attempt_public'),
  ('system:admin', 'class:join'),
  ('system:admin', 'question:create_own'),
  ('system:admin', 'question:manage_own'),
  ('system:admin', 'exam:create_own'),
  ('system:admin', 'exam:manage_own'),
  ('system:admin', 'class:create'),
  ('system:admin', 'platform:moderate'),
  ('system:admin', 'role:assign_system'),
  ('system:admin', 'role:manage'),
  ('system:admin', 'role:assign'),
  ('system:admin', 'role:override'),
  ('class:owner', 'role:assign'),
  ('class:owner', 'role:override'),
  ('class:owner', 'class:view'),
  ('class:owner', 'class:update'),
  ('class:owner', 'class:enrolment_manage'),
  ('class:owner', 'assignment:create'),
  ('class:owner', 'assignment:publish'),
  ('class:owner', 'assignment:grade'),
  ('class:owner', 'result:view_class'),
  ('class:teacher', 'role:assign'),
  ('class:teacher', 'class:view'),
  ('class:teacher', 'class:update'),
  ('class:teacher', 'class:enrolment_manage'),
  ('class:teacher', 'assignment:create'),
  ('class:teacher', 'assignment:publish'),
  ('class:teacher', 'assignment:grade'),
  ('class:teacher', 'result:view_class'),
  ('class:student', 'class:view'),
  ('class:student', 'assignment:view_assigned'),
  ('class:student', 'assignment:attempt'),
  ('class:student', 'result:view_own')
) AS seed("role_key", "capability_key")
JOIN "authz_roles" r ON r."key" = seed."role_key"
JOIN "authz_capabilities" c ON c."key" = seed."capability_key"
ON CONFLICT ("role_id", "capability_id") DO NOTHING;
