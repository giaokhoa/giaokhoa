import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { PageShell } from '#components/page-shell';

export function HomePage() {
  const { t } = useTranslation('app');
  return (
    <PageShell width="wide">
      <Card>
        <CardHeader>
          <CardTitle>Giáo khoa</CardTitle>
          <CardDescription>{t('homeDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button render={<Link to="/login" />}>{t('signIn')}</Button>
            <Button variant="outline" render={<Link to="/health" />}>
              {t('checkApiHealth')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
