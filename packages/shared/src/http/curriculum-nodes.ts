import { z } from 'zod';
import {
  curriculumNodeCreateSchema,
  curriculumNodePatchSchema,
  curriculumNodeSchema,
  learningOutcomeSchema,
} from '../curriculum.js';

export const curriculumNodeIdPathParamsSchema = z.strictObject({ id: z.uuidv7() });

export const curriculumNodesContract = {
  create: {
    method: 'POST',
    path: '/curriculum-nodes',
    body: curriculumNodeCreateSchema,
    responses: { 201: curriculumNodeSchema },
  },
  get: {
    method: 'GET',
    path: '/curriculum-nodes/:id',
    pathParams: curriculumNodeIdPathParamsSchema,
    responses: { 200: curriculumNodeSchema },
  },
  update: {
    method: 'PATCH',
    path: '/curriculum-nodes/:id',
    pathParams: curriculumNodeIdPathParamsSchema,
    body: curriculumNodePatchSchema,
    responses: { 200: curriculumNodeSchema },
  },
  delete: {
    method: 'DELETE',
    path: '/curriculum-nodes/:id',
    pathParams: curriculumNodeIdPathParamsSchema,
    responses: { 204: null },
  },
  listOutcomes: {
    method: 'GET',
    path: '/curriculum-nodes/:id/outcomes',
    pathParams: curriculumNodeIdPathParamsSchema,
    responses: { 200: z.array(learningOutcomeSchema) },
  },
} as const;
