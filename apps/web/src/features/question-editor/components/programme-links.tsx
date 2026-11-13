import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Label } from '@giaokhoa/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { useTranslation } from 'react-i18next';
import { COGNITIVE_LEVELS, LEVEL_LABEL_KEYS } from '#features/questions/utils/shared';
import type { CurriculumLinksView } from '#features/questions/utils/shared';

interface ProgrammeLinksProps {
  links: CurriculumLinksView | null;
  linkSubjects: { id: string; name: string }[];
  outcomeLabels: Record<string, string>;
  linkSubjectPick: string;
  linkOutcomeOptions: { id: string; label: string }[];
  linkOutcomePick: string;
  linkLevelPick: string;
  pickLinkSubject: (subjectId: string) => Promise<void>;
  attachLinkSubject: () => Promise<void>;
  detachLinkSubject: (subjectId: string) => Promise<void>;
  attachLinkOutcome: () => Promise<void>;
  changeOutcomeLevel: (outcomeId: string, cognitiveLevel: string) => Promise<void>;
  detachLinkOutcome: (outcomeId: string) => Promise<void>;
  setLinkOutcomePick: (value: string) => void;
  setLinkLevelPick: (value: string) => void;
}

export function ProgrammeLinks({
  links,
  linkSubjects,
  outcomeLabels,
  linkSubjectPick,
  linkOutcomeOptions,
  linkOutcomePick,
  linkLevelPick,
  pickLinkSubject,
  attachLinkSubject,
  detachLinkSubject,
  attachLinkOutcome,
  changeOutcomeLevel,
  detachLinkOutcome,
  setLinkOutcomePick,
  setLinkLevelPick,
}: ProgrammeLinksProps) {
  const { t } = useTranslation('app');

  return (
    <Card data-testid="question-programme">
      <CardHeader>
        <CardTitle>{t('programmeHeading')}</CardTitle>
        <CardDescription>{t('programmeDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {links === null ? (
          <p className="text-sm text-muted-foreground">{t('programmeLoadFailed')}</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>{t('programmeSubjects')}</Label>
              <ul className="space-y-2">
                {links.subjectIds.map((subjectId) => (
                  <li
                    key={subjectId}
                    data-testid={`programme-subject-${subjectId}`}
                    className="flex items-center gap-2"
                  >
                    <span className="flex-1 text-sm">
                      {linkSubjects.find((s) => s.id === subjectId)?.name ?? subjectId}
                    </span>
                    <Button type="button" variant="outline" onClick={() => void detachLinkSubject(subjectId)}>
                      {t('programmeDetach')}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex items-end gap-2">
                <Field className="flex-1">
                  <FieldLabel id="programme-subject-pick-label">{t('programmePickSubject')}</FieldLabel>
                  <Select
                    items={Object.fromEntries(linkSubjects.map((s) => [s.id, s.name]))}
                    value={linkSubjectPick === '' ? null : linkSubjectPick}
                    onValueChange={(v) => {
                      if (!v) return;
                      void pickLinkSubject(v);
                    }}
                  >
                    <SelectTrigger aria-labelledby="programme-subject-pick-label" className="w-full">
                      <SelectValue placeholder={t('programmePickSubject')} />
                    </SelectTrigger>
                    <SelectContent>
                      {linkSubjects
                        .filter((s) => !links.subjectIds.includes(s.id))
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button type="button" onClick={() => void attachLinkSubject()} disabled={!linkSubjectPick}>
                  {t('programmeAttach')}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('programmeOutcomes')}</Label>
              <ul className="space-y-2">
                {links.outcomes.map((o) => (
                  <li
                    key={o.outcomeId}
                    data-testid={`programme-outcome-${o.outcomeId}`}
                    className="flex items-center gap-2"
                  >
                    <span className="flex-1 text-sm">{outcomeLabels[o.outcomeId] ?? o.outcomeId}</span>
                    <Select
                      items={Object.fromEntries(COGNITIVE_LEVELS.map((level) => [level, t(LEVEL_LABEL_KEYS[level])]))}
                      value={o.cognitiveLevel}
                      onValueChange={(v) => void changeOutcomeLevel(o.outcomeId, v ?? o.cognitiveLevel)}
                    >
                      <SelectTrigger aria-label={t('programmeLevel')} className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COGNITIVE_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {t(LEVEL_LABEL_KEYS[level])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => void detachLinkOutcome(o.outcomeId)}>
                      {t('programmeDetach')}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex items-end gap-2">
                <Field className="flex-1">
                  <FieldLabel id="programme-outcome-pick-label">{t('programmePickOutcome')}</FieldLabel>
                  <Select
                    items={Object.fromEntries(
                      linkOutcomeOptions
                        .filter((o) => !links.outcomes.some((l) => l.outcomeId === o.id))
                        .map((o) => [o.id, o.label]),
                    )}
                    value={linkOutcomePick === '' ? null : linkOutcomePick}
                    onValueChange={(v) => setLinkOutcomePick(v ?? '')}
                  >
                    <SelectTrigger aria-labelledby="programme-outcome-pick-label" className="w-full">
                      <SelectValue placeholder={t('programmePickOutcome')} />
                    </SelectTrigger>
                    <SelectContent>
                      {linkOutcomeOptions
                        .filter((o) => !links.outcomes.some((l) => l.outcomeId === o.id))
                        .map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel id="programme-level-pick-label">{t('programmeLevel')}</FieldLabel>
                  <Select
                    items={Object.fromEntries(COGNITIVE_LEVELS.map((level) => [level, t(LEVEL_LABEL_KEYS[level])]))}
                    value={linkLevelPick}
                    onValueChange={(v) => setLinkLevelPick(v ?? 'biet')}
                  >
                    <SelectTrigger aria-labelledby="programme-level-pick-label" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COGNITIVE_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(LEVEL_LABEL_KEYS[level])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button type="button" onClick={() => void attachLinkOutcome()} disabled={!linkOutcomePick}>
                  {t('programmeAttach')}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
