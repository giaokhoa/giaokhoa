import { z } from 'zod';
import {
  attemptAnswerSchema,
  attemptGradeSchema,
  attemptResultSchema,
  attemptReviewSchema,
  attemptSchema,
  ownAttemptSummarySchema,
  attemptSolutionsSchema,
  attemptSummarySchema,
} from '../attempts.js';

const idParams = z.strictObject({ id: z.uuidv7() });
const assignmentParams = z.strictObject({ assignmentId: z.uuidv7() });
const responseParams = z.strictObject({
  id: z.uuidv7(),
  position: z.coerce.number().int().positive(),
});

export const attemptsContract = {
  listOwn: {
    method: 'GET',
    path: '/attempts',
    responses: { 200: z.array(ownAttemptSummarySchema) },
  },
  start: {
    method: 'POST',
    path: '/assignments/:assignmentId/attempts',
    pathParams: assignmentParams,
    responses: { 201: attemptSchema },
  },
  get: {
    method: 'GET',
    path: '/attempts/:id',
    pathParams: idParams,
    responses: { 200: attemptSchema },
  },
  save: {
    method: 'PUT',
    path: '/attempts/:id/responses/:position',
    pathParams: responseParams,
    body: attemptAnswerSchema,
    responses: { 200: attemptSchema },
  },
  submit: {
    method: 'POST',
    path: '/attempts/:id/submit',
    pathParams: idParams,
    responses: { 200: attemptSchema },
  },
  listForTeacher: {
    method: 'GET',
    path: '/assignments/:assignmentId/attempts',
    pathParams: assignmentParams,
    responses: { 200: z.array(attemptSummarySchema) },
  },
  review: {
    method: 'GET',
    path: '/attempts/:id/review',
    pathParams: idParams,
    responses: { 200: attemptReviewSchema },
  },
  grade: {
    method: 'PATCH',
    path: '/attempts/:id/grade',
    pathParams: idParams,
    body: attemptGradeSchema,
    responses: { 200: attemptReviewSchema },
  },
  result: {
    method: 'GET',
    path: '/attempts/:id/result',
    pathParams: idParams,
    responses: { 200: attemptResultSchema },
  },
  solutions: {
    method: 'GET',
    path: '/attempts/:id/solutions',
    pathParams: idParams,
    responses: { 200: attemptSolutionsSchema },
  },
} as const;
