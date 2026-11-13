import type { QuestionCategory, StimulusView } from '@giaokhoa/contracts';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { useTranslation } from 'react-i18next';
import { QTYPES, QTYPE_LABEL_KEYS, plainText } from '#features/questions/utils/shared';
import type { QuestionEditorFormState } from '../types/form-model';
import { RichField } from './rich-fields';

interface GeneralSectionProps {
  form: QuestionEditorFormState;
  patchForm: (patch: Partial<QuestionEditorFormState>) => void;
  categories: QuestionCategory[];
  categoryId: string;
  editing: boolean;
  stimuli: StimulusView[];
  contextId: string | undefined;
  itemId: string | undefined;
  onCategoryChange: (value: string | null) => void;
  onQtypeChange: (value: string | null) => void;
}

export function GeneralSection({
  form,
  patchForm,
  categories,
  categoryId,
  editing,
  stimuli,
  contextId,
  itemId,
  onCategoryChange,
  onQtypeChange,
}: GeneralSectionProps) {
  const { t } = useTranslation('app');

  return (
    <>
      {!editing && (
        <Field>
          <FieldLabel id="q-category-label">{t('category')}</FieldLabel>
          <Select
            items={Object.fromEntries(categories.map((c) => [c.id, c.name]))}
            value={categoryId}
            onValueChange={onCategoryChange}
          >
            <SelectTrigger aria-labelledby="q-category-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel id="q-type-label">{t('questionType')}</FieldLabel>
        <Select
          items={Object.fromEntries(QTYPES.map((qtype) => [qtype, t(QTYPE_LABEL_KEYS[qtype])]))}
          value={form.qtype}
          disabled={editing}
          onValueChange={onQtypeChange}
        >
          <SelectTrigger aria-labelledby="q-type-label" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QTYPES.map((qtype) => (
              <SelectItem key={qtype} value={qtype}>
                {t(QTYPE_LABEL_KEYS[qtype])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel id="q-stimulus-label">{t('attachedStimulus')}</FieldLabel>
        <Select
          items={Object.fromEntries([
            ['none', t('noStimulus')],
            ...stimuli.map((s) => [s.id, plainText(s.content).slice(0, 80)] as [string, string]),
          ])}
          value={form.stimulusId === '' ? 'none' : form.stimulusId}
          onValueChange={(v) => patchForm({ stimulusId: v === 'none' || v === null ? '' : v })}
        >
          <SelectTrigger aria-labelledby="q-stimulus-label" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('noStimulus')}</SelectItem>
            {stimuli.map((stimulus) => (
              <SelectItem key={stimulus.id} value={stimulus.id}>
                {plainText(stimulus.content).slice(0, 80)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {form.qtype !== 'truefalse' && form.qtype !== 'multichoice' && (
        <RichField
          label={t('questionText')}
          value={form.questionText}
          onChange={(questionText) => patchForm({ questionText })}
          size="default"
          fileArea="questiontext"
          contextId={contextId}
          itemId={itemId}
        />
      )}
    </>
  );
}
