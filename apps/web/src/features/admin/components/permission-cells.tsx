import { CAP } from '@giaokhoa/contracts';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Toggle } from '@giaokhoa/ui/components/toggle';
import { Eye, Lock, PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '#config/i18n';


export function isLockedPermission(value: number): boolean {
  return value === CAP.PREVENT || value === CAP.PROHIBIT;
}

function LockedPermissionMark({ value }: { value: number }) {
  const { t } = useTranslation('app');
  const prohibit = value === CAP.PROHIBIT;
  return (
    <Badge
      variant={prohibit ? 'destructive' : 'outline'}
      className={prohibit ? undefined : 'border-amber-600/30 bg-amber-600/10 text-amber-600'}
    >
      <Lock aria-hidden />
      {prohibit ? t('permProhibit') : t('permPrevent')}
    </Badge>
  );
}

export interface PermissionCheckboxCellProps {
  value: number;
  disabled?: boolean;
  ariaLabel: string;
  onToggle: (allowed: boolean) => void;
}

export function PermissionCheckboxCell({ value, disabled, ariaLabel, onToggle }: PermissionCheckboxCellProps) {
  const locked = isLockedPermission(value);
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Checkbox
        aria-label={ariaLabel}
        checked={value === CAP.ALLOW}
        disabled={disabled || locked}
        onCheckedChange={(checked) => onToggle(checked)}
      />
      {locked ? <LockedPermissionMark value={value} /> : null}
    </span>
  );
}

export interface PermissionToggleCellProps {
  value: number;
  capType: string;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  onToggle: (allowed: boolean) => void;
}

export function PermissionToggleCell({ value, capType, disabled, ariaLabel, title, onToggle }: PermissionToggleCellProps) {
  const locked = isLockedPermission(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Toggle
        aria-label={ariaLabel}
        title={title}
        variant="outline"
        size="sm"
        pressed={value === CAP.ALLOW}
        disabled={disabled || locked}
        className="size-8 min-w-8 bg-background px-0 text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/20"
        onPressedChange={(pressed) => onToggle(pressed)}
      >
        {capType === 'read' ? <Eye className="size-3" /> : <PencilLine className="size-3" />}
      </Toggle>
      {locked ? <LockedPermissionMark value={value} /> : null}
    </span>
  );
}
