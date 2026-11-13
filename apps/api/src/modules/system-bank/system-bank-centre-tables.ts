
export function buildCentreSatelliteEnsureStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS "outcome_package_installs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"package_version" text NOT NULL,
	"previous_version" text,
	"scope" text NOT NULL,
	"package_checksum" text NOT NULL DEFAULT '',
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" uuid
)`,
    `CREATE TABLE IF NOT EXISTS "system_bank_event_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"event_id" uuid NOT NULL,
	"centre_slug" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_bank_event_receipts_event_centre_unique" UNIQUE("event_id","centre_slug")
)`,
    `CREATE TABLE IF NOT EXISTS "system_question_imports" (
	"question_id" uuid PRIMARY KEY,
	"source_question_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"source_version_number" integer NOT NULL,
	"package_checksum" text NOT NULL,
	"imported_version_number" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" uuid,
	"kind" text DEFAULT 'pristine' NOT NULL,
	CONSTRAINT "system_question_imports_kind_check" CHECK ("kind" in ('pristine', 'derived'))
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "outcome_package_installs_package_version_unique" ON "outcome_package_installs" ("package_version")`,
    `CREATE INDEX IF NOT EXISTS "system_bank_event_receipts_centre_slug_idx" ON "system_bank_event_receipts" ("centre_slug")`,
    `CREATE INDEX IF NOT EXISTS "system_question_imports_source_question_id_idx" ON "system_question_imports" ("source_question_id")`,
    `DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_question_imports_question_id_question_id_fkey' AND conrelid = '"system_question_imports"'::regclass) THEN
		ALTER TABLE "system_question_imports" ADD CONSTRAINT "system_question_imports_question_id_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE;
	END IF;
END $$`,
    `ALTER TABLE "outcome_package_installs" ADD COLUMN IF NOT EXISTS "package_checksum" text NOT NULL DEFAULT ''`,
  ];
}
