export type AnswerDraft = {
  choiceId: string;
  statements: Record<string, boolean | undefined>;
  answer: string;
  essay: unknown;
  parts: Record<string, unknown>;
};

type StorageHost = Pick<Window, 'localStorage'>;

/** Bản nháp đang nhập được giữ ở trình duyệt, kể cả khi chưa đủ điều kiện lưu lên máy chủ. */
export function readDraft(host: StorageHost, key: string): AnswerDraft | null {
  try {
    const raw = host.localStorage.getItem(key);
    if (!raw || raw.length > 1_000_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const draft = value as Partial<AnswerDraft>;
    if (
      typeof draft.choiceId !== 'string' ||
      typeof draft.answer !== 'string' ||
      !draft.statements ||
      typeof draft.statements !== 'object' ||
      Array.isArray(draft.statements) ||
      Object.values(draft.statements).some((entry) => typeof entry !== 'boolean') ||
      !draft.parts ||
      typeof draft.parts !== 'object' ||
      Array.isArray(draft.parts)
    )
      return null;
    return draft as AnswerDraft;
  } catch {
    return null;
  }
}

export function writeDraft(host: StorageHost, key: string, draft: AnswerDraft): boolean {
  try {
    const content = JSON.stringify(draft);
    if (content.length > 1_000_000) return false;
    host.localStorage.setItem(key, content);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(host: StorageHost, key: string) {
  try {
    host.localStorage.removeItem(key);
  } catch {
    // Lưu trữ của trình duyệt có thể bị vô hiệu hóa.
  }
}

export function canAutoSave(answer: string | null, failedAnswer: string | null) {
  return answer !== null && answer !== failedAnswer;
}
