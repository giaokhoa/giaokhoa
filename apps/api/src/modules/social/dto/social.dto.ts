import {
  addCommentSchema,
  addItemTagSchema,
  createNoteSchema,
  rateItemSchema,
  setItemTagsSchema,
  type AddComment,
  type AddItemTag,
  type CreateNote,
  type RateItem,
  type SetItemTags,
} from '@giaokhoa/contracts';

/**
 * Validation của Social (tags/comments/ratings/notes) dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts` là nguồn sự thật duy nhất.
 */
export {
  addCommentSchema,
  addItemTagSchema,
  createNoteSchema,
  rateItemSchema,
  setItemTagsSchema,
};
export type SetItemTagsDto = SetItemTags;
export type AddItemTagDto = AddItemTag;
export type AddCommentDto = AddComment;
export type RateDto = RateItem;
export type CreateNoteDto = CreateNote;
