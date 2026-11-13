import { type RouteConfig, relative } from '@react-router/dev/routes';

const { route } = relative(import.meta.dirname);

export default [
  route('courses/:id/exams/:pinId', 'routes/quiz.tsx'),
  route('courses/:id/exams/:pinId/results', 'routes/quiz-results.tsx'),
  route('courses/:id/exams/:pinId/paper', 'routes/quiz-paper.tsx'),
  route('courses/:id/quizzes/:quizId', 'routes/legacy-quiz.tsx'),
  route('courses/:id/quizzes/:quizId/results', 'routes/legacy-quiz-results.tsx'),
  route('courses/:id/quizzes/:quizId/paper', 'routes/legacy-quiz-paper.tsx'),
  route('quiz-attempts/:attemptId', 'routes/quiz-attempt.tsx'),
] satisfies RouteConfig;
