import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import '#config/i18n';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { PageHeader, PageShell } from '#components/page-shell';
import { useQueryClient } from '@tanstack/react-query';
import { systemCapabilities, usePermissions } from '#lib/permissions';
import { globalSearchQueryOptions } from '../queries/search';
import { globalSearchTarget, type GlobalSearchDoc } from '#lib/search-target';

const AREA_LABEL_KEYS: Record<string, string> = {
  courses: 'searchAreaCourses',
  users: 'searchAreaUsers',
  contentbank: 'searchAreaContentBank',
};

export function SearchPage() {
  const { t: t } = useTranslation();
  const queryClient = useQueryClient();
  const perms = usePermissions();
  const canManageUsers =
    (perms.access?.isSiteAdmin ?? false) ||
    (perms.access ? systemCapabilities(perms.access).includes('user:update') : false);
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GlobalSearchDoc[]>([]);
  const [searched, setSearched] = useState(false);
  const latestSearchRef = useRef(0);

  const runSearch = useCallback(async (keyword: string) => {
    const runId = ++latestSearchRef.current;
    const docs = await queryClient.fetchQuery(globalSearchQueryOptions(keyword));
    if (runId !== latestSearchRef.current) return;
    setResults(docs);
    setSearched(true);
  }, [queryClient]);

  const [previousUrlQ, setPreviousUrlQ] = useState<string | null>(null);
  if (previousUrlQ !== urlQ) {
    setPreviousUrlQ(urlQ);
    if (urlQ !== null) setQ(urlQ);
    if (urlQ !== null && !urlQ.trim()) {
      setResults([]);
      setSearched(false);
    }
  }
  useEffect(() => {
    if (urlQ === null) return;
    const runId = ++latestSearchRef.current;
    if (!urlQ.trim()) return;
    void queryClient.fetchQuery(globalSearchQueryOptions(urlQ)).then((docs) => {
      if (runId !== latestSearchRef.current) return;
      setResults(docs);
      setSearched(true);
    });
  }, [urlQ, queryClient]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runSearch(q);
  }
  return (
    <PageShell width="narrow">
      <PageHeader title={t('searchTitle')} />
      <Card>
        <CardContent className="space-y-3">
          <form onSubmit={(e) => void submit(e)} className="flex gap-2">
            <Label htmlFor="search-q" className="sr-only">
              {t('searchQuery')}
            </Label>
            <Input
              id="search-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
            <Button type="submit">{t('searchButton')}</Button>
          </form>
          <ul aria-label={t('searchResults')} className="space-y-2">
            {results.map((d) => {
              const target = globalSearchTarget(d, { canManageUsers });
              const body = (
                <>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {AREA_LABEL_KEYS[d.area] ? t(AREA_LABEL_KEYS[d.area]) : d.area}
                  </p>
                  <p className="text-sm">{d.content}</p>
                </>
              );
              return (
                <li key={d.id}>
                  {target ? (
                    <Link to={target} className="block rounded border p-2 hover:bg-accent" data-testid={`search-result-${d.id}`}>
                      {body}
                    </Link>
                  ) : (
                    <div className="rounded border p-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {searched && results.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('noResults')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export { SearchPage as default };

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { platformKeyMeta } from '#lib/route-meta';
export function meta() {
  return platformKeyMeta('searchTitle');
}
