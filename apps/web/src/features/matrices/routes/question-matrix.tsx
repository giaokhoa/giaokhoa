import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { downloadMatrixSpecification } from '../api/matrix';
import { useAddMatrixCell, useCreateMatrix, useCurriculaBySubject, useCurriculumTree, useDeleteMatrixCell, useMatrixAvailability, useMatrixBanks, useMatrixDetail, useMatrixSpecification, useUpdateMatrix } from '../queries/matrix';
import { useCurriculumSubjects } from '#lib/curriculum';
import type { SpecificationOutcomeLite } from '../types/matrix';
import { useCourseList } from '#features/courses/queries/course-new';
import { usePermissions } from '#lib/permissions';
import { COGNITIVE_LEVELS, LEVEL_LABEL_KEYS, QTYPES, QTYPE_LABEL_KEYS, withApiReason } from '#features/questions/utils/shared';
import type { CurriculumTreeNode } from '#features/questions/utils/shared';


const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs';

function flattenNodes(nodes: CurriculumTreeNode[], depth = 0): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, title: `${'— '.repeat(depth)}${node.title}` });
    out.push(...flattenNodes(node.children ?? [], depth + 1));
  }
  return out;
}

function outcomeCodePrefix(outcome: SpecificationOutcomeLite): string | null {
  return outcome.code;
}

export function MatrixNewPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const perms = usePermissions();
  const canLoad = perms.ready && perms.canUseQuestionBank;
  const banksQuery = useMatrixBanks(canLoad);
  const personalBankId = banksQuery.data?.find((b) => b.scope === 'personal')?.id ?? null;
  const bankLoaded = banksQuery.isSuccess || banksQuery.isError;
  const coursesQuery = useCourseList();
  const forCourseId = coursesQuery.data?.[0]?.id;
  const subjects = useCurriculumSubjects(canLoad && coursesQuery.data !== undefined, forCourseId).data ?? [];
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [curriculumId, setCurriculumId] = useState('');
  const curriculaQuery = useCurriculaBySubject(subjectId, forCourseId);
  const curricula = curriculaQuery.data ?? [];
  const [includeAdvanced, setIncludeAdvanced] = useState(false);
  const [totalScore, setTotalScore] = useState('10');
  const [isTemplate, setIsTemplate] = useState(false);
  const [status, setStatus] = useState('draft');
  const [message, setMessage] = useState<string | null>(null);

  const [previousCurriculumScope, setPreviousCurriculumScope] = useState({
    subjectId: '',
    curricula: undefined as typeof curriculaQuery.data,
  });
  if (previousCurriculumScope.subjectId !== subjectId || previousCurriculumScope.curricula !== curriculaQuery.data) {
    setPreviousCurriculumScope({ subjectId, curricula: curriculaQuery.data });
    if (!subjectId) {
      setCurriculumId('');
    } else if (curriculaQuery.data) {
      const rows = curriculaQuery.data;
      setCurriculumId((prev) => (rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? '')));
    }
  }

  const createMutation = useCreateMatrix();

  async function createMatrix(event: FormEvent) {
    event.preventDefault();
    if (!personalBankId) return;
    try {
      await createMutation.mutateAsync({
        name, subjectId, curriculumId, bankId: personalBankId, levelSet: includeAdvanced ? 'four' : 'three',
        totalScore: Number(totalScore) || 10, isTemplate, status,
      });
      navigate('/matrices', { state: { notice: t('matrixCreated') } });
    } catch (err) {
      setMessage(withApiReason(t('matrixCreateFailed'), err));
    }
  }

  if (!perms.ready || !bankLoaded) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('matrixCreate')} />
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full']} />
      </PageShell>
    );
  }
  if (!perms.canUseQuestionBank || !personalBankId) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('matrixCreate')} />
        <Card>
          <CardHeader>
            <CardTitle>{t('myMatrixBank')}</CardTitle>
            <CardDescription>{t('matrixNoPersonalBank')}</CardDescription>
          </CardHeader>
        </Card>
        <p>
          <Link to="/matrices" className="text-sm underline">
            {t('backToQuestionBankList')}
          </Link>
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell width="medium">
      <PageHeader title={t('matrixCreate')} />
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={(e) => void createMatrix(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="matrix-name">{t('matrixName')}</FieldLabel>
                <Input id="matrix-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="matrix-subject">{t('matrixSubject')}</FieldLabel>
                <select id="matrix-subject" className={SELECT_CLASS} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="matrix-curriculum">{t('matrixCurriculum')}</FieldLabel>
                <select id="matrix-curriculum" className={SELECT_CLASS} value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)} required>
                  <option value="">—</option>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t('matrixGradeOption', { grade: c.grade })}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-sm text-muted-foreground">{t('matrixCv7991Note')}</p>
              <div className="flex items-center gap-2">
                <Checkbox id="matrix-advanced" checked={includeAdvanced} onCheckedChange={(v) => setIncludeAdvanced(v === true)} />
                <Label htmlFor="matrix-advanced">{t('matrixIncludeAdvanced')}</Label>
              </div>
              <Field>
                <FieldLabel htmlFor="matrix-total-score">{t('matrixTotalScore')}</FieldLabel>
                <Input
                  id="matrix-total-score"
                  type="number"
                  min="1"
                  step="0.5"
                  value={totalScore}
                  onChange={(e) => setTotalScore(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="matrix-status">{t('matrixStatus')}</FieldLabel>
                <select id="matrix-status" className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="draft">{t('matrixStatusDraft')}</option>
                  <option value="ready">{t('matrixStatusReady')}</option>
                </select>
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox id="matrix-template" checked={isTemplate} onCheckedChange={(v) => setIsTemplate(v === true)} />
                <Label htmlFor="matrix-template">{t('matrixIsTemplate')}</Label>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={!name.trim() || !subjectId || !curriculumId}>
                  {t('matrixCreate')}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/matrices')}>
                  {t('backToQuestionBankList')}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export function MatrixEditPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const perms = usePermissions();
  const { matrixId } = useParams<{ matrixId: string }>();
  const canLoad = perms.ready && perms.canUseQuestionBank;
  const detailQuery = useMatrixDetail(matrixId, canLoad);
  const matrix = detailQuery.data ?? null;
  const treeQuery = useCurriculumTree(matrix?.curriculumId, !!matrix);
  const nodes = useMemo(() => (treeQuery.data ? flattenNodes(treeQuery.data) : []), [treeQuery.data]);
  const availability = useMatrixAvailability(matrixId, canLoad && !!matrix).data ?? null;
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('draft');
  const [isTemplate, setIsTemplate] = useState(false);
  const [includeAdvanced, setIncludeAdvanced] = useState(false);
  const [totalScore, setTotalScore] = useState('10');
  const [cellNodeId, setCellNodeId] = useState('');
  const [cellLevel, setCellLevel] = useState('biet');
  const [cellQtype, setCellQtype] = useState('multichoice');
  const [cellCount, setCellCount] = useState('1');
  const [cellScore, setCellScore] = useState('1');

  const updateMutation = useUpdateMatrix();
  const addCellMutation = useAddMatrixCell();
  const deleteCellMutation = useDeleteMatrixCell();

  const [specOpen, setSpecOpen] = useState(false);
  const specQuery = useMatrixSpecification(matrixId, canLoad && !!matrix && specOpen);
  const spec = specQuery.data ?? null;

  async function exportSpec(format: 'xlsx' | 'docx') {
    if (!matrix) return;
    try {
      await downloadMatrixSpecification(matrix.id, format);
    } catch (err) {
      setMessage(withApiReason(t('specExportFailed'), err));
    }
  }

  const loadError = detailQuery.isError ? t('matrixLoadFailed') : null;
  const displayMessage = message ?? loadError;

  const specRows = useMemo(
    () =>
      spec
        ? spec.topics.flatMap((topic) =>
            topic.nodes.flatMap((node) => node.cells.map((cell) => ({ topic, node, cell }))),
          )
        : [],
    [spec],
  );
  const nodeTitleById = useMemo(() => new Map(nodes.map((n) => [n.id, n.title] as const)), [nodes]);
  const availabilityByCellId = useMemo(
    () => new Map((availability?.cells ?? []).map((c) => [c.cellId, c] as const)),
    [availability],
  );

  const [previousMatrixData, setPreviousMatrixData] = useState<typeof detailQuery.data | undefined>(undefined);
  if (previousMatrixData !== detailQuery.data) {
    setPreviousMatrixData(detailQuery.data);
    if (detailQuery.data) {
      const row = detailQuery.data;
      setName(row.name);
      setStatus(row.status);
      setIsTemplate(row.isTemplate);
      setIncludeAdvanced(row.levelSet === 'four');
      setTotalScore(String(row.totalScore));
    }
  }

  async function saveMatrix(event: FormEvent) {
    event.preventDefault();
    if (!matrix) return;
    try {
      await updateMutation.mutateAsync({
        matrixId: matrix.id,
        body: {
          name, status, isTemplate, totalScore: Number(totalScore) || 10,
          levelSet: includeAdvanced ? 'four' : 'three',
        },
      });
      setMessage(t('matrixSaved'));
    } catch (err) {
      setMessage(withApiReason(t('matrixSaveFailed'), err));
    }
  }

  async function addCell(event: FormEvent) {
    event.preventDefault();
    if (!matrix || !cellNodeId) return;
    try {
      await addCellMutation.mutateAsync({
        matrixId: matrix.id,
        body: {
          curriculumNodeId: cellNodeId, cognitiveLevel: cellLevel, qtype: cellQtype,
          questionCount: Number(cellCount) || 1, cellScore: Number(cellScore) || 1,
        },
      });
    } catch (err) {
      setMessage(withApiReason(t('matrixCellAddFailed'), err));
    }
  }

  async function deleteCell(cellId: string) {
    if (!matrix) return;
    try {
      await deleteCellMutation.mutateAsync({ matrixId: matrix.id, cellId });
    } catch (err) {
      setMessage(withApiReason(t('matrixCellDeleteFailed'), err));
    }
  }

  if (!perms.ready || !matrix) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('matrixEditTitle')} />
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full']} />
      </PageShell>
    );
  }

  const nodeLabel = (id: string) => nodeTitleById.get(id) ?? id.slice(0, 8);
  const availabilityOf = (cellId: string) => availabilityByCellId.get(cellId);

  return (
    <PageShell width="medium">
      <PageHeader title={t('matrixEditTitle')} />
      {displayMessage ? (
        <ErrorAlert>
          {displayMessage}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>
            {matrix.name} <span className="text-sm font-normal text-muted-foreground">v{matrix.version}</span>
          </CardTitle>
          <CardDescription>{t('myMatrixBank')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={(e) => void saveMatrix(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-matrix-name">{t('matrixName')}</FieldLabel>
                <Input id="edit-matrix-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-matrix-status">{t('matrixStatus')}</FieldLabel>
                <select id="edit-matrix-status" className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="draft">{t('matrixStatusDraft')}</option>
                  <option value="ready">{t('matrixStatusReady')}</option>
                  <option value="hidden">{t('matrixStatusHidden')}</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-matrix-score">{t('matrixTotalScore')}</FieldLabel>
                <Input
                  id="edit-matrix-score"
                  type="number"
                  min="1"
                  step="0.5"
                  value={totalScore}
                  onChange={(e) => setTotalScore(e.target.value)}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-matrix-template" checked={isTemplate} onCheckedChange={(v) => setIsTemplate(v === true)} />
                <Label htmlFor="edit-matrix-template">{t('matrixIsTemplate')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-matrix-advanced" checked={includeAdvanced} onCheckedChange={(v) => setIncludeAdvanced(v === true)} />
                <Label htmlFor="edit-matrix-advanced">{t('matrixIncludeAdvanced')}</Label>
              </div>
              <div className="flex gap-2">
                <Button type="submit">{t('matrixEditTitle')}</Button>
                <Button type="button" variant="outline" onClick={() => navigate('/matrices')}>
                  {t('backToQuestionBankList')}
                </Button>
              </div>
            </FieldGroup>
          </form>

          <div className="space-y-3">
            <h3 className="font-medium">{t('matrixCells')}</h3>
            {matrix.cells.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard:emptyTable')}</p>
            ) : (
              <ul className="space-y-2">
                {matrix.cells.map((cell) => {
                  const av = availabilityOf(cell.id);
                  return (
                    <li key={cell.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">
                        {nodeLabel(cell.curriculumNodeId)} ·{' '}
                        {t(LEVEL_LABEL_KEYS[cell.cognitiveLevel as (typeof COGNITIVE_LEVELS)[number]] ?? 'levelBiet')} ·{' '}
                        {t(QTYPE_LABEL_KEYS[cell.qtype as (typeof QTYPES)[number]] ?? 'qtypeMultichoice')} ·{' '}
                        {cell.questionCount} × {cell.cellScore}
                        {av ? (
                          <span className="block text-xs text-muted-foreground">
                            {t('matrixAvailabilityRequired')}: {av.required} · {t('matrixAvailabilityAvailable')}: {av.available} ·{' '}
                            {t('matrixAvailabilityDeficit')}: {av.deficit}
                          </span>
                        ) : null}
                      </span>
                      <Button type="button" variant="outline" onClick={() => void deleteCell(cell.id)}>
                        {t('deleteRow')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {availability ? (
              <p className="text-sm">
                {t('matrixAvailability')}:{' '}
                <span className="font-medium">
                  {availability.sufficient ? t('matrixAvailabilitySufficient') : t('matrixAvailabilityInsufficient')}
                </span>
              </p>
            ) : null}
            <form onSubmit={(e) => void addCell(e)} className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="cell-node">{t('matrixCellNode')}</Label>
                <select
                  id="cell-node"
                  className={SELECT_CLASS}
                  value={cellNodeId}
                  onChange={(e) => setCellNodeId(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="cell-level">{t('matrixCellLevel')}</Label>
                <select id="cell-level" className={SELECT_CLASS} value={cellLevel} onChange={(e) => setCellLevel(e.target.value)}>
                  {COGNITIVE_LEVELS.filter((level) => matrix.levelSet === 'four' || level !== 'van_dung_cao').map((level) => (
                    <option key={level} value={level}>
                      {t(LEVEL_LABEL_KEYS[level])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="cell-qtype">{t('matrixCellQtype')}</Label>
                <select id="cell-qtype" className={SELECT_CLASS} value={cellQtype} onChange={(e) => setCellQtype(e.target.value)}>
                  {QTYPES.map((qtype) => (
                    <option key={qtype} value={qtype}>
                      {t(QTYPE_LABEL_KEYS[qtype])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="cell-count">{t('matrixCellCount')}</Label>
                <Input id="cell-count" type="number" min="1" value={cellCount} onChange={(e) => setCellCount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cell-score">{t('matrixCellScore')}</Label>
                <Input id="cell-score" type="number" min="0.25" step="0.25" value={cellScore} onChange={(e) => setCellScore(e.target.value)} />
              </div>
              <Button type="submit" disabled={!cellNodeId}>
                {t('matrixAddCell')}
              </Button>
            </form>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">{t('specSectionTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('specSectionHint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setSpecOpen((open) => !open)}>
                {specOpen ? t('specHide') : t('specView')}
              </Button>
              <Button type="button" variant="outline" onClick={() => void exportSpec('xlsx')}>
                {t('specExportExcel')}
              </Button>
              <Button type="button" variant="outline" onClick={() => void exportSpec('docx')}>
                {t('specExportWord')}
              </Button>
            </div>
            {specOpen ? (
              specQuery.isPending ? (
                <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full']} />
              ) : specQuery.isError ? (
                <ErrorAlert>
                  {t('specLoadFailed')}
                </ErrorAlert>
              ) : spec ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{spec.purpose}</p>
                  {spec.topics.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('specEmpty')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="p-2">{t('specIndex')}</th>
                            <th className="p-2">{t('specTopic')}</th>
                            <th className="p-2">{t('matrixCellNode')}</th>
                            <th className="p-2">{t('specOutcome')}</th>
                            <th className="p-2">{t('matrixCellLevel')}</th>
                            <th className="p-2">{t('matrixCellQtype')}</th>
                            <th className="p-2">{t('matrixCellCount')}</th>
                            <th className="p-2">{t('specScore')}</th>
                            <th className="p-2">{t('specSlot')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {specRows.map(({ topic, node, cell }, rowIndex) => (
                                <tr key={cell.cellId} className="border-b align-top">
                                  <td className="p-2">{rowIndex + 1}</td>
                                  <td className="p-2">{topic.topicTitle}</td>
                                  <td className="p-2">{node.nodeTitle}</td>
                                  <td className="p-2">
                                    {node.outcomes.length === 0 ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : (
                                      <ul className="flex flex-col gap-1">
                                        {node.outcomes.map((outcome) => {
                                          const code = outcomeCodePrefix(outcome);
                                          return (
                                            <li key={outcome.outcomeId}>
                                              {code ? (
                                                <span className="mr-1 text-xs font-medium text-muted-foreground">{code}</span>
                                              ) : null}
                                              <span>{outcome.programContent ?? outcome.content}</span>
                                              {outcome.derivedContent ? (
                                                <span className="block text-xs text-muted-foreground">
                                                  {t('specDerivedNote', { content: outcome.derivedContent })}
                                                </span>
                                              ) : null}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </td>
                                  <td className="p-2">
                                    {t(LEVEL_LABEL_KEYS[cell.cognitiveLevel as (typeof COGNITIVE_LEVELS)[number]] ?? 'levelBiet')}
                                  </td>
                                  <td className="p-2">
                                    {t(QTYPE_LABEL_KEYS[cell.qtype as (typeof QTYPES)[number]] ?? 'qtypeMultichoice')}
                                  </td>
                                  <td className="p-2">{cell.qtype === 'truefalse' ? cell.questionCount * 4 : cell.questionCount}</td>
                                  <td className="p-2">{cell.cellScore}</td>
                                  <td className="p-2">
                                    {cell.slotNumbers && cell.slotNumbers.length
                                      ? cell.drawNote
                                        ? `${cell.drawNote} (${t('dossierSpecSlots', { slots: cell.slotNumbers.join(', ') })})`
                                        : cell.slotNumbers.join(', ')
                                      : (cell.drawNote ?? '—')}
                                  </td>
                                </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-sm font-medium">
                    {t('dossierSpecTotals', { count: spec.totals.totalQuestions, score: spec.totals.totalScore })}
                  </p>
                </div>
              ) : null
            ) : null}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
