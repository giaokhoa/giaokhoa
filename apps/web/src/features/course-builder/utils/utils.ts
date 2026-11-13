import { LibraryItem } from '#features/content-bank/types/content-bank';
import type { CourseContentType } from '@giaokhoa/contracts';

/**
 * Cách kết hợp các tiêu chí hoàn thành khoá: 1 = phải đạt TẤT CẢ tiêu chí, 2 = chỉ cần đạt BẤT KỲ tiêu chí nào. Backend đọc số trần — chưa có enum ở contracts.
 */
export const CRITERIA_METHOD = { all: 1, any: 2 } as const;

/** Nhãn loại nội dung trong Builder Outline (menu chọn loại module). */
export const CONTENT_TYPE_LABEL_KEYS: Record<CourseContentType, string> = {
  mod_page: 'contentType_mod_page',
  mod_resource: 'contentType_mod_resource',
  mod_quiz: 'contentType_mod_quiz',
  mod_assign: 'contentType_mod_assign',
};

/**
 * Khoá i18n cho loại nội dung của module. `component` của module lưu dạng chuỗi tự do (contracts chưa khai enum ở module) nên tra Record theo 4 loại đã biết; loại lạ thì trả về chính chuỗi đó — giữ đúng hành vi cũ của `{ defaultValue: component }` ở chỗ gọi.
 */
export function contentTypeKey(component: string): string {
  if (component === 'mod_page' || component === 'mod_resource' || component === 'mod_quiz' || component === 'mod_assign') {
    return CONTENT_TYPE_LABEL_KEYS[component];
  }
  return component;
}

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

/** Key i18n nhãn loại học liệu của Kho (CB-1) — dùng chung catalog platform với trang kho. */
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

/** Key i18n nhãn phạm vi (không gian) của học liệu trong Kho. */
export function bankScopeKey(scope: string): string {
  return scope === 'org' ? 'platform:libraryScopeOrg' : scope === 'school' ? 'platform:libraryScopeSchool' : 'platform:libraryScopePersonal';
}

/**
 * Học liệu cắm được vào khoá: mọi học liệu trừ bộ câu hỏi THAM CHIẾU
 * (`question_set` không có file — chỉ tham chiếu Ngân hàng câu hỏi),
 * khớp đúng cổng ở endpoint insert của CB-1
 * (`contentbank.question_set_not_insertable`).
 */
export function bankItemInsertable(item: LibraryItem): boolean {
  return !(item.resourceType === 'question_set' && !item.fileId);
}
