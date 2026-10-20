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
ALTER TABLE "attempt_responses" ADD CONSTRAINT "attempt_responses_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_recipient_fk" FOREIGN KEY ("assignment_id","user_id") REFERENCES "public"."assignment_recipients"("assignment_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_assignment_idx" ON "attempts" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id");