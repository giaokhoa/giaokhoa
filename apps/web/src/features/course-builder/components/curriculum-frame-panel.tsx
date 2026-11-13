import { useState } from 'react';
import type { Course } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Label } from '@giaokhoa/ui/components/label';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { useApplyBookFrame, useApplyCurriculumFrame, useUpdateCourseFrameInfo } from '../queries/course-builder';
import { FrameUnitPicker } from '#features/courses/components/frame-picker';
import {
  useBookFrameChapters, useCurriculumFrameUnits, useCurriculumSubjectsScoped,
} from '#lib/curriculum';

export function CurriculumFramePanel({
  courseId,
  course,
  sections,
  onApplied,
}: {
  courseId: string;
  course: Course | null;
  sections: { section: number; name: string | null }[];
  onApplied: () => void;
}) {
  const { t } = useTranslation('app');
  const [subjectId, setSubjectId] = useState('');
  const [grade, setGrade] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [insertAt, setInsertAt] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const updateFrameInfoMutation = useUpdateCourseFrameInfo();
  const applyFrameMutation = useApplyCurriculumFrame();

  const loadedCourseId = course?.id;
  const loadedSubjectId = course?.subjectId;
  const loadedGrade = course?.grade;
  const loadedCourseScope = String(loadedCourseId) + ':' + String(loadedSubjectId) + ':' + String(loadedGrade);
  const [previousLoadedScope, setPreviousLoadedScope] = useState<string | null>(null);
  if (previousLoadedScope !== loadedCourseScope) {
    setPreviousLoadedScope(loadedCourseScope);
    if (loadedCourseId != null) {
      setSubjectId(loadedSubjectId ?? '');
      setGrade(loadedGrade != null ? String(loadedGrade) : '');
    }
  }

  const subjectsQuery = useCurriculumSubjectsScoped(null, courseId);
  const subjects = subjectsQuery.data ?? [];
  const loadFailed = subjectsQuery.isError;

  const frameUnitsQuery = useCurriculumFrameUnits(subjectId, grade ? Number(grade) : null, courseId);
  const curriculumId = frameUnitsQuery.data?.curriculumId ?? null;
  const units = frameUnitsQuery.data?.units ?? [];

  const frameSelectionScope = subjectId + ':' + grade;
  const [previousFrameSelectionScope, setPreviousFrameSelectionScope] = useState(frameSelectionScope);
  if (previousFrameSelectionScope !== frameSelectionScope) {
    setPreviousFrameSelectionScope(frameSelectionScope);
    setSelected([]);
  }

  async function saveCourseInfo() {
    setMessage(null);
    try {
      await updateFrameInfoMutation.mutateAsync({
        courseId,
        subjectId: subjectId === '' ? null : subjectId,
        grade: grade === '' ? null : Number(grade),
      });
      setMessage(t('frameCourseInfoSaved'));
    } catch {
      setMessage(t('frameApplyFailed'));
    }
  }

  async function applyFrame() {
    if (!curriculumId || selected.length === 0) return;
    setMessage(null);
    try {
      const result = await applyFrameMutation.mutateAsync({
        courseId,
        curriculumId,
        nodeIds: selected,
        ...(insertAt === '' ? {} : { insertAtSection: Number(insertAt) }),
      });
      setMessage(t('frameApplied', { count: result.sections.length }));
      setSelected([]);
      onApplied();
    } catch {
      setMessage(t('frameApplyFailed'));
    }
  }

  const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('framePanelTitle')}</CardTitle>
        <CardDescription>{t('framePanelDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadFailed ? (
          <p className="text-sm text-muted-foreground">{t('frameNoUnits')}</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="frame-subject">{t('frameSubjectLabel')}</Label>
              <select
                id="frame-subject"
                className={selectClass}
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                <option value="">{t('courseSubjectNone')}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="frame-grade">{t('frameGradeLabel2')}</Label>
              <select id="frame-grade" className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">{t('courseGradeNone')}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                  <option key={g} value={g}>
                    {t('curriculumGradeLabel', { grade: g })}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={() => void saveCourseInfo()}>
              {t('frameSaveCourseInfo')}
            </Button>
            {curriculumId ? (
              <>
                <div className="space-y-2">
                  <Label>{t('courseFrameUnitsTitle')}</Label>
                  <FrameUnitPicker
                    units={units}
                    selected={selected}
                    idPrefix="admin-frame"
                    onToggle={(nodeId, checked) =>
                      setSelected((prev) => (checked ? [...prev, nodeId] : prev.filter((x) => x !== nodeId)))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="frame-insert-at">{t('frameInsertAt')}</Label>
                  <select
                    id="frame-insert-at"
                    className={selectClass}
                    value={insertAt}
                    onChange={(e) => setInsertAt(e.target.value)}
                  >
                    <option value="">{t('frameInsertEnd')}</option>
                    {sections
                      .filter((s) => s.section >= 1)
                      .map((s) => (
                        <option key={s.section} value={s.section}>
                          {t('frameInsertBefore', { number: s.section, name: s.name ?? '' })}
                        </option>
                      ))}
                  </select>
                </div>
                <Button type="button" disabled={selected.length === 0} onClick={() => void applyFrame()}>
                  {t('frameApply')}
                </Button>
              </>
            ) : null}
          </>
        )}
        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
export function BookFramePanel({
  courseId,
  course,
  sections,
  onApplied,
}: {
  courseId: string;
  course: Course | null;
  sections: { section: number; name: string | null }[];
  onApplied: () => void;
}) {
  const { t } = useTranslation('app');
  const [selected, setSelected] = useState<string[]>([]);
  const [insertAt, setInsertAt] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const subjectId = course?.subjectId ?? '';
  const grade = course?.grade ?? null;
  const chaptersQuery = useBookFrameChapters(subjectId, grade, courseId);
  const bookId = chaptersQuery.data?.bookId ?? null;
  const chapters = chaptersQuery.data?.chapters ?? [];

  const bookSelectionScope = subjectId + ':' + grade + ':' + courseId;
  const [previousBookSelectionScope, setPreviousBookSelectionScope] = useState(bookSelectionScope);
  if (previousBookSelectionScope !== bookSelectionScope) {
    setPreviousBookSelectionScope(bookSelectionScope);
    setSelected([]);
  }

  const applyBookFrameMutation = useApplyBookFrame();

  async function applyBookFrame() {
    if (!bookId || selected.length === 0) return;
    setMessage(null);
    try {
      const result = await applyBookFrameMutation.mutateAsync({
        courseId,
        bookId,
        chapterNodeIds: selected,
        ...(insertAt === '' ? {} : { insertAtSection: Number(insertAt) }),
      });
      setMessage(t('bookFrameApplied', { count: result.sections.length }));
      setSelected([]);
      onApplied();
    } catch {
      setMessage(t('bookFrameApplyFailed'));
    }
  }

  const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bookFramePanelTitle')}</CardTitle>
        <CardDescription>{t('bookFramePanelDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!bookId ? (
          <p className="text-sm text-muted-foreground">{t('bookFrameNoBook')}</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>{t('bookFrameChaptersTitle')}</Label>
              <ul className="flex flex-col gap-1">
                {chapters.map((chapter) => (
                  <li key={chapter.nodeId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      id={`book-frame-${chapter.nodeId}`}
                      checked={selected.includes(chapter.nodeId)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, chapter.nodeId] : prev.filter((x) => x !== chapter.nodeId),
                        )
                      }
                    />
                    <label htmlFor={`book-frame-${chapter.nodeId}`}>{chapter.title}</label>
                    <span className="text-muted-foreground">
                      {t('bookFrameChapterMeta', { lessons: chapter.lessonCount, outcomes: chapter.outcomeCount })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <Label htmlFor="book-frame-insert-at">{t('frameInsertAt')}</Label>
              <select
                id="book-frame-insert-at"
                className={selectClass}
                value={insertAt}
                onChange={(e) => setInsertAt(e.target.value)}
              >
                <option value="">{t('frameInsertEnd')}</option>
                {sections
                  .filter((s) => s.section >= 1)
                  .map((s) => (
                    <option key={s.section} value={s.section}>
                      {t('frameInsertBefore', { number: s.section, name: s.name ?? '' })}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="button" disabled={selected.length === 0} onClick={() => void applyBookFrame()}>
              {t('bookFrameApply')}
            </Button>
          </>
        )}
        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
