import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Checkbox } from '@giaokhoa/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { ErrorAlert } from '#components/error-alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { ApiError } from '#lib/api';
import { frameworkExportQueryOptions, useAddTemplateCohort, useAddTemplateCompetency, useCompetencyFrameworks, useCompetencyTemplates, useCreateCompetency, useCreateCompetencyFramework, useCreateLearningPlanTemplate, useCreatePlansFromTemplate, useFrameworkCompetencies, useImportCompetencyFramework, usePlanReviewAction, useReviewQueuePlans, useReviewQueueUsercomps, useUsercompReviewAction, useUserOptions, userCompetenciesQueryOptions, userLearningPlansQueryOptions } from '../queries/learning-plan';
import type { PlanReviewActionName, UsercompReviewActionName } from '../types/learning-plan';
import { COMPETENCY_INDENT, type FrameworkView } from '../types/types';


export function CompetencyAdmin() {
  const { t } = useTranslation('app');
  const PLAN_STATUS: Record<number, string> = {
    0: t('planStatusDraft'),
    1: t('planStatusActive'),
    2: t('planStatusWaiting'),
    3: t('planStatusInReview'),
    4: t('planStatusComplete'),
  };
  const REVIEW_STATUS: Record<number, string> = {
    0: t('reviewStatusNone'),
    1: t('reviewStatusWaiting'),
    2: t('reviewStatusInReview'),
  };
  const queryClient = useQueryClient();
  const frameworksQuery = useCompetencyFrameworks();
  const templatesQuery = useCompetencyTemplates();
  const frameworks = frameworksQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const firstTemplateId = templatesQuery.data?.[0]?.id;
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const competenciesQuery = useFrameworkCompetencies(selectedFrameworkId);
  const competencies = competenciesQuery.data ?? [];
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const adminError =
    frameworksQuery.isError || templatesQuery.isError || competenciesQuery.isError
      ? t('compAdminLoadFailed')
      : null;
  const [fwDraft, setFwDraft] = useState({
    shortName: '',
    idNumber: '',
    description: '',
    scaleValues: '',
    scaleProficient: '',
    visible: true,
  });
  const [compDraft, setCompDraft] = useState({ shortName: '', idNumber: '', description: '', parentId: '' });
  const [tplDraft, setTplDraft] = useState({ shortName: '', description: '', dueDate: '' });
  const [tplCompetencyId, setTplCompetencyId] = useState('');
  const [tplCohortId, setTplCohortId] = useState('');
  const usersQuery = useUserOptions();
  const users = usersQuery.data ?? [];
  const [reviewUserId, setReviewUserId] = useState('');
  const [queueUserId, setQueueUserId] = useState<string | null>(null);
  const reviewPlansQuery = useReviewQueuePlans(queueUserId);
  const reviewUsercompsQuery = useReviewQueueUsercomps(queueUserId);
  const reviewPlans = queueUserId === null ? null : (reviewPlansQuery.data ?? null);
  const reviewUsercomps = queueUserId === null ? null : (reviewUsercompsQuery.data ?? null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const createFrameworkMutation = useCreateCompetencyFramework();
  const importFrameworkMutation = useImportCompetencyFramework();
  const createCompetencyMutation = useCreateCompetency();
  const createTemplateMutation = useCreateLearningPlanTemplate();
  const addTemplateCompetencyMutation = useAddTemplateCompetency();
  const addTemplateCohortMutation = useAddTemplateCohort();
  const createPlansMutation = useCreatePlansFromTemplate();
  const planReviewMutation = usePlanReviewAction();
  const usercompReviewMutation = useUsercompReviewAction();

  if (selectedTemplateId === '' && firstTemplateId) {
    setSelectedTemplateId(firstTemplateId);
  }

  async function createFramework(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    const values = fwDraft.scaleValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const proficient = fwDraft.scaleProficient
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map(Number);
    try {
      await createFrameworkMutation.mutateAsync({
        shortName: fwDraft.shortName,
        ...(fwDraft.idNumber.trim() ? { idNumber: fwDraft.idNumber.trim() } : {}),
        ...(fwDraft.description.trim() ? { description: fwDraft.description.trim() } : {}),
        scale: { values, proficient },
        visible: fwDraft.visible,
      });
      setFwDraft({ shortName: '', idNumber: '', description: '', scaleValues: '', scaleProficient: '', visible: true });
      setAdminMessage(t('compFrameworkCreated'));
    } catch {
      setAdminMessage(t('compFrameworkCreateFailed'));
    }
  }

  async function exportFramework(fw: FrameworkView) {
    setAdminMessage(null);
    try {
      const doc = await queryClient.fetchQuery(frameworkExportQueryOptions(fw.id));
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `framework-${fw.shortName || fw.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setAdminMessage(t('compExported', { name: fw.shortName }));
    } catch {
      setAdminMessage(t('compExportFailed'));
    }
  }

  async function importFramework(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    setImportError(null);
    if (!importFile) return;
    let doc: unknown;
    try {
      doc = JSON.parse(await importFile.text());
    } catch {
      setImportError(t('compImportInvalidJson'));
      return;
    }
    try {
      const created = await importFrameworkMutation.mutateAsync(doc);
      setImportFile(null);
      setImportInputKey((k) => k + 1);
      setAdminMessage(t('compImportSuccess', { name: created.shortName }));
    } catch (err) {
      setImportError(
        err instanceof ApiError
          ? t('compImportApiError', { detail: err.problem.detail ?? err.problem.title })
          : t('compImportFailed'),
      );
    }
  }

  async function createCompetency(event: FormEvent) {
    event.preventDefault();
    if (!selectedFrameworkId) return;
    setAdminMessage(null);
    try {
      await createCompetencyMutation.mutateAsync({
        frameworkId: selectedFrameworkId,
        body: {
          shortName: compDraft.shortName,
          ...(compDraft.idNumber.trim() ? { idNumber: compDraft.idNumber.trim() } : {}),
          ...(compDraft.description.trim() ? { description: compDraft.description.trim() } : {}),
          ...(compDraft.parentId ? { parentId: compDraft.parentId } : {}),
        },
      });
      setCompDraft({ shortName: '', idNumber: '', description: '', parentId: '' });
      setAdminMessage(t('compCompetencyCreated'));
    } catch {
      setAdminMessage(t('compCompetencyCreateFailed'));
    }
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    try {
      const created = await createTemplateMutation.mutateAsync({
        shortName: tplDraft.shortName,
        ...(tplDraft.description.trim() ? { description: tplDraft.description.trim() } : {}),
        ...(tplDraft.dueDate ? { dueDate: tplDraft.dueDate } : {}),
      });
      setTplDraft({ shortName: '', description: '', dueDate: '' });
      setSelectedTemplateId(created.id);
      setAdminMessage(t('compTemplateCreated'));
    } catch {
      setAdminMessage(t('compTemplateCreateFailed'));
    }
  }

  async function addTemplateCompetency(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      await addTemplateCompetencyMutation.mutateAsync({
        templateId: selectedTemplateId,
        competencyId: tplCompetencyId.trim(),
      });
      setTplCompetencyId('');
      setAdminMessage(t('compTemplateCompetencyAdded'));
    } catch {
      setAdminMessage(t('compActionFailed'));
    }
  }

  async function addTemplateCohort(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      await addTemplateCohortMutation.mutateAsync({
        templateId: selectedTemplateId,
        cohortId: tplCohortId.trim(),
      });
      setTplCohortId('');
      setAdminMessage(t('compTemplateCohortAdded'));
    } catch {
      setAdminMessage(t('compActionFailed'));
    }
  }

  async function createPlansFromTemplate() {
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      const res = await createPlansMutation.mutateAsync({ templateId: selectedTemplateId });
      setAdminMessage(t('compPlansCreated', { count: res.created }));
    } catch {
      setAdminMessage(t('compActionFailed'));
    }
  }

  async function loadReviewQueue() {
    const uid = reviewUserId.trim();
    if (!uid) return;
    setQueueUserId(uid);
    try {
      await Promise.all([
        queryClient.fetchQuery(userLearningPlansQueryOptions(uid)),
        queryClient.fetchQuery(userCompetenciesQueryOptions(uid)),
      ]);
    } catch {
      setAdminMessage(t('compReviewQueueLoadFailed'));
    }
  }

  function syncQueueWithInput() {
    const uid = reviewUserId.trim();
    if (uid && uid !== queueUserId) setQueueUserId(uid);
  }

  async function planReviewAction(planId: string, action: PlanReviewActionName) {
    setAdminMessage(null);
    try {
      await planReviewMutation.mutateAsync({ planId, action, userId: reviewUserId.trim() });
      setAdminMessage(t('compReviewActionDone'));
      syncQueueWithInput();
    } catch {
      setAdminMessage(t('compReviewActionFailed'));
    }
  }

  async function usercompReviewAction(usercompId: string, action: UsercompReviewActionName) {
    setAdminMessage(null);
    try {
      await usercompReviewMutation.mutateAsync({ usercompId, action, userId: reviewUserId.trim() });
      setAdminMessage(t('compReviewActionDone'));
      syncQueueWithInput();
    } catch {
      setAdminMessage(t('compReviewActionFailed'));
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('compAdminTitle')}</CardTitle>
          <CardDescription>{t('compAdminDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {adminError ? (
            <ErrorAlert variant="destructive">
              {adminError}
            </ErrorAlert>
          ) : null}
          {adminMessage ? (
            <ErrorAlert>
              {adminMessage}
            </ErrorAlert>
          ) : null}
          <div className="space-y-3">
            <h3 className="font-medium">{t('compFrameworksTitle')}</h3>
            <ul className="space-y-1" aria-label={t('compFrameworksTitle')}>
              {frameworks.map((fw) => (
                <li key={fw.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{fw.shortName}</span>
                  {fw.scaleConfiguration?.values?.length ? (
                    <span>{fw.scaleConfiguration.values.join(', ')}</span>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (fw.id === selectedFrameworkId) {
                        void competenciesQuery.refetch();
                      } else {
                        setSelectedFrameworkId(fw.id);
                      }
                    }}
                  >
                    {t('compViewCompetencies')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void exportFramework(fw)}>
                    {t('compExportFramework')}
                  </Button>
                </li>
              ))}
              {frameworks.length === 0 ? <li className="text-sm">{t('compNoFrameworks')}</li> : null}
            </ul>
            <form onSubmit={(e) => void createFramework(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="fw-shortname">{t('compFrameworkShortname')}</FieldLabel>
                  <Input
                    id="fw-shortname"
                    value={fwDraft.shortName}
                    onChange={(e) => setFwDraft({ ...fwDraft, shortName: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fw-idnumber">{t('compFrameworkIdnumber')}</FieldLabel>
                  <Input
                    id="fw-idnumber"
                    value={fwDraft.idNumber}
                    onChange={(e) => setFwDraft({ ...fwDraft, idNumber: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fw-description">{t('compFrameworkDescription')}</FieldLabel>
                  <Input
                    id="fw-description"
                    value={fwDraft.description}
                    onChange={(e) => setFwDraft({ ...fwDraft, description: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fw-scale-values">{t('compScaleValues')}</FieldLabel>
                  <Input
                    id="fw-scale-values"
                    value={fwDraft.scaleValues}
                    onChange={(e) => setFwDraft({ ...fwDraft, scaleValues: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="fw-scale-proficient">{t('compScaleProficient')}</FieldLabel>
                  <Input
                    id="fw-scale-proficient"
                    value={fwDraft.scaleProficient}
                    onChange={(e) => setFwDraft({ ...fwDraft, scaleProficient: e.target.value })}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="fw-visible"
                    checked={fwDraft.visible}
                    onCheckedChange={(checked) => setFwDraft({ ...fwDraft, visible: checked === true })}
                  />
                  <Label htmlFor="fw-visible">{t('compFrameworkVisible')}</Label>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">{t('compCreateFramework')}</Button>
                </div>
              </FieldGroup>
            </form>
            <form onSubmit={(e) => void importFramework(e)}>
              <FieldGroup>
                <h4 className="font-medium">{t('compImportTitle')}</h4>
                <Field>
                  <FieldLabel htmlFor="fw-import-file">{t('compImportFile')}</FieldLabel>
                  <Input
                    key={importInputKey}
                    id="fw-import-file"
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  />
                </Field>
                {importError ? (
                  <ErrorAlert variant="destructive">
                    {importError}
                  </ErrorAlert>
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit" variant="outline" disabled={!importFile}>
                    {t('compImportAction')}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">{t('compCompetenciesTitle')}</h3>
            {selectedFrameworkId ? (
              <>
                <ul className="space-y-1" aria-label={t('compCompetenciesTitle')}>
                  {competencies.map((c) => (
                    <li
                      key={c.id}
                      className={`text-sm ${COMPETENCY_INDENT[Math.min(Math.max(0, (c.depth ?? 1) - 1), 5)]}`}
                    >
                      <span className="font-medium">{c.shortName}</span>
                      {c.description ? <span> — {c.description}</span> : null}
                    </li>
                  ))}
                  {competencies.length === 0 ? <li className="text-sm">{t('compNoCompetencies')}</li> : null}
                </ul>
                <form onSubmit={(e) => void createCompetency(e)}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="comp-shortname">{t('compCompetencyShortname')}</FieldLabel>
                      <Input
                        id="comp-shortname"
                        value={compDraft.shortName}
                        onChange={(e) => setCompDraft({ ...compDraft, shortName: e.target.value })}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="comp-idnumber">{t('compCompetencyIdnumber')}</FieldLabel>
                      <Input
                        id="comp-idnumber"
                        value={compDraft.idNumber}
                        onChange={(e) => setCompDraft({ ...compDraft, idNumber: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="comp-description">{t('compCompetencyDescription')}</FieldLabel>
                      <Input
                        id="comp-description"
                        value={compDraft.description}
                        onChange={(e) => setCompDraft({ ...compDraft, description: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel id="comp-parent-label">{t('compCompetencyParent')}</FieldLabel>
                      <Select
                        items={Object.fromEntries([
                          ['none', t('compNoParent')],
                          ...competencies.map((c) => [c.id, c.shortName] as [string, string]),
                        ])}
                        value={compDraft.parentId === '' ? 'none' : compDraft.parentId}
                        onValueChange={(v) =>
                          setCompDraft({ ...compDraft, parentId: v === 'none' || v === null ? '' : v })
                        }
                      >
                        <SelectTrigger aria-labelledby="comp-parent-label" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('compNoParent')}</SelectItem>
                          {competencies.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.shortName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex justify-end">
                      <Button type="submit">{t('compAddCompetency')}</Button>
                    </div>
                  </FieldGroup>
                </form>
              </>
            ) : (
              <p className="text-sm">{t('compSelectFramework')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('compTemplatesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1" aria-label={t('compTemplatesTitle')}>
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-3 text-sm">
                <span className="font-medium">{tpl.shortName}</span>
                {tpl.id === selectedTemplateId ? (
                  <Badge>{t('compSelectTemplate')}</Badge>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setSelectedTemplateId(tpl.id)}>
                    {t('view')}
                  </Button>
                )}
              </li>
            ))}
            {templates.length === 0 ? <li className="text-sm">{t('compNoTemplates')}</li> : null}
          </ul>
          <form onSubmit={(e) => void createTemplate(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tpl-shortname">{t('compTemplateShortname')}</FieldLabel>
                <Input
                  id="tpl-shortname"
                  value={tplDraft.shortName}
                  onChange={(e) => setTplDraft({ ...tplDraft, shortName: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-description">{t('compTemplateDescription')}</FieldLabel>
                <Input
                  id="tpl-description"
                  value={tplDraft.description}
                  onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-duedate">{t('compTemplateDuedate')}</FieldLabel>
                <Input
                  id="tpl-duedate"
                  type="date"
                  value={tplDraft.dueDate}
                  onChange={(e) => setTplDraft({ ...tplDraft, dueDate: e.target.value })}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">{t('compCreateTemplate')}</Button>
              </div>
            </FieldGroup>
          </form>
          {selectedTemplateId ? (
            <div className="space-y-3">
              <form onSubmit={(e) => void addTemplateCompetency(e)}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tpl-competency-id">{t('compTemplateCompetencyId')}</FieldLabel>
                    <Input
                      id="tpl-competency-id"
                      value={tplCompetencyId}
                      onChange={(e) => setTplCompetencyId(e.target.value)}
                      required
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline">
                      {t('compAddTemplateCompetency')}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
              <form onSubmit={(e) => void addTemplateCohort(e)}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tpl-cohort-id">{t('compTemplateCohortId')}</FieldLabel>
                    <Input
                      id="tpl-cohort-id"
                      value={tplCohortId}
                      onChange={(e) => setTplCohortId(e.target.value)}
                      required
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline">
                      {t('compAddTemplateCohort')}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
              <Button type="button" onClick={() => void createPlansFromTemplate()}>
                {t('compCreatePlansFromTemplate')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('compReviewQueueTitle')}</CardTitle>
          <CardDescription>{t('compReviewQueueDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            {users.length > 0 ? (
              <Field>
                <FieldLabel id="review-user-select-label">{t('compReviewUser')}</FieldLabel>
                <Select
                  items={Object.fromEntries([
                    ['none', '—'],
                    ...users.map((u) => [u.id, `${u.username} (${u.id})`] as [string, string]),
                  ])}
                  value={reviewUserId === '' ? 'none' : reviewUserId}
                  onValueChange={(v) => setReviewUserId(v === 'none' || v === null ? '' : v)}
                >
                  <SelectTrigger aria-labelledby="review-user-select-label" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.username} ({u.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="review-user-id">{t('compReviewUserId')}</FieldLabel>
              <Input id="review-user-id" value={reviewUserId} onChange={(e) => setReviewUserId(e.target.value)} />
            </Field>
            <Button type="button" onClick={() => void loadReviewQueue()}>
              {t('compLoadReviewQueue')}
            </Button>
          </div>
          {reviewPlans !== null ? (
            <div className="space-y-2">
              <h3 className="font-medium">{t('compReviewPlansTitle')}</h3>
              <ul className="space-y-1" aria-label={t('compReviewPlansTitle')}>
                {reviewPlans.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span>{PLAN_STATUS[p.status] ?? p.status}</span>
                    {p.status === 2 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void planReviewAction(p.id, 'start-review')}
                      >
                        {t('compStartReview')}
                      </Button>
                    ) : null}
                    {p.status === 3 ? (
                      <Button type="button" variant="outline" onClick={() => void planReviewAction(p.id, 'approve')}>
                        {t('compApprovePlan')}
                      </Button>
                    ) : null}
                    {p.status === 1 ? (
                      <Button type="button" variant="outline" onClick={() => void planReviewAction(p.id, 'unapprove')}>
                        {t('compUnapprovePlan')}
                      </Button>
                    ) : null}
                    {p.status === 1 || p.status === 3 ? (
                      <Button type="button" variant="outline" onClick={() => void planReviewAction(p.id, 'complete')}>
                        {t('compCompletePlan')}
                      </Button>
                    ) : null}
                  </li>
                ))}
                {reviewPlans.length === 0 ? <li className="text-sm">{t('compNoPlansForUser')}</li> : null}
              </ul>
            </div>
          ) : null}
          {reviewUsercomps !== null ? (
            <div className="space-y-2">
              <h3 className="font-medium">{t('compReviewUsercompsTitle')}</h3>
              <ul className="space-y-1" aria-label={t('compReviewUsercompsTitle')}>
                {reviewUsercomps.map((uc) => (
                  <li key={uc.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{t('compUsercompCompetency', { id: uc.competencyId })}</span>
                    <span>{REVIEW_STATUS[uc.status] ?? uc.status}</span>
                    <span>
                      {uc.proficiency == null
                        ? t('proficiencyNotYet')
                        : uc.proficiency
                          ? t('proficiencyYes')
                          : t('proficiencyNo')}
                    </span>
                    {uc.grade !== null ? <span>{t('compUsercompGrade', { grade: uc.grade })}</span> : null}
                    {uc.status === 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void usercompReviewAction(uc.id, 'start-review')}
                      >
                        {t('compStartReview')}
                      </Button>
                    ) : null}
                    {uc.status === 1 || uc.status === 2 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void usercompReviewAction(uc.id, 'approve')}
                      >
                        {t('compApproveUsercomp')}
                      </Button>
                    ) : null}
                    {uc.status === 1 || uc.status === 2 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void usercompReviewAction(uc.id, 'reject')}
                      >
                        {t('compRejectUsercomp')}
                      </Button>
                    ) : null}
                  </li>
                ))}
                {reviewUsercomps.length === 0 ? <li className="text-sm">{t('compNoUsercompsForUser')}</li> : null}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
