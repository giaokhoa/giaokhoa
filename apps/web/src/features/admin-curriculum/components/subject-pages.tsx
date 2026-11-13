import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { ErrorAlert } from '#components/error-alert';
import { PageShell } from '#components/page-shell';
import { useCurriculumSubjectRow } from '#lib/curriculum';
import { FormScreen } from './form-screen';
import { SubjectForm } from './subject-form';

export function AdminSubjectNewPage() {
  const { t } = useTranslation('app');
  return (
    <FormScreen title={t('curriculumCreateSubject')} backTo="/admin/curriculum">
      <SubjectForm />
    </FormScreen>
  );
}

export function AdminSubjectEditPage() {
  const { t } = useTranslation('app');
  const { subjectId } = useParams();
  // Đọc môn qua TanStack Query (F-01 của rà soát #133); tải lỗi thì
  // hiện lỗi kèm nút thử lại, chưa có dữ liệu thì giữ trạng thái đang tải.
  const subjectQuery = useCurriculumSubjectRow(subjectId);
  const subject = subjectQuery.data;
  if (subjectQuery.isError) {
    return (
      <PageShell width="narrow">
        <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
          <span>{t('curriculumLoadFailed')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void subjectQuery.refetch()}>
            {t('retry')}
          </Button>
        </ErrorAlert>
      </PageShell>
    );
  }
  if (!subject) {
    return (
      <PageShell width="narrow">
        <p className="text-sm text-muted-foreground">{t('curriculumLoading')}</p>
      </PageShell>
    );
  }
  return (
    <FormScreen title={t('curriculumEditSubject', { name: subject.name })} backTo="/admin/curriculum">
      <SubjectForm initial={subject} />
    </FormScreen>
  );
}
