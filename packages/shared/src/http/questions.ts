import { z } from 'zod';
import { questionCreateSchema, questionPatchSchema, questionSchema } from '../questions.js';

export const questionIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });

export const questionsContract = {
  create: {
    method: 'POST',
    path: '/questions',
    body: questionCreateSchema,
    responses: { 201: questionSchema },
  },
  get: {
    method: 'GET',
    path: '/questions/:id',
    pathParams: questionIdPathParamsSchema,
    responses: { 200: questionSchema },
  },
  update: {
    method: 'PATCH',
    path: '/questions/:id',
    pathParams: questionIdPathParamsSchema,
    body: questionPatchSchema,
    responses: { 200: questionSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/questions/:id',
    pathParams: questionIdPathParamsSchema,
    responses: { 204: null },
  },
} as const;
