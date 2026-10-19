import { z } from 'zod';
import {
  learningOutcomeCreateSchema,
  learningOutcomePatchSchema,
  learningOutcomeSchema,
} from '../curriculum.js';

export const learningOutcomeIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });

export const learningOutcomesContract = {
  create: {
    method: 'POST',
    path: '/learning-outcomes',
    body: learningOutcomeCreateSchema,
    responses: { 201: learningOutcomeSchema },
  },
  get: {
    method: 'GET',
    path: '/learning-outcomes/:id',
    pathParams: learningOutcomeIdPathParamsSchema,
    responses: { 200: learningOutcomeSchema },
  },
  update: {
    method: 'PATCH',
    path: '/learning-outcomes/:id',
    pathParams: learningOutcomeIdPathParamsSchema,
    body: learningOutcomePatchSchema,
    responses: { 200: learningOutcomeSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/learning-outcomes/:id',
    pathParams: learningOutcomeIdPathParamsSchema,
    responses: { 204: null },
  },
} as const;
