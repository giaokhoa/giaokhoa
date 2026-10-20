CREATE TABLE "exam_revision_questions" (
	"exam_revision_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"question_snapshot" jsonb NOT NULL,
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
ALTER TABLE "exam_revision_questions" ADD CONSTRAINT "exam_revision_questions_exam_revision_id_exam_revisions_id_fk" FOREIGN KEY ("exam_revision_id") REFERENCES "public"."exam_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_revision_questions" ADD CONSTRAINT "exam_revision_questions_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_revisions" ADD CONSTRAINT "exam_revisions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_revision_questions_version_idx" ON "exam_revision_questions" USING btree ("question_version_id");--> statement-breakpoint
CREATE INDEX "exam_revisions_exam_idx" ON "exam_revisions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exams_created_by_idx" ON "exams" USING btree ("created_by_user_id");