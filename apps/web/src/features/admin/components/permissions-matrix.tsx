import { CAP, type CapabilityMatrixResponse } from '@giaokhoa/contracts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { type CapabilityGroup } from '../types/admin-roles';
import { PermissionToggleCell } from './permission-cells';

export interface PermissionsMatrixProps {
  groups: CapabilityGroup[];
  matrix: CapabilityMatrixResponse;
  valueOf: (roleId: string, capability: string) => number;
  contextId: string;
  savingCells: ReadonlySet<string>;
  onCellChange: (roleId: string, capability: string, permission: number) => void;
}

export function PermissionsMatrix({
  groups,
  matrix,
  contextId,
  valueOf,
  savingCells,
  onCellChange,
}: PermissionsMatrixProps) {
  const { t } = useTranslation('app');

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 p-4 font-semibold text-foreground">{t('resource')}</TableHead>
          {matrix.roles.map((role) => (
            <TableHead key={role.id} className="h-10 p-4 text-foreground">
              <span className="block font-semibold">{role.name}</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {t('roleUsersCount', { count: role.userCount })}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => {
          const orderedCapabilities = [...group.capabilities].sort((left, right) =>
            left.capType === right.capType
              ? left.name.localeCompare(right.name)
              : left.capType === 'read'
                ? -1
                : 1,
          );
          return (
            <TableRow key={group.resource}>
              <TableCell className="p-4 font-medium whitespace-nowrap">{group.resource}</TableCell>
              {matrix.roles.map((role) => (
                <TableCell key={role.id} className="px-4 py-2">
                  <span className="inline-flex flex-wrap items-start gap-1">
                    {orderedCapabilities.map((capability) => {
                      const key = `${contextId}:${role.id}:${capability.name}`;
                      return (
                        <PermissionToggleCell
                          key={capability.name}
                          ariaLabel={t('permissionsCellLabel', {
                            capability: capability.name,
                            role: role.name,
                          })}
                          title={capability.name}
                          capType={capability.capType}
                          value={valueOf(role.id, capability.name)}
                          disabled={savingCells.has(key)}
                          onToggle={(allowed) =>
                            onCellChange(role.id, capability.name, allowed ? CAP.ALLOW : CAP.INHERIT)
                          }
                        />
                      );
                    })}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
