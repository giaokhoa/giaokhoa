import { z } from 'zod';
import {
  curriculumSchema,
  gradeSchema,
  subjectCreateSchema,
  subjectPatchSchema,
  subjectSchema,
} from '../curriculum.js';

export const subjectIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });
export const subjectGradePathParamsSchema = z.strictObject({
  id: z.uuidv7(),
  grade: z.coerce.number().pipe(gradeSchema),
});

export const subjectsContract = {
  list: { method: 'GET', path: '/subjects', responses: { 200: z.array(subjectSchema) } },
  create: {
    method: 'POST',
    path: '/subjects',
    body: subjectCreateSchema,
    responses: { 201: subjectSchema },
  },
  get: {
    method: 'GET',
    path: '/subjects/:id',
    pathParams: subjectIdPathParamsSchema,
    responses: { 200: subjectSchema },
  },
  update: {
    method: 'PATCH',
    path: '/subjects/:id',
    pathParams: subjectIdPathParamsSchema,
    body: subjectPatchSchema,
    responses: { 200: subjectSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/subjects/:id',
    pathParams: subjectIdPathParamsSchema,
    responses: { 204: null },
  },
  listCurricula: {
    method: 'GET',
    path: '/subjects/:id/curricula',
    pathParams: subjectIdPathParamsSchema,
    responses: { 200: z.array(curriculumSchema) },
  },
  getCurriculumByGrade: {
    method: 'GET',
    path: '/subjects/:id/curricula/:grade',
    pathParams: subjectGradePathParamsSchema,
    responses: { 200: curriculumSchema },
  },
} as const;
