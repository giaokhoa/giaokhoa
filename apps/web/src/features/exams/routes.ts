import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('exams/new', 'routes/exam-paper-new.tsx'),
  route('exams/:paperId/edit', 'routes/exam-paper-edit.tsx'),
  route('exam-papers', 'routes/legacy-exam-papers.tsx'),
  route('exam-papers/new', 'routes/legacy-exam-paper-new.tsx'),
  route('exam-papers/:paperId/edit', 'routes/legacy-exam-paper-edit.tsx'),
] satisfies RouteConfig;
