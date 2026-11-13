import type { StimulusView } from '@giaokhoa/contracts';
import { RichTextView, splitMultipleChoiceDocument, splitTrueFalseDocument } from '@giaokhoa/editor';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { useTranslation } from 'react-i18next';
import { plainText } from '#features/questions/utils/shared';
import { docHasContent, type Doc, type QuestionEditorFormState } from '../types/form-model';
import { numberingLabel } from './rich-fields';


export function StudentPreview({ form, stimulus }: { form: QuestionEditorFormState; stimulus: StimulusView | null }) {
  const { t } = useTranslation('app');
  const mcSplit = form.qtype === 'multichoice' ? splitMultipleChoiceDocument(form.mcDocument) : null;
  const tfSplit = form.qtype === 'truefalse' ? splitTrueFalseDocument(form.tfDocument) : null;
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle>{t('questionStudentPreview')}</CardTitle>
        <CardDescription>{t('questionStudentPreviewHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stimulus ? (
          <div className="rounded-md bg-slate-50 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{t('stimulusHeading')}</p>
            <RichTextView value={stimulus.content} />
          </div>
        ) : null}
        {form.qtype === 'multichoice' && mcSplit ? (
          <RichTextView value={mcSplit.question as Doc} />
        ) : form.qtype === 'truefalse' && tfSplit ? (
          <RichTextView value={tfSplit.stem as Doc} />
        ) : form.qtype !== 'truefalse' ? (
          <RichTextView value={form.questionText} />
        ) : null}
        {docHasContent(form.guidance) ? (
          <div className="rounded-md border p-3">
            <p className="mb-1 text-sm font-medium">{t('guidanceHeading')}</p>
            <RichTextView value={form.guidance ?? null} />
          </div>
        ) : null}
        {form.qtype === 'multichoice' && mcSplit ? (
          <div className="space-y-2">
            {mcSplit.choices.map((choice, index) => (
              <div key={choice.attrs.id} className="flex items-start gap-2 text-sm">
                <input type="radio" disabled className="mt-1" />
                <span className="font-medium">{numberingLabel(form.mcAnswerNumbering, index)}</span>
                <span className="min-w-0 flex-1">
                  <RichTextView value={{ type: 'doc', content: choice.content ?? [] } as Doc} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {form.qtype === 'truefalse' && tfSplit ? (
          <div className="space-y-3">
            {tfSplit.statements.map((statement, index) => (
              <div key={statement.attrs.id} className="space-y-1">
                <div className="flex items-start gap-2">
                  <span className="font-medium">{`${'abcd'[index] ?? index + 1})`}</span>
                  <span className="min-w-0 flex-1">
                    <RichTextView value={{ type: 'doc', content: statement.content ?? [] } as Doc} />
                  </span>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <input type="radio" disabled /> {t('questionTrue')}
                  </span>
                  <span className="flex items-center gap-1">
                    <input type="radio" disabled /> {t('questionFalse')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {form.qtype === 'shortanswer' ? <Input disabled placeholder={t('questionAnswerPlaceholder')} /> : null}
        {form.qtype === 'essay' ? (
          <textarea
            disabled
            rows={Math.min(15, Math.max(3, Number(form.essayResponseFieldLines) || 15))}
            className="w-full rounded-md border p-2 text-sm"
            placeholder={t('questionAnswerPlaceholder')}
          />
        ) : null}
        {form.qtype === 'essay' && docHasContent(form.essaySolution) ? (
          <div className="rounded-md border p-3">
            <p className="mb-1 text-sm font-medium">{t('modelAnswerHeading')}</p>
            <RichTextView value={form.essaySolution ?? null} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function formExcerpt(form: QuestionEditorFormState): string {
  if (form.qtype === 'multichoice') {
    const { question } = splitMultipleChoiceDocument(form.mcDocument);
    return plainText(question as Doc).slice(0, 80);
  }
  if (form.qtype === 'truefalse') {
    const { stem } = splitTrueFalseDocument(form.tfDocument);
    return plainText(stem as Doc).slice(0, 80);
  }
  return plainText(form.questionText).slice(0, 80);
}
