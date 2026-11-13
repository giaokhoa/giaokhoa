import { LinkedAccountsCard } from '../components/profile-cards';
import { SettingsShell } from '../components/settings-shell';

export function SettingsLinkedAccountsPage() {
  return (
    <SettingsShell>
      <LinkedAccountsCard />
    </SettingsShell>
  );
}

export default SettingsLinkedAccountsPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('settingsLinkedAccounts');
}
