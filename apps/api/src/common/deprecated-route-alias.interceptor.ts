import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';


const SUNSET_HEADER_VALUE = 'Sun, 01 Feb 2027 00:00:00 GMT';

interface DeprecatedRouteAliasEntry {
  pattern: RegExp;
  alias: string;
  canonical: string;
}

const actionRenameAliasTable: DeprecatedRouteAliasEntry[] = [
  { pattern: /^\/api\/v1\/courses\/[^/]+\/sections\/[^/]+\/duplicate$/, alias: 'courses/:id/sections/:sectionId/duplicate', canonical: 'courses/:id/sections/:sectionId/copy' },
  { pattern: /^\/api\/v1\/courses\/[^/]+\/modules\/[^/]+\/duplicate$/, alias: 'courses/:id/modules/:cmId/duplicate', canonical: 'courses/:id/modules/:cmId/copy' },
  { pattern: /^\/api\/v1\/courses\/[^/]+\/progress\/report\.csv$/, alias: 'courses/:courseId/progress/report.csv', canonical: 'courses/:courseId/progress/reports?format=csv' },
  { pattern: /^\/api\/v1\/courses\/[^/]+\/duplicate$/, alias: 'courses/:id/duplicate', canonical: 'courses/:id/copy' },
  { pattern: /^\/api\/v1\/competencies\/frameworks\/[^/]+\/duplicate$/, alias: 'competencies/frameworks/:id/duplicate', canonical: 'competencies/frameworks/:id/copy' },
  { pattern: /^\/api\/v1\/badges\/[^/]+\/duplicate$/, alias: 'badges/:id/duplicate', canonical: 'badges/:id/copy' },
  { pattern: /^\/api\/v1\/users\/[^/]+\/unsuspend$/, alias: 'users/:id/unsuspend', canonical: 'users/:id/reactivate' },
  { pattern: /^\/api\/v1\/calendar\/export\.ics$/, alias: 'calendar/export.ics', canonical: 'calendar/exports?format=ics' },
  { pattern: /^\/api\/v1\/exams\/banks\/[^/]+\/contributions\/[^/]+\/board-approve$/, alias: 'exams/banks/:bankId/contributions/:contributionId/board-approve', canonical: 'exams/banks/:bankId/contributions/:contributionId/approve' },
  { pattern: /^\/api\/v1\/exams\/banks\/[^/]+\/contributions\/[^/]+\/board-reject$/, alias: 'exams/banks/:bankId/contributions/:contributionId/board-reject', canonical: 'exams/banks/:bankId/contributions/:contributionId/reject' },
  { pattern: /^\/api\/v1\/exams\/dossiers\/[^/]+\/board-approve$/, alias: 'exams/dossiers/:dossierId/board-approve', canonical: 'exams/dossiers/:dossierId/approve' },
  { pattern: /^\/api\/v1\/exams\/dossiers\/[^/]+\/board-reject$/, alias: 'exams/dossiers/:dossierId/board-reject', canonical: 'exams/dossiers/:dossierId/reject' },
  { pattern: /^\/api\/v1\/guardian\/students\/[^/]+\/courses\/[^/]+\/gradebook$/, alias: 'guardian/students/:studentId/courses/:courseId/gradebook', canonical: 'guardian/students/:studentId/gradebooks/:courseId' },
];

const gradePathsAliasTable: DeprecatedRouteAliasEntry[] = [
  { pattern: /^\/api\/v1\/courses\/[^/]+\/grades\/export\/vnedu$/, alias: 'courses/:courseId/grades/export/vnedu', canonical: 'courses/:courseId/grade-exports' },
  { pattern: /^\/api\/v1\/courses\/[^/]+\/grades\/items$/, alias: 'courses/:courseId/grades/items', canonical: 'courses/:courseId/grade-items' },
  { pattern: /^\/api\/v1\/courses\/[^/]+\/grades\/report$/, alias: 'courses/:courseId/grades/report', canonical: 'courses/:courseId/gradebook/report' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+\/users\/[^/]+\/history$/, alias: 'courses/grades/items/:itemId/users/:userId/history', canonical: 'grade-items/:itemId/users/:userId/history' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+\/grades$/, alias: 'courses/grades/items/:itemId/grades', canonical: 'grade-items/:itemId/grades' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+\/posting-policy$/, alias: 'courses/grades/items/:itemId/posting-policy', canonical: 'grade-items/:itemId/posting-policy' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+\/publish$/, alias: 'courses/grades/items/:itemId/publish', canonical: 'grade-items/:itemId/publish' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+\/unpublish$/, alias: 'courses/grades/items/:itemId/unpublish', canonical: 'grade-items/:itemId/unpublish' },
  { pattern: /^\/api\/v1\/courses\/grades\/items\/[^/]+$/, alias: 'courses/grades/items/:itemId', canonical: 'grade-items/:itemId' },
  { pattern: /^\/api\/v1\/courses\/grades\/grades\/[^/]+$/, alias: 'courses/grades/grades/:gradeId', canonical: 'grades/:gradeId' },
];

const examPapersSuffixTable: string[] = [
  'banks/:bankId/contributions/:contributionId/board-approve',
  'banks/:bankId/contributions/:contributionId/board-reject',
  'banks/:bankId/contributions/:contributionId/approve',
  'banks/:bankId/contributions/:contributionId/reject',
  'banks/:bankId/contributions',
  'banks/:bankId/dossiers',
  'banks/:bankId/exams',
  'dossiers/mine',
  'dossiers/:dossierId/specification/export',
  'dossiers/:dossierId/specification',
  'dossiers/:dossierId/board-approve',
  'dossiers/:dossierId/board-reject',
  'dossiers/:dossierId/approve',
  'dossiers/:dossierId/reject',
  'dossiers/:dossierId/submit',
  'dossiers/:dossierId',
  ':id/specification/export',
  ':id/specification',
  ':id/dossiers',
  ':id/status',
  ':id/withdraw',
  ':id/restore',
  ':id/copy',
  ':id/swap',
  ':id/pins',
  ':id/print',
  ':id/slots',
  ':id',
];

const examPapersCanonicalOverride: Record<string, string> = {
  'banks/:bankId/contributions/:contributionId/board-approve': 'banks/:bankId/contributions/:contributionId/approve',
  'banks/:bankId/contributions/:contributionId/board-reject': 'banks/:bankId/contributions/:contributionId/reject',
  'dossiers/:dossierId/board-approve': 'dossiers/:dossierId/approve',
  'dossiers/:dossierId/board-reject': 'dossiers/:dossierId/reject',
};

function buildSuffixAliasTable(
  aliasPrefix: string,
  canonicalPrefix: string,
  suffixes: string[],
  canonicalOverrides: Record<string, string>,
): DeprecatedRouteAliasEntry[] {
  return suffixes.map((suffix) => {
    const alias = `${aliasPrefix}/${suffix}`;
    const body = alias
      .split('/')
      .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    return {
      pattern: new RegExp(`^/api/v1/${body}$`),
      alias,
      canonical: `${canonicalPrefix}/${canonicalOverrides[suffix] ?? suffix}`,
    };
  });
}

const examPapersAliasTable: DeprecatedRouteAliasEntry[] = buildSuffixAliasTable(
  'exam-papers',
  'exams',
  examPapersSuffixTable,
  examPapersCanonicalOverride,
);

const messagingAliasTable: DeprecatedRouteAliasEntry[] = [
  {
    pattern: /^\/api\/v1\/messages\/messages\/bulk-remove$/,
    alias: 'messages/messages/bulk-remove',
    canonical: 'messages/bulk-remove',
  },
  {
    pattern: /^\/api\/v1\/messages\/messages\/[^/]+\/recall$/,
    alias: 'messages/messages/:id/recall',
    canonical: 'messages/:id/recall',
  },
  {
    pattern: /^\/api\/v1\/messages\/messages\/[^/]+\/hard-delete$/,
    alias: 'messages/messages/:id/hard-delete',
    canonical: 'messages/:id/hard-delete',
  },
  {
    pattern: /^\/api\/v1\/messages\/messages\/[^/]+$/,
    alias: 'messages/messages/:id',
    canonical: 'messages/:id',
  },
  {
    pattern: /^\/api\/v1\/notifications\/read-all$/,
    alias: 'notifications/read-all',
    canonical: 'notifications/mark-read',
  },
];

@Injectable()
export class DeprecatedRouteAliasInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeprecatedRouteAliasInterceptor.name);

  private static readonly aliasTable: DeprecatedRouteAliasEntry[] = [
    ...actionRenameAliasTable,
    ...gradePathsAliasTable,
    ...examPapersAliasTable,
    ...messagingAliasTable,
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ url?: string; method?: string }>();
    const url = req?.url ?? '';
    const path = url.split('?')[0] ?? url;
    const match = DeprecatedRouteAliasInterceptor.aliasTable.find((entry) => entry.pattern.test(path));
    if (match) {
      const res = http.getResponse<{ setHeader?: (name: string, value: string) => void }>();
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', SUNSET_HEADER_VALUE);
      }
      this.logger.warn(JSON.stringify({
        event: 'deprecated_route_alias',
        method: req?.method,
        alias: match.alias,
        canonical: match.canonical,
        path,
      }));
    }
    return next.handle();
  }
}
