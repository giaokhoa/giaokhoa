import type { AssignRubricCriterionView } from '@giaokhoa/contracts';
import { Badge } from '@giaokhoa/ui/components/badge';
import { useTranslation } from 'react-i18next';

export function RubricView({ criteria }: { criteria: AssignRubricCriterionView[] }) {
  const { t } = useTranslation('app');
  return (
    <ul className="space-y-3">
      {criteria.map((c) => (
        <li key={c.id} className="rounded border p-3">
          <p className="font-medium">
            {c.name}
            {c.outcomeText ? <span className="ml-2 text-xs text-muted-foreground">{c.outcomeText}</span> : null}
          </p>
          {c.descriptionForStudent ? <p className="text-sm text-muted-foreground">{c.descriptionForStudent}</p> : null}
          {c.mode === 'levels' ? (
            <ul className="mt-1 flex flex-wrap gap-2">
              {c.levels.map((lv) => (
                <li key={lv.id}>
                  <Badge variant="secondary">
                    {lv.label} — {lv.score}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('assignRubricMaxScoreLine', { max: c.maxScore ?? 0 })}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
