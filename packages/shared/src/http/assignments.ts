import { z } from 'zod';
import {
  assignmentCreateSchema,
  assignmentPatchSchema,
  assignmentRecipientSchema,
  assignmentSchema,
  studentAssignmentSchema,
} from '../assignments.js';

const idParams = z.strictObject({ id: z.uuidv7() });
const recipientParams = z.strictObject({ id: z.uuidv7(), userId: z.uuidv7() });

export const assignmentsContract = {
  create: {
    method: 'POST',
    path: '/assignments',
    body: assignmentCreateSchema,
    responses: { 201: assignmentSchema },
  },
  get: {
    method: 'GET',
    path: '/assignments/:id',
    pathParams: idParams,
    responses: { 200: assignmentSchema },
  },
  update: {
    method: 'PATCH',
    path: '/assignments/:id',
    pathParams: idParams,
    body: assignmentPatchSchema,
    responses: { 200: assignmentSchema },
  },
  publish: {
    method: 'POST',
    path: '/assignments/:id/publish',
    pathParams: idParams,
    responses: { 200: assignmentSchema },
  },
  recipients: {
    method: 'GET',
    path: '/assignments/:id/recipients',
    pathParams: idParams,
    responses: { 200: z.array(assignmentRecipientSchema) },
  },
  revoke: {
    method: 'POST',
    path: '/assignments/:id/recipients/:userId/revoke',
    pathParams: recipientParams,
    responses: { 204: null },
  },
  delivery: {
    method: 'GET',
    path: '/assignments/:id/delivery',
    pathParams: idParams,
    responses: { 200: studentAssignmentSchema },
  },
} as const;
