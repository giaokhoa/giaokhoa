import { describe, expect, it } from 'vitest';
import { TeacherCurriculumPage } from './teacher-curriculum';
import * as teacherCurriculumRoute from './teacher-curriculum';

describe('Route /curriculum — route module nối đúng component trang', () => {
  it('export mặc định của route module là đúng component TeacherCurriculumPage', () => {
    expect(teacherCurriculumRoute.default).toBe(TeacherCurriculumPage);
  });
});
