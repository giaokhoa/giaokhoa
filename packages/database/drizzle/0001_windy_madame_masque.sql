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
ALTER TABLE "authz_contexts" ADD CONSTRAINT "authz_contexts_parent_id_authz_contexts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_context_id_authz_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."authz_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignments" ADD CONSTRAINT "authz_role_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_permissions" ADD CONSTRAINT "authz_role_permissions_role_id_authz_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_permissions" ADD CONSTRAINT "authz_role_permissions_capability_id_authz_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."authz_capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authz_contexts_parent_idx" ON "authz_contexts" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authz_role_assignments_active_unique" ON "authz_role_assignments" USING btree ("user_id","role_id","context_id") WHERE "authz_role_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "authz_role_assignments_context_idx" ON "authz_role_assignments" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "authz_role_assignments_user_idx" ON "authz_role_assignments" USING btree ("user_id");

-- Seed RBAC Phase 1. Không cấp mặc định class:manage_any hoặc class:grant_teacher.
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
INSERT INTO "authz_capabilities" ("key", "context_kind", "description") VALUES
  ('resource:view_public', 'system', 'resource:view_public'),
  ('practice:attempt_public', 'system', 'practice:attempt_public'),
  ('class:join', 'system', 'class:join'),
  ('question:create_own', 'system', 'question:create_own'),
  ('question:manage_own', 'system', 'question:manage_own'),
  ('exam:create_own', 'system', 'exam:create_own'),
  ('exam:manage_own', 'system', 'exam:manage_own'),
  ('class:create', 'system', 'class:create'),
  ('platform:moderate', 'system', 'platform:moderate'),
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
  ('class:owner', 'class:view'),
  ('class:owner', 'class:update'),
  ('class:owner', 'class:enrolment_manage'),
  ('class:owner', 'assignment:create'),
  ('class:owner', 'assignment:publish'),
  ('class:owner', 'assignment:grade'),
  ('class:owner', 'result:view_class'),
  ('class:teacher', 'class:view'),
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
