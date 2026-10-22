import { z } from 'zod';
import {
  classCreateSchema,
  classEnrolmentSchema,
  classJoinCodeCreateSchema,
  classJoinCodeSchema,
  classJoinResultSchema,
  classPatchSchema,
  classSchema,
  classListItemSchema,
} from '../classes.js';

const classIdParams = z.strictObject({ id: z.uuidv7() });
const classMemberParams = z.strictObject({ id: z.uuidv7(), userId: z.uuidv7() });

export const classesContract = {
  list: { method: 'GET', path: '/classes', responses: { 200: z.array(classListItemSchema) } },
  create: {
    method: 'POST',
    path: '/classes',
    body: classCreateSchema,
    responses: { 201: classSchema },
  },
  get: {
    method: 'GET',
    path: '/classes/:id',
    pathParams: classIdParams,
    responses: { 200: classSchema },
  },
  update: {
    method: 'PATCH',
    path: '/classes/:id',
    pathParams: classIdParams,
    body: classPatchSchema,
    responses: { 200: classSchema },
  },
  createJoinCode: {
    method: 'POST',
    path: '/classes/:id/join-codes',
    pathParams: classIdParams,
    body: classJoinCodeCreateSchema,
    responses: { 201: classJoinCodeSchema },
  },
  join: {
    method: 'POST',
    path: '/classes/join',
    body: z.strictObject({ code: z.string().min(16).max(256) }),
    responses: { 201: classJoinResultSchema },
  },
  members: {
    method: 'GET',
    path: '/classes/:id/members',
    pathParams: classIdParams,
    responses: { 200: z.array(classEnrolmentSchema) },
  },
  approve: {
    method: 'POST',
    path: '/classes/:id/members/:userId/approve',
    pathParams: classMemberParams,
    responses: { 200: classEnrolmentSchema },
  },
  suspend: {
    method: 'POST',
    path: '/classes/:id/members/:userId/suspend',
    pathParams: classMemberParams,
    responses: { 200: classEnrolmentSchema },
  },
  revokeJoinCode: {
    method: 'DELETE',
    path: '/classes/:id/join-codes/:codeId',
    pathParams: z.strictObject({ id: z.uuidv7(), codeId: z.uuidv7() }),
    responses: { 204: null },
  },
  leave: {
    method: 'POST',
    path: '/classes/:id/leave',
    pathParams: classIdParams,
    responses: { 204: null },
  },
} as const;
