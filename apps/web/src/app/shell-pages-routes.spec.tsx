import { describe, expect, it } from 'vitest';
import { RouteErrorBoundary } from '#components/route-error-boundary';
import i18n from '#config/i18n';
import * as classDetailRoute from '#features/classes/routes/class-detail';
import * as classEditRoute from '#features/classes/routes/class-edit';
import * as classJoinRoute from '#features/classes/routes/class-join';
import * as classNewRoute from '#features/classes/routes/class-new';
import * as classPublicRoute from '#features/classes/routes/class-public';
import * as classesRoute from '#features/classes/routes/classes';
import * as gradesRoute from '#features/grades/routes/grades';
import * as guardianRoute from '#features/guardians/routes/guardian';
import * as quizPaperRoute from '#features/quizzes/routes/quiz-paper';
import * as teacherCurriculumRoute from '#features/curriculum/routes/teacher-curriculum';

const CASES = [
  { name: 'classes', route: classesRoute, ns: 'app', key: 'classesHeading' },
  { name: 'class-new', route: classNewRoute, ns: 'app', key: 'classCreateTitle' },
  { name: 'class-join', route: classJoinRoute, ns: 'app', key: 'classJoinTitle' },
  { name: 'class-detail', route: classDetailRoute, ns: 'app', key: 'classesHeading' },
  { name: 'class-edit', route: classEditRoute, ns: 'app', key: 'classEditTitle' },
  { name: 'class-public', route: classPublicRoute, ns: 'app', key: 'classPublicTitle' },
  { name: 'grades', route: gradesRoute, ns: 'app', key: 'gradebook' },
  { name: 'guardian', route: guardianRoute, ns: 'guardian', key: 'title' },
  { name: 'quiz-paper', route: quizPaperRoute, ns: 'app', key: 'paperTitle' },
  { name: 'teacher-curriculum', route: teacherCurriculumRoute, ns: 'app', key: 'teacherProgrammeTitle' },
] as const;

describe('F-07/F-08 (#133): 10 page module trong shell — ErrorBoundary dùng chung + meta() theo trang', () => {
  for (const { name, route, ns, key } of CASES) {
    it(`trang ${name} export RouteErrorBoundary dùng chung làm ErrorBoundary`, () => {
      expect(route.ErrorBoundary).toBe(RouteErrorBoundary);
    });

    it(`trang ${name} meta() trả tiêu đề dựng từ khoá ${ns} riêng ${key}`, () => {
      const expectedTitle = i18n.t(key, { ns });
      expect(expectedTitle).not.toBe(key);
      const actual = name === 'class-public'
        ? classPublicRoute.meta({ loaderData: { classPublic: null } } as Parameters<typeof classPublicRoute.meta>[0])
        : route.meta();
      expect(actual).toEqual([{ title: `${expectedTitle} · Giáo khoa` }]);
    });
  }
});
