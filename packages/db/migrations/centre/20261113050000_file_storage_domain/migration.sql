-- Miền của byte tệp sống độc lập với hash và hostname của trung tâm.
-- Bản ghi cũ mang miền legacy, không di trú byte/hash trong ticket này.
ALTER TABLE "files"
  ADD COLUMN "storage_domain" text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE "files"
  ADD CONSTRAINT "files_storage_domain_valid"
  CHECK ("storage_domain" IN ('legacy', 'bank-system') OR
         "storage_domain" ~ '^space-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
