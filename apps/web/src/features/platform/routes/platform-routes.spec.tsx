import { describe, expect, it } from 'vitest';
import { RouteErrorBoundary } from '#components/route-error-boundary';
import i18n from '#config/i18n';
import * as backupRoute from './platform-backup';
import * as insightsRoute from './platform-insights';
import * as privacyRoute from './platform-privacy';
import * as reportsRoute from './platform-reports';
import * as searchRoute from './platform-search';
import * as tokensRoute from './platform-tokens';

const CASES = [
  { name: 'search', route: searchRoute, key: 'searchTitle' },
  { name: 'tokens', route: tokensRoute, key: 'tokensTitle' },
  { name: 'backup', route: backupRoute, key: 'backupTitle' },
  { name: 'insights', route: insightsRoute, key: 'insightsTitle' },
  { name: 'reports', route: reportsRoute, key: 'reportsTitle' },
  { name: 'privacy', route: privacyRoute, key: 'privacyTitle' },
] as const;

describe('F-07/F-08 (#133): 6 route module platform thật — ErrorBoundary dùng chung + meta() theo trang', () => {
  for (const { name, route, key } of CASES) {
    it(`route ${name} export RouteErrorBoundary dùng chung làm ErrorBoundary`, () => {
      expect(route.ErrorBoundary).toBe(RouteErrorBoundary);
    });

    it(`route ${name} meta() trả tiêu đề dựng từ khoá platform riêng ${key}`, () => {
      const expectedTitle = i18n.t(key, { ns: 'platform' });
      expect(expectedTitle).not.toBe(key);
      expect(route.meta()).toEqual([{ title: `${expectedTitle} · Giáo khoa` }]);
    });
  }
});
