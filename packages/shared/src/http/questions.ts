import { z } from 'zod';
import {
  questionCreateSchema,
  questionPatchSchema,
  questionSchema,
  questionVersionSummarySchema,
} from '../questions.js';

export const questionIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });
export const questionVersionPathParamsSchema = z.strictObject({
  id: z.uuidv7(),
  version: z.coerce.number().int().positive(),
});

export const questionUpdateBodySchema = questionPatchSchema
  .safeExtend({ expectedVersion: z.number().int().positive() })
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'expectedVersion'),
    'Không có dữ liệu để cập nhật',
  );

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
  getReady: {
    method: 'GET',
    path: '/questions/:id/ready',
    pathParams: questionIdPathParamsSchema,
    responses: { 200: questionSchema },
  },
  listVersions: {
    method: 'GET',
    path: '/questions/:id/versions',
    pathParams: questionIdPathParamsSchema,
    responses: { 200: z.array(questionVersionSummarySchema) },
  },
  getVersion: {
    method: 'GET',
    path: '/questions/:id/versions/:version',
    pathParams: questionVersionPathParamsSchema,
    responses: { 200: questionSchema },
  },
  update: {
    method: 'PATCH',
    path: '/questions/:id',
    pathParams: questionIdPathParamsSchema,
    body: questionUpdateBodySchema,
    responses: { 200: questionSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/questions/:id',
    pathParams: questionIdPathParamsSchema,
    responses: { 204: null },
  },
} as const;
