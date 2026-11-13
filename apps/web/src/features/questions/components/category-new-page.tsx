import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ErrorAlert } from '#components/error-alert';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { accessContextsQueryOptions } from '#lib/access';
import { usePermissions } from '#lib/permissions';
import { clearQuestionBankListCache, useCreateQuestionCategory } from '../queries/questions';
import { PageHeader, PageShell } from '#components/page-shell';
import { withApiReason, type ContextOption } from '../utils/shared';

export function QuestionCategoryNewPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createCategoryMutation = useCreateQuestionCategory();
  const perms = usePermissions();
  const [catName, setCatName] = useState('');
  const [contextId, setContextId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const contextsQuery = useQuery({
    ...accessContextsQueryOptions(),
    enabled: perms.ready && perms.canUseQuestionBank,
  });
  const contextOptions = useMemo<ContextOption[]>(() => {
    const contexts = contextsQuery.data ?? [];
    const manageable = new Set(
      (perms.access?.contexts ?? [])
        .filter((c) => c.capabilities.includes('question:managecategory'))
        .map((c) => c.contextId),
    );
    const courseName = (instanceId: string) =>
      perms.courses.find((c) => c.course.id === instanceId)?.course.fullName;
    return contexts
      .filter((c) => c.contextLevel === 10 || c.contextLevel === 40 || c.contextLevel === 50)
      .filter((c) => perms.access?.isSiteAdmin || manageable.has(c.id))
      .map((c) => ({
        id: c.id,
        level: c.contextLevel,
        label:
          c.contextLevel === 10
            ? t('contextSystem')
            : c.contextLevel === 50
              ? `${t('contextCourse')}: ${courseName(c.instanceId) ?? c.instanceId.slice(0, 8)}`
              : `${t('contextCourseCategory')}: ${c.instanceId.slice(0, 8)}`,
      }));
  }, [contextsQuery.data, perms.access, perms.courses, t]);

  const effectiveContextId =
    contextId || contextOptions.find((o) => o.level === 10)?.id || contextOptions[0]?.id || '';

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    try {
      await createCategoryMutation.mutateAsync({ name: catName, contextId: effectiveContextId });
      clearQuestionBankListCache(queryClient);
      navigate('/questions');
    } catch (err) {
      setMessage(withApiReason(t('categoryCreateFailedShort'), err));
    }
  }

  if (!perms.ready) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('newCategory')} />
        <div className="space-y-2" aria-label={t('loading')}>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </PageShell>
    );
  }
  if (!perms.canUseQuestionBank) {
    return (
      <PageShell width="medium">
        <PageHeader title={t('newCategory')} />
        <Card>
          <CardHeader>
            <CardTitle>{t('questionBank')}</CardTitle>
            <CardDescription>{t('questionBankForbidden')}</CardDescription>
          </CardHeader>
        </Card>
        <p>
          <Link to="/questions" className="text-sm underline">
            {t('backToQuestionBankList')}
          </Link>
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell width="medium">
      <PageHeader title={t('newCategory')} />
      {message ? (
        <ErrorAlert role="status">
          {message}
        </ErrorAlert>
      ) : null}
      <Card>
        <CardContent>
          <form onSubmit={(e) => void createCategory(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="qcat-name">{t('name')}</FieldLabel>
                <Input id="qcat-name" value={catName} onChange={(e) => setCatName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel id="qcat-context-label">{t('questionCategoryContext')}</FieldLabel>
                <Select
                  items={Object.fromEntries(contextOptions.map((option) => [option.id, option.label]))}
                  value={effectiveContextId === '' ? null : effectiveContextId}
                  onValueChange={(v) => setContextId(v ?? '')}
                >
                  <SelectTrigger aria-labelledby="qcat-context-label" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {contextOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex justify-end">
                <Button type="submit" disabled={!effectiveContextId}>
                  {t('createCategory')}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <p>
        <Link to="/questions" className="text-sm underline">
          {t('backToQuestionBankList')}
        </Link>
      </p>
    </PageShell>
  );
}
