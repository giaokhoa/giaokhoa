import type { EnrolDatabase } from './types';


export async function hasCourseCompletionData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  const cms = await db
    .selectFrom('course_modules')
    .select('course_modules.id')
    .where((eb) => eb.and([
      eb('course_modules.course', '=', courseId),
      eb('course_modules.deletion_in_progress', '=', false),
    ]))
    .execute();
  if (!cms.length) return false;
  const rows = await db
    .selectFrom('course_modules_completion')
    .select('course_modules_completion.id')
    .where((eb) => eb.and([
      eb('course_modules_completion.user_id', '=', userId),
      eb('course_modules_completion.course_module_id', 'in', cms.map((c) => c.id)),
    ]))
    .execute();
  return rows.length > 0;
}

export async function hasCourseGradeData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  const items = await db
    .selectFrom('grade_items')
    .select('grade_items.id')
    .where('grade_items.course_id', '=', courseId)
    .execute();
  if (!items.length) return false;
  const rows = await db
    .selectFrom('grade_grades')
    .select('grade_grades.id')
    .where((eb) => eb.and([
      eb('grade_grades.user_id', '=', userId),
      eb('grade_grades.item_id', 'in', items.map((i) => i.id)),
    ]))
    .execute();
  return rows.length > 0;
}

export async function hasRelatedCourseData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  if (await hasCourseCompletionData(db, courseId, userId)) return true;
  return hasCourseGradeData(db, courseId, userId);
}
