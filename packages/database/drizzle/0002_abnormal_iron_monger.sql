ALTER TABLE "stimuli" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stimuli" ADD CONSTRAINT "stimuli_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Chỉ nhận owner cho Stimulus cũ khi mọi câu hỏi tham chiếu đều cùng tác giả.
-- Stimulus mồ côi hoặc nhiều tác giả giữ NULL để chặn truy cập riêng theo ID.
UPDATE "stimuli" AS s
SET "created_by_user_id" = owners."user_id"
FROM (
  SELECT "stimulus_id", MIN("created_by_user_id"::text)::uuid AS "user_id"
  FROM "question"
  WHERE "stimulus_id" IS NOT NULL
  GROUP BY "stimulus_id"
  HAVING COUNT(DISTINCT "created_by_user_id") = 1
) AS owners
WHERE s."id" = owners."stimulus_id"
  AND s."created_by_user_id" IS NULL;
