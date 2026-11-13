import { LibraryItem } from '#features/content-bank/types/content-bank';

export type ItemStatusChoice = 'draft' | 'open' | 'scheduled';

export function statusChoiceOf(visible: boolean, openAt: string | null | undefined): ItemStatusChoice {
  if (!visible) return 'draft';
  return openAt ? 'scheduled' : 'open';
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function bankTypeKey(resourceType: string): string {
  return resourceType === 'multimedia_lecture'
    ? 'platform:libraryTypeMultimediaLecture'
    : resourceType === 'lab_guide'
      ? 'platform:libraryTypeLabGuide'
      : resourceType === 'simulation'
        ? 'platform:libraryTypeSimulation'
        : resourceType === 'question_set'
          ? 'platform:libraryTypeQuestionSet'
          : 'platform:libraryTypeReference';
}

export function bankScopeKey(scope: string): string {
  return scope === 'org' ? 'platform:libraryScopeOrg' : scope === 'school' ? 'platform:libraryScopeSchool' : 'platform:libraryScopePersonal';
}

export function bankItemInsertable(item: LibraryItem): boolean {
  return !(item.resourceType === 'question_set' && !item.fileId);
}
