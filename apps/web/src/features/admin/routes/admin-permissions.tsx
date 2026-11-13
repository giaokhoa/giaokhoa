import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAP } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageShell } from '#components/page-shell';
import '#config/i18n';
import { useAccessCapabilities, useAccessContexts } from '#lib/access';
import { contextOptionLabel } from '../api/context-labels';
import { AdminSelect } from '../components/admin-select';
import { PermissionsMatrix } from '../components/permissions-matrix';
import { useCapabilityMatrix, useSetCapabilityOverride } from '../queries/admin-roles';
import { groupCapabilitiesByResource } from '../types/admin-roles';

export function AdminPermissionsPage() {
  const { t } = useTranslation('app');
  const [contextOverride, setContextOverride] = useState('');
  const [edits, setEdits] = useState<
    Record<string, Record<string, { permission: number; contextId: string }>>
  >({});
  const [savingCells, setSavingCells] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  const capabilitiesQuery = useAccessCapabilities();
  const contextsQuery = useAccessContexts();
  const contexts = contextsQuery.data ?? [];
  const systemContextId =
    contexts.find((ctx) => ctx.contextLevel === 10)?.id ?? contexts[0]?.id ?? '';
  const contextId = contextOverride || systemContextId;
  const contextIdRef = useRef(contextId);
  useEffect(() => {
    contextIdRef.current = contextId;
  }, [contextId]);
  const matrixQuery = useCapabilityMatrix(contextId);
  const setOverrideMutation = useSetCapabilityOverride();

  const matrix = matrixQuery.data;
  const groups = useMemo(
    () => groupCapabilitiesByResource(capabilitiesQuery.data ?? []),
    [capabilitiesQuery.data],
  );
  const savedValues = useMemo(() => {
    const map = new Map<string, number>();
    for (const role of matrix?.roles ?? []) {
      for (const override of role.overrides) {
        map.set(`${role.id}:${override.capability}`, override.permission);
      }
    }
    return map;
  }, [matrix]);
  const valueOf = useCallback(
    (roleId: string, capability: string) =>
      edits[roleId]?.[capability]?.permission ??
      savedValues.get(`${roleId}:${capability}`) ??
      CAP.INHERIT,
    [edits, savedValues],
  );
  const allowCount = useMemo(() => {
    if (!matrix) return 0;
    let count = 0;
    for (const role of matrix.roles) {
      for (const group of groups) {
        for (const capability of group.capabilities) {
          if (valueOf(role.id, capability.name) === CAP.ALLOW) count += 1;
        }
      }
    }
    return count;
  }, [matrix, groups, valueOf]);

  const contextsEmpty = contextsQuery.isSuccess && contexts.length === 0;
  const loadFailed =
    capabilitiesQuery.isError || contextsQuery.isError || matrixQuery.isError || contextsEmpty;
  const loading =
    !loadFailed &&
    (capabilitiesQuery.isPending || contextsQuery.isPending || matrixQuery.isPending);
  const matrixReady = !loadFailed && !loading && matrix !== undefined;

  function dropEditFor(roleId: string, capability: string, permission: number, editContextId: string) {
    return (prev: Record<string, Record<string, { permission: number; contextId: string }>>) => {
      const roleEdits = prev[roleId];
      const edit = roleEdits?.[capability];
      if (!edit || edit.permission !== permission || edit.contextId !== editContextId) return prev;
      const next = { ...prev };
      const nextRole = { ...roleEdits };
      delete nextRole[capability];
      if (Object.keys(nextRole).length === 0) delete next[roleId];
      else next[roleId] = nextRole;
      return next;
    };
  }

  const handleCellChange = (roleId: string, capability: string, permission: number) => {
    const key = `${contextId}:${roleId}:${capability}`;
    setEdits((prev) => ({
      ...prev,
      [roleId]: { ...prev[roleId], [capability]: { permission, contextId } },
    }));
    setSavingCells((prev) => new Set(prev).add(key));
    setSaveError(null);
    void setOverrideMutation
      .mutateAsync({ roleId, capability, contextId, permission })
      .then(
        () => {
          setSavingCells((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          setEdits(dropEditFor(roleId, capability, permission, contextId));
        },
        () => {
          setSavingCells((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          setEdits(dropEditFor(roleId, capability, permission, contextId));
          if (contextIdRef.current === contextId) {
            setSaveError(t('permissionsSaveFailed'));
          }
        },
      );
  };

  return (
    <PageShell width="app" contentClassName="gap-3 md:gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">{t('navPermissions')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('permissionsDescription')}</p>
      </div>
      {loadFailed ? (
        <>
          <ErrorAlert variant="destructive">{t('permissionsLoadFailed')}</ErrorAlert>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void capabilitiesQuery.refetch();
                void contextsQuery.refetch();
                void matrixQuery.refetch();
              }}
            >
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      {loading ? (
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-9 w-full']} />
      ) : null}
      {matrixReady && matrix ? (
        <>
          <div className="max-w-xs">
            <Field>
              <FieldLabel htmlFor="permissions-context">{t('roleContext')}</FieldLabel>
              <AdminSelect
                id="permissions-context"
                value={contextId}
                onValueChange={(next) => {
                  setContextOverride(next);
                  setEdits({});
                  setSaveError(null);
                }}
                disabled={contexts.length === 0}
                options={contexts.map((ctx) => ({
                  value: ctx.id,
                  label: contextOptionLabel(contexts, ctx, (key, options) => t(key, options)),
                }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-6">
            <Card>
              <CardContent className="flex flex-col gap-1">
                <span className="text-2xl font-semibold">{matrix.roles.length}</span>
                <span className="text-sm text-muted-foreground">{t('permissionsRoleCount')}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1">
                <span className="text-2xl font-semibold">{groups.length}</span>
                <span className="text-sm text-muted-foreground">{t('permissionsResourceCount')}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1">
                <span className="text-2xl font-semibold">{allowCount}</span>
                <span className="text-sm text-muted-foreground">{t('permissionsAllowCount')}</span>
              </CardContent>
            </Card>
          </div>
          {saveError ? <ErrorAlert variant="destructive">{saveError}</ErrorAlert> : null}
          <Card className="gap-0 p-0 shadow-none">
            <CardContent className="p-0">
              <PermissionsMatrix
                contextId={contextId}
                groups={groups}
                matrix={matrix}
                valueOf={valueOf}
                savingCells={savingCells}
                onCellChange={handleCellChange}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}

export default AdminPermissionsPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navPermissions');
}
