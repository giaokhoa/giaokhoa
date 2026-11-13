import { describe, expect, it } from 'vitest';
import { loader as legacyQuizLoader } from './legacy-quiz';
import { loader as legacyQuizResultsLoader } from './legacy-quiz-results';
import { loader as legacyQuizPaperLoader } from './legacy-quiz-paper';

const CASES = [
  { path: '/courses/abc/quizzes/pin-1', target: '/courses/abc/exams/pin-1', loader: legacyQuizLoader },
  { path: '/courses/abc/quizzes/pin-1/results', target: '/courses/abc/exams/pin-1/results', loader: legacyQuizResultsLoader },
  { path: '/courses/abc/quizzes/pin-1/paper', target: '/courses/abc/exams/pin-1/paper', loader: legacyQuizPaperLoader },
] as const;

describe('Lớp tương thích URL quiz cũ — chuyển hướng HTTP từ loader', () => {
  for (const { path, target, loader } of CASES) {
    it(`GET ${path} giữ query khi chuyển sang URL Đề mới`, () => {
      const request = new Request(`https://giaokhoa.example${path}?tab=mine&from=bookmark`);
      const response = (loader as (args: { request: Request }) => Response)({ request });
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`${target}?tab=mine&from=bookmark`);
      expect(response.headers.get('X-Remix-Replace')).toBe('true');
    });
  }
});
