
const QUESTION_FILE_SRC_PATTERN = /^\/api\/v1\/files\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/content$/;

export function questionFileIdFromSrc(src: string): string | null {
  return QUESTION_FILE_SRC_PATTERN.exec(src)?.[1] ?? null;
}
