import { z } from 'zod';
import { stimulusCreateSchema, stimulusPatchSchema, stimulusSchema } from '../questions.js';

export const stimulusIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });

export const stimuliContract = {
  create: {
    method: 'POST',
    path: '/stimuli',
    body: stimulusCreateSchema,
    responses: { 201: stimulusSchema },
  },
  get: {
    method: 'GET',
    path: '/stimuli/:id',
    pathParams: stimulusIdPathParamsSchema,
    responses: { 200: stimulusSchema },
  },
  update: {
    method: 'PATCH',
    path: '/stimuli/:id',
    pathParams: stimulusIdPathParamsSchema,
    body: stimulusPatchSchema,
    responses: { 200: stimulusSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/stimuli/:id',
    pathParams: stimulusIdPathParamsSchema,
    responses: { 204: null },
  },
} as const;
