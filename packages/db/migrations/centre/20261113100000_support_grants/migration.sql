-- Quyền hỗ trợ gắn đúng một tenant; nhân sự platform được tham chiếu
-- bằng UUID, không tạo tài khoản platform trong kho trung tâm.
CREATE TABLE "support_grants" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "recipient_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "scopes" text[] NOT NULL,
  "reason" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "support_grants_scopes_valid" CHECK (
    cardinality("scopes") BETWEEN 1 AND 2
    AND "scopes" <@ ARRAY['classes:read', 'courses:read']::text[]
    AND (cardinality("scopes") = 1 OR "scopes"[1] <> "scopes"[2])
  ),
  CONSTRAINT "support_grants_expiry_valid" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "support_grants_recipient_active_idx"
  ON "support_grants" ("tenant_id", "recipient_id", "expires_at" DESC)
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "support_access_events" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "grant_id" uuid REFERENCES "support_grants"("id") ON DELETE RESTRICT,
  "actor_id" uuid NOT NULL,
  "action" text NOT NULL,
  "scope" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "support_access_events_action_valid" CHECK ("action" IN
    ('grant_created', 'grant_revoked', 'access_allowed', 'access_denied')),
  CONSTRAINT "support_access_events_scope_valid" CHECK (
    "scope" IS NULL OR "scope" IN ('classes:read', 'courses:read'))
);
--> statement-breakpoint
CREATE INDEX "support_access_events_tenant_time_idx"
  ON "support_access_events" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- FK grant_id cũng cần index đứng đầu như mọi FK một cột khác.
CREATE INDEX "support_access_events_grant_idx"
  ON "support_access_events" ("grant_id");
--> statement-breakpoint
-- Mọi truy vấn hỗ trợ chạy với app.tenant_id thực của trung tâm;
-- không có tenant thì cơ sở dữ liệu từ chối theo RLS fail-closed.
ALTER TABLE "support_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_grants"
  USING (current_setting('app.platform', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.platform', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "support_access_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_access_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_access_events"
  USING (current_setting('app.platform', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.platform', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
