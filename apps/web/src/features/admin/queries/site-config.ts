import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSiteSettingAudit, fetchSiteSettings, resetSiteSetting, saveSiteSetting } from '../api/site-config';
import { queryKeys } from './keys';


export function useSiteSettings() {
  return useQuery({
    queryKey: queryKeys.siteConfig,
    queryFn: () => fetchSiteSettings(),
  });
}

export function useSiteSettingAudit(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.siteConfigAudit,
    queryFn: () => fetchSiteSettingAudit().catch(() => []),
    enabled,
  });
}

function useInvalidateSiteConfig() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.siteConfig });
}

export function useSaveSiteSetting() {
  const invalidate = useInvalidateSiteConfig();
  return useMutation({
    mutationFn: (input: { component: string; name: string; value: unknown }) => saveSiteSetting(input),
    onSuccess: invalidate,
  });
}

export function useResetSiteSetting() {
  const invalidate = useInvalidateSiteConfig();
  return useMutation({
    mutationFn: (input: { component: string; name: string }) => resetSiteSetting(input),
    onSuccess: invalidate,
  });
}
