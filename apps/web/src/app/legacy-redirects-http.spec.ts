import { describe, expect, it } from 'vitest';
import { loader as legacyExamPapers } from '#features/exams/routes/legacy-exam-papers';
import { loader as legacyExamPaperNew } from '#features/exams/routes/legacy-exam-paper-new';
import { loader as legacyExamPaperEdit } from '#features/exams/routes/legacy-exam-paper-edit';
import { loader as legacyMatrixNew } from '#features/matrices/routes/legacy-matrix-new';
import { loader as legacyMatrixEdit } from '#features/matrices/routes/legacy-matrix-edit';
import { loader as systemBank } from '#features/questions/routes/system-bank';
import { loader as legacySystemBankPapers } from '#features/questions/routes/legacy-system-bank-papers';
import { loader as legacyContentBank } from '#features/content-bank/routes/legacy-contentbank';
import { loader as legacyContentBankNew } from '#features/content-bank/routes/legacy-contentbank-new';
import { loader as legacyContentBankEdit } from '#features/content-bank/routes/legacy-contentbank-edit';

const CASES = [
  { path: '/exam-papers?bank=my', to: '/exams?bank=my', loader: legacyExamPapers },
  { path: '/exam-papers/new?bank=system', to: '/exams/new?bank=system', loader: legacyExamPaperNew },
  { path: '/exam-papers/paper-1/edit?draft=1', to: '/exams/paper-1/edit?draft=1', loader: legacyExamPaperEdit, params: { paperId: 'paper-1' } },
  { path: '/questions/matrices/new?draft=1', to: '/matrices/new', loader: legacyMatrixNew },
  { path: '/questions/matrices/m-1/edit?draft=1', to: '/matrices/m-1/edit', loader: legacyMatrixEdit, params: { matrixId: 'm-1' } },
  { path: '/system-bank?unused=1', to: '/system-bank/questions', loader: systemBank },
  { path: '/system-bank/papers?unused=1', to: '/system-bank/exams', loader: legacySystemBankPapers },
  { path: '/contentbank?reviewStatus=pending', to: '/content-bank?reviewStatus=pending', loader: legacyContentBank },
  { path: '/contentbank/new?space=own', to: '/content-bank/new?space=own', loader: legacyContentBankNew },
  { path: '/contentbank/item-1/edit?source=old', to: '/content-bank/item-1/edit?source=old', loader: legacyContentBankEdit, params: { id: 'item-1' } },
] as const;

describe('URL legacy tĩnh trả HTTP redirect từ loader', () => {
  for (const { path, to, loader, ...rest } of CASES) {
    it(`truy cập ${path} nhận 302 tới ${to}`, () => {
      const request = new Request(`https://giaokhoa.example${path}`);
      const args = { request, params: 'params' in rest ? rest.params : {} };
      const response = (loader as (args: { request: Request; params: Record<string, string> }) => Response)(args);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(to);
      expect(response.headers.get('X-Remix-Replace')).toBe('true');
    });
  }
});
