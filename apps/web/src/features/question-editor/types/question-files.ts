
export const QUESTION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const QUESTION_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export type QuestionFileArea = 'questiontext' | 'generalfeedback' | 'answer' | 'feedback' | 'stimulus' | 'guidance';

export interface QuestionImageUploadResult {
  fileId: string;
  src: string;
  alt: string;
  fileName: string;
  mimeType: string;
}

export class QuestionImageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'QuestionImageError';
    this.code = code;
  }
}
