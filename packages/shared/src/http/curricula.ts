import { z } from 'zod';
import {
  curriculumCreateSchema,
  curriculumNodeSchema,
  curriculumPatchSchema,
  curriculumSchema,
} from '../curriculum.js';

export const curriculumIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });

export const curriculaContract = {
  list: { method: 'GET', path: '/curricula', responses: { 200: z.array(curriculumSchema) } },
  create: {
    method: 'POST',
    path: '/curricula',
    body: curriculumCreateSchema,
    responses: { 201: curriculumSchema },
  },
  get: {
    method: 'GET',
    path: '/curricula/:id',
    pathParams: curriculumIdPathParamsSchema,
    responses: { 200: curriculumSchema },
  },
  update: {
    method: 'PATCH',
    path: '/curricula/:id',
    pathParams: curriculumIdPathParamsSchema,
    body: curriculumPatchSchema,
    responses: { 200: curriculumSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/curricula/:id',
    pathParams: curriculumIdPathParamsSchema,
    responses: { 204: null },
  },
  listNodes: {
    method: 'GET',
    path: '/curricula/:id/nodes',
    pathParams: curriculumIdPathParamsSchema,
    responses: { 200: z.array(curriculumNodeSchema) },
  },
} as const;
