/**
 * Trang trạng thái hệ thống: loader phía server lấy GET /api/v1/health qua API nội bộ
 * để HTML đầu đã có kết quả, còn khi loader không với tới API thì trang rơi về fetch
 * phía client và chỉ fetch lại khi người dùng bấm kiểm tra lại. Hiển thị trạng thái,
 * kiểm tra database/Redis và mốc thời gian, với trạng thái đang tải và lỗi riêng.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoaderData } from 'react-router';
import '#config/i18n';
import type { HealthStatus } from '@giaokhoa/contracts';
import { healthStatusSchema } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { PageHeader, PageShell } from '#components/page-shell';
import { fetchApiJson } from '#lib/server-api';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; health: HealthStatus };

/**
 * Loader phía server (SSR, Giai đoạn 3 của issue #7): trạng thái hệ thống là dữ liệu công khai (endpoint @Public) nên lấy ngay trong loader qua API nội bộ — HTML trả về đã chứa kết quả kiểm tra thay vì khung giữ chỗ. API không với tới được → trả null, trang rơi về luồng fetch phía client như trước.
 */
export async function loader(): Promise<{ health: HealthStatus | null }> {
  const body = await fetchApiJson('/api/v1/health');
  const parsed = healthStatusSchema.safeParse(body);
  return { health: parsed.success ? parsed.data : null };
}

export function HealthPage({ initialHealth }: { initialHealth?: HealthStatus | null } = {}) {
  const { t } = useTranslation('app');
  const [state, setState] = useState<State>(() =>
    initialHealth ? { kind: 'ready', health: initialHealth } : { kind: 'loading' },
  );
  const [refreshing, setRefreshing] = useState(false);

  /** Một lượt fetch phía client: dùng cho luồng dự phòng khi loader
   * không có dữ liệu và cho nút kiểm tra lại thủ công (F-09). */
  const fetchHealthState = useCallback(async (): Promise<State> => {
    try {
      const res = await fetch('/api/v1/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Cùng luật với loader phía server: thân đáp ứng phải khớp schema
      // hợp đồng, không ép kiểu trực tiếp — dữ kiện lạ thì rơi về
      // trạng thái lỗi thay vì render dữ kiện sai hình.
      const parsed = healthStatusSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error(t('unknownError'));
      return { kind: 'ready', health: parsed.data };
    } catch (error: unknown) {
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : t('unknownError'),
      };
    }
  }, [t]);

  const loadHealth = useCallback(async (): Promise<void> => {
    setState(await fetchHealthState());
  }, [fetchHealthState]);

  useEffect(() => {
    // Loader đã cấp dữ liệu (SSR) thì KHÔNG fetch lại khi mount — request
    // trùng làm mất giá trị của loader (F-09 trong rà soát #133). Chỉ khi
    // loader không với tới được API (initialHealth null) mới rơi về luồng
    // fetch phía client như trước; sau đó trang chỉ fetch lại khi người
    // dùng bấm nút kiểm tra lại.
    if (initialHealth) return;
    let active = true;
    void fetchHealthState().then((next) => {
      if (active) setState(next);
    });
    return () => { active = false; };
  }, [initialHealth, fetchHealthState]);

  const reload = async () => {
    setRefreshing(true);
    try {
      await loadHealth();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageShell width="narrow">
      <PageHeader title={t('healthTitle')} description={t('healthDescription')} />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || state.kind === 'loading'}
          onClick={() => void reload()}
        >
          {t('checkApiHealth')}
        </Button>
      </div>
      <Card>
        <CardContent>
          {state.kind === 'loading' && (
            <PageSkeleton label={t('loading')} rows={['h-4 w-40', 'h-4 w-56', 'h-4 w-48']} />
          )}
          {state.kind === 'error' && (
            <ErrorAlert variant="destructive" title={t('healthTitle')}>
              {t('healthLoadFailed', { message: state.message })}
            </ErrorAlert>
          )}
          {state.kind === 'ready' && (
            <dl className="space-y-2">
              <div>
                <dt className="font-medium">{t('status')}</dt>
                <dd>{state.health.status}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('database')}</dt>
                <dd>{state.health.checks.database}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('redis')}</dt>
                <dd>{state.health.checks.redis}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('timestamp')}</dt>
                <dd>{state.health.timestamp}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

/**
 * Export mặc định cho route module React Router framework mode (xem
 * src/app/routes.ts): bọc mỏng đọc dữ liệu loader rồi truyền xuống
 * HealthPage thuần — test render trực tiếp HealthPage vẫn chạy như
 * trước.
 */
export default function HealthRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <HealthPage initialHealth={loaderData?.health ?? null} />;
}

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navHealth');
}
