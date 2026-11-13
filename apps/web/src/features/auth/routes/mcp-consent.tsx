import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { apiFetch } from '#lib/api';

/**
 * Trang đồng ý (consent) cho luồng uỷ quyền MCP (lát MCP-1, issue #163) — `consentPage` của máy chủ OAuth Better Auth.
 *
 * AS chuyển trình duyệt tới đây kèm chuỗi query authorize ĐÃ KÝ. Trang hiển thị tên client (lấy từ `/oauth2/public-client` bằng chính phiên BA) + danh sách scope xin cấp dạng tích chọn. Scope `giaokhoa.questions.write` (phát hành câu hỏi) KHÔNG tích sẵn — giáo viên phải chủ động bật. Khi bấm đồng ý/từ chối, trang POST về `/oauth2/consent` kèm `oauth_query` nguyên văn và đi tiếp theo đúng `url` máy chủ trả về (không tự ghép redirect_uri — bài học CVE-2026-67337 ghi trong addendum của issue).
 */

/** Khoá i18n của nhãn + mức cảnh báo cho từng scope MCP — nhãn dịch lúc render để giao diện đổi ngôn ngữ theo `i18n.language`. */
const SCOPE_LABELS: Record<string, { key: string; sensitive?: boolean }> = {
  'giaokhoa.questions.read': { key: 'mcpScopeQuestionsRead' },
  'giaokhoa.questions.draft': { key: 'mcpScopeQuestionsDraft' },
  'giaokhoa.questions.write': {
    key: 'mcpScopeQuestionsWrite',
    sensitive: true,
  },
  'giaokhoa.banks.contribute': { key: 'mcpScopeBanksContribute' },
};

interface ConsentContext {
  clientId: string;
  clientName: string;
  scopes: string[];
  /** Chuỗi query authorize nguyên văn để gửi lại cho AS. */
  oauthQuery: string;
}

function readConsentContext(rawQuery: string): ConsentContext | null {
  const search = rawQuery.replace(/^\?/, '');
  const params = new URLSearchParams(search);
  // AS có thể gói chuỗi authorize vào một tham số oauth_query duy nhất, hoặc trải phẳng các tham số lên URL của trang này — đọc cả hai.
  const packed = params.get('oauth_query');
  const inner = packed ? new URLSearchParams(packed) : params;
  const clientId = inner.get('client_id') ?? params.get('client_id');
  if (!clientId) return null;
  const scopeParam = inner.get('scope') ?? params.get('scope') ?? '';
  return {
    clientId,
    clientName: clientId,
    scopes: scopeParam.split(' ').filter(Boolean),
    oauthQuery: packed ?? search,
  };
}

/**
 * React Router giữ nguyên route component khi query string đổi. Khóa form bằng query để mỗi yêu cầu OAuth có quyền chọn và oauth_query độc lập.
 */
export default function McpConsentPage() {
  const location = useLocation();
  return <McpConsentRequest key={location.search} rawQuery={location.search} />;
}

/** State và request bất đồng bộ của duy nhất một yêu cầu OAuth. */
function McpConsentRequest({ rawQuery }: { rawQuery: string }) {
  const { t } = useTranslation('app');
  const initialContext = useMemo(() => readConsentContext(rawQuery), [rawQuery]);
  const [context, setContext] = useState<ConsentContext | null>(initialContext);
  // Lỗi tải chỉ suy từ query ban đầu, không bao giờ thay đổi trong vòng đời của yêu cầu này nên giữ bằng const thường, không phải state.
  const loadError = initialContext ? null : t('mcpConsentInvalidLink');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(
    initialContext?.scopes.filter((scope) => scope !== 'giaokhoa.questions.write') ?? [],
  ));
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitControllerRef = useRef<AbortController | null>(null);

  // Khi URL đổi, form bị tháo và mọi submit cũ bị hủy; phản hồi ứng dụng A không được điều hướng trang của B.
  useEffect(() => () => {
    submitControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const parsed = initialContext;
    if (!parsed) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/v1/auth/oauth2/public-client?client_id=${encodeURIComponent(parsed.clientId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (res.status === 401) {
          // Chưa có phiên BA → quay về trang đăng nhập của đúng yêu cầu.
          window.location.assign(`/mcp-login${rawQuery}`);
          return;
        }
        const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
        if (controller.signal.aborted) return;
        if (res.ok && body && typeof body.name === 'string' && body.name.length > 0) {
          const clientName = body.name;
          setContext((current) => (
            current?.oauthQuery === parsed.oauthQuery ? { ...current, clientName } : current
          ));
        }
      } catch {
        // Không lấy được tên client thì hiển thị client_id — vẫn dùng được.
      }
    })();
    return () => controller.abort();
  }, [initialContext, rawQuery]);

  async function submit(accept: boolean) {
    if (!context) return;
    setBusy(true);
    setSubmitError(null);
    const controller = new AbortController();
    submitControllerRef.current = controller;
    try {
      const res = await apiFetch('/api/v1/auth/oauth2/consent', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          accept,
          ...(accept ? { scope: [...selected].join(' ') } : {}),
          oauth_query: context.oauthQuery,
        }),
      });
      const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
      if (controller.signal.aborted) return;
      if (res.ok && body && typeof body.url === 'string') {
        // Đi tiếp theo URL máy chủ trả — không tự ghép redirect.
        window.location.assign(body.url);
        return;
      }
      setSubmitError(t('mcpConsentRejected'));
      setBusy(false);
    } catch {
      if (controller.signal.aborted) return;
      setSubmitError(t('mcpServerUnreachable'));
      setBusy(false);
    } finally {
      if (submitControllerRef.current === controller) submitControllerRef.current = null;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('mcpConsentTitle')}</CardTitle>
          <CardDescription>
            {context
              ? t('mcpConsentDescription', { clientName: context.clientName })
              : t('mcpConsentLoading')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError ? (
            <ErrorAlert variant="destructive">
              {loadError}
            </ErrorAlert>
          ) : null}
          {context ? (
            <>
              <ul className="space-y-3">
                {context.scopes.map((scope) => {
                  const known = SCOPE_LABELS[scope];
                  return (
                    <li key={scope} className="flex items-start gap-3">
                      <input
                        id={`scope-${scope}`}
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={selected.has(scope)}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(scope);
                            else next.delete(scope);
                            return next;
                          });
                        }}
                      />
                      <label htmlFor={`scope-${scope}`} className="text-sm leading-snug">
                        {known ? t(known.key) : scope}
                        {known?.sensitive ? (
                          <span className="mt-1 block font-medium text-destructive">
                            {t('mcpScopeSensitiveNote')}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {submitError ? (
                <ErrorAlert variant="destructive">
                  {submitError}
                </ErrorAlert>
              ) : null}
              <div className="flex gap-3">
                <Button className="flex-1" disabled={busy || selected.size === 0} onClick={() => void submit(true)}>
                  {busy ? t('mcpConsentProcessing') : t('mcpConsentAccept')}
                </Button>
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void submit(false)}>
                  {t('mcpConsentDecline')}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
