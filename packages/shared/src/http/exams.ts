import { z } from 'zod';
import {
  examCreateSchema,
  examPatchSchema,
  examRevisionCreateSchema,
  examRevisionSchema,
  examRevisionSummarySchema,
  examSchema,
} from '../exams.js';

const examParams = z.strictObject({ id: z.uuidv7() });
const revisionParams = z.strictObject({
  id: z.uuidv7(),
  revision: z.coerce.number().int().positive(),
});

export const examsContract = {
  create: {
    method: 'POST',
    path: '/exams',
    body: examCreateSchema,
    responses: { 201: examSchema },
  },
  list: {
    method: 'GET',
    path: '/exams',
    responses: { 200: z.array(examSchema) },
  },
  get: {
    method: 'GET',
    path: '/exams/:id',
    pathParams: examParams,
    responses: { 200: examSchema },
  },
  update: {
    method: 'PATCH',
    path: '/exams/:id',
    pathParams: examParams,
    body: examPatchSchema,
    responses: { 200: examSchema },
  },
  createRevision: {
    method: 'POST',
    path: '/exams/:id/revisions',
    pathParams: examParams,
    body: examRevisionCreateSchema,
    responses: { 201: examRevisionSchema },
  },
  listRevisions: {
    method: 'GET',
    path: '/exams/:id/revisions',
    pathParams: examParams,
    responses: { 200: z.array(examRevisionSummarySchema) },
  },
  getRevision: {
    method: 'GET',
    path: '/exams/:id/revisions/:revision',
    pathParams: revisionParams,
    responses: { 200: examRevisionSchema },
  },
} as const;
