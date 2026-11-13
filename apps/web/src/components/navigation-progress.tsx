import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';

export function useNavigationPending(): boolean {
  const navigation = useNavigation();
  const loading = navigation.state === 'loading';
  const [visible, setVisible] = useState(false);
  const [previousLoading, setPreviousLoading] = useState(loading);
  if (previousLoading !== loading) {
    setPreviousLoading(loading);
    setVisible(false);
  }
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return loading && visible;
}

export function NavigationProgressBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="h-full w-full animate-pulse bg-primary" />
    </div>
  );
}
