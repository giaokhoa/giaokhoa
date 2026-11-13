import { apiJson } from '#lib/api';
import type { GlobalSearchDoc } from '#lib/search-target';


export function fetchGlobalSearch(keyword: string) {
  return apiJson<GlobalSearchDoc[]>(`/api/v1/search?q=${encodeURIComponent(keyword)}`);
}
