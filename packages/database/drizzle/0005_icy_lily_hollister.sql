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
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_exam_revision_id_exam_revisions_id_fk" FOREIGN KEY ("exam_revision_id") REFERENCES "public"."exam_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_recipients_user_idx" ON "assignment_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assignments_class_idx" ON "assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "assignments_exam_revision_idx" ON "assignments" USING btree ("exam_revision_id");