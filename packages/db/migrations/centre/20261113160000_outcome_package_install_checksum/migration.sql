ALTER TABLE IF EXISTS "outcome_package_installs" ADD COLUMN IF NOT EXISTS "package_checksum" text NOT NULL DEFAULT '';
