import { z } from 'zod';
import { searchIndexItemSchema, type SearchIndexItem, uuidIdSchema } from '@giaokhoa/contracts';

export { searchIndexItemSchema };
export type IndexItemDto = SearchIndexItem;

export const indexRawDocumentSchema = searchIndexItemSchema.extend({
  title: z.string().min(1),
  content: z.string(),
  contextId: uuidIdSchema,
  ownerId: uuidIdSchema.optional(),
});
export type IndexRawDto = z.infer<typeof indexRawDocumentSchema>;
