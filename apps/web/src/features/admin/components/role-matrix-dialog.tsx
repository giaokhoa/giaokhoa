import { useMemo, useState } from 'react';
import { CAP, type Capability, type RoleListItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@giaokhoa/ui/components/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { ErrorAlert } from '#components/error-alert';
import type { ContextRow, RoleCapabilityRow } from '#lib/access';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { contextOptionLabel } from '../api/context-labels';
import { useCreateRole, useReplaceRoleCapabilities, useUpdateRole } from '../queries/admin-roles';
import { groupCapabilitiesByResource, verbOfCapability, type RoleMatrixDraft } from '../types/admin-roles';
import { AdminSelect } from './admin-select';
import { isLockedPermission, PermissionCheckboxCell } from './permission-cells';

export interface RoleMatrixDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  role: RoleListItem | null;
  capabilities: Capability[];
  matrixRows: RoleCapabilityRow[];
  matrixPending: boolean;
  matrixError: boolean;
  onMatrixRetry: () => void;
  contexts: ContextRow[];
  onClose: () => void;
}

export function RoleMatrixDialog({
  open,
  mode,
  role,
  capabilities,
  matrixRows,
  matrixPending,
  matrixError,
  onMatrixRetry,
  contexts,
  onClose,
}: RoleMatrixDialogProps) {
  const { t } = useTranslation('app');

  const [name, setName] = useState(role?.name ?? '');
  const [shortName, setShortName] = useState(role?.shortName ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [contextOverride, setContextOverride] = useState('');
  const [edits, setEdits] = useState<RoleMatrixDraft>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdRoleId, setCreatedRoleId] = useState<string | null>(null);

  const createMutation = useCreateRole();
  const updateMutation = useUpdateRole();
  const replaceMutation = useReplaceRoleCapabilities();
  const saving = createMutation.isPending || updateMutation.isPending || replaceMutation.isPending;

  const systemContextId = contexts.find((ctx) => ctx.contextLevel === 10)?.id ?? '';
  const contextId = contextOverride !== '' ? contextOverride : systemContextId;

  const savedByCapability = useMemo(() => {
    const saved: RoleMatrixDraft = {};
    for (const row of matrixRows) {
      if (row.contextId === contextId) saved[row.capability] = row.permission;
    }
    return saved;
  }, [matrixRows, contextId]);

  function valueOf(capabilityName: string): number {
    return edits[capabilityName] ?? savedByCapability[capabilityName] ?? CAP.INHERIT;
  }

  function renderCluster(cluster: Capability[]) {
    if (cluster.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {cluster.map((capability) => (
          <span key={capability.name} className="inline-flex items-center gap-1.5">
            <PermissionCheckboxCell
              ariaLabel={capability.name}
              value={valueOf(capability.name)}
              disabled={saving}
              onToggle={(allowed) =>
                setEdits((prev) => ({
                  ...prev,
                  [capability.name]: allowed ? CAP.ALLOW : CAP.INHERIT,
                }))
              }
            />
            <span className="text-sm">{verbOfCapability(capability.name)}</span>
          </span>
        ))}
      </span>
    );
  }

  if (!open) return null;

  const groups = groupCapabilitiesByResource(capabilities);

  function scopeState(scope: Capability[]): { checked: boolean; indeterminate: boolean } {
    const editable = scope.filter((capability) => !isLockedPermission(valueOf(capability.name)));
    const allowed = editable.filter((capability) => valueOf(capability.name) === CAP.ALLOW).length;
    return {
      checked: editable.length > 0 && allowed === editable.length,
      indeterminate: allowed > 0 && allowed < editable.length,
    };
  }

  function applyScope(scope: Capability[], allowed: boolean) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const capability of scope) {
        const current = next[capability.name] ?? savedByCapability[capability.name] ?? CAP.INHERIT;
        if (isLockedPermission(current)) continue;
        next[capability.name] = allowed ? CAP.ALLOW : CAP.INHERIT;
      }
      return next;
    });
  }

  async function save() {
    setSaveError(null);
    const targetId = createdRoleId ?? role?.id ?? null;
    let step: 'role' | 'matrix' = 'role';
    try {
      let id = targetId;
      if (mode === 'create' && !id) {
        const created = await createMutation.mutateAsync({
          name: name.trim(),
          shortName: shortName.trim().toLowerCase(),
          description: description.trim() === '' ? undefined : description.trim(),
        });
        id = created.id;
        setCreatedRoleId(id);
      } else if (id) {
        await updateMutation.mutateAsync({
          roleId: id,
          draft: { name: name.trim(), description: description.trim() },
        });
      }
      if (!id || !contextId) return;
      step = 'matrix';
      const overrides = capabilities
        .map((capability) => ({ capability: capability.name, permission: valueOf(capability.name) }))
        .filter((entry) => entry.permission !== CAP.INHERIT);
      if (mode === 'edit' || overrides.length > 0) {
        await replaceMutation.mutateAsync({ roleId: id, payload: { contextId, overrides } });
      }
      onClose();
    } catch {
      setSaveError(
        step === 'matrix' && (mode === 'create' || createdRoleId) ? t('roleCreatedMatrixFailed') : t('roleSaveFailed'),
      );
    }
  }

  const title = mode === 'create' ? t('roleDialogCreateTitle') : t('roleDialogEditTitle');
  const subtitle = mode === 'create' ? t('roleDialogCreateDescription') : t('roleDialogEditDescription');
  const matrixReady = mode === 'create' || (!matrixPending && !matrixError);
  const nameError = name.trim() !== '' && name.trim().length < 2;
  const canSave =
    name.trim().length >= 2 && (mode === 'edit' || shortName.trim() !== '') && contextId !== '' && !saving && matrixReady;
  const allScopeState = scopeState(capabilities);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-semibold">{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {saveError ? <ErrorAlert variant="destructive">{saveError}</ErrorAlert> : null}

        <div className="flex flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={nameError || undefined}>
              <FieldLabel htmlFor="role-dialog-name">{t('roleName')}</FieldLabel>
              <Input
                id="role-dialog-name"
                placeholder={t('roleNamePlaceholder')}
                aria-invalid={nameError || undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
              {nameError ? <FieldError>{t('roleNameTooShort')}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="role-dialog-shortname">{t('roleShortName')}</FieldLabel>
              <Input
                id="role-dialog-shortname"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                disabled={saving || mode === 'edit' || createdRoleId !== null}
              />
              <p className="text-xs text-muted-foreground">{t('roleShortNameHint')}</p>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-dialog-description">{t('roleDescription')}</FieldLabel>
              <Input
                id="role-dialog-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-dialog-context">{t('roleContext')}</FieldLabel>
              <AdminSelect
                id="role-dialog-context"
                value={contextId}
                onValueChange={(next) => {
                  setContextOverride(next);
                  setEdits({});
                }}
                disabled={saving || contexts.length === 0}
                options={[
                  { value: '', label: t('selectContext') },
                  ...contexts.map((ctx) => ({
                    value: ctx.id,
                    label: contextOptionLabel(contexts, ctx, (key, options) => t(key, options)),
                  })),
                ]}
              />
            </Field>
          </FieldGroup>

          <div>
            <h3 className="mb-3 text-sm font-medium">{t('roleMatrix')}</h3>
            {matrixError ? (
              <>
                <ErrorAlert variant="destructive" className="mb-3">
                  {t('roleMatrixLoadFailed')}
                </ErrorAlert>
                <Button type="button" variant="outline" size="sm" onClick={onMatrixRetry}>
                  {t('retry')}
                </Button>
              </>
            ) : matrixPending ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-48 p-3">{t('resource')}</TableHead>
                      <TableHead className="w-16 p-3 text-center">
                        <Checkbox
                          aria-label={t('roleSelectAllPermissions')}
                          checked={allScopeState.checked}
                          indeterminate={allScopeState.indeterminate}
                          disabled={saving}
                          onCheckedChange={(checked) => applyScope(capabilities, checked)}
                        />
                      </TableHead>
                      <TableHead className="p-3">{t('roleReadLabel')}</TableHead>
                      <TableHead className="p-3">{t('roleWriteLabel')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <TableRow key={group.resource}>
                        <TableCell className="p-3 font-medium whitespace-nowrap">{group.resource}</TableCell>
                        <TableCell className="p-3 text-center">
                          <Checkbox
                            aria-label={t('roleSelectAllForResource', { resource: group.resource })}
                            checked={scopeState(group.capabilities).checked}
                            indeterminate={scopeState(group.capabilities).indeterminate}
                            disabled={saving}
                            onCheckedChange={(checked) => applyScope(group.capabilities, checked)}
                          />
                        </TableCell>
                        <TableCell className="p-3">
                          {renderCluster(group.capabilities.filter((capability) => capability.capType === 'read'))}
                        </TableCell>
                        <TableCell className="p-3">
                          {renderCluster(group.capabilities.filter((capability) => capability.capType === 'write'))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {saving ? t('savingRole') : t('saveRole')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
