
export interface GlobalSearchDoc {
  id: string;
  area: string;
  itemId: string;
  title: string;
  content: string;
}

export interface SearchTargetViewer {
  canManageUsers: boolean;
}

export function globalSearchTarget(
  doc: Pick<GlobalSearchDoc, 'area' | 'itemId'>,
  viewer?: SearchTargetViewer,
): string | null {
  switch (doc.area) {
    case 'courses':
      return `/courses/${doc.itemId}`;
    case 'users':
      return viewer?.canManageUsers ? `/admin/users/${doc.itemId}/edit` : null;
    case 'contentbank':
      return `/content-bank/${doc.itemId}/edit`;
    default:
      return null;
  }
}
