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
