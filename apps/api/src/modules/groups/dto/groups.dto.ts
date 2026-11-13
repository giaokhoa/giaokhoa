import {
  createCohortSchema,
  createGroupingSchema,
  createGroupSchema,
  groupingGroupSchema,
  groupMemberSchema,
  updateCohortSchema,
  updateGroupSchema,
  type CreateCohort,
  type CreateGrouping,
  type CreateGroup,
  type GroupingGroup,
  type GroupMember,
  type UpdateCohort,
  type UpdateGroup,
} from '@giaokhoa/contracts';

/**
 * Validation của Groups & Cohorts dùng Zod qua Standard Schema — schema nền ở `@giaokhoa/contracts` là nguồn sự thật duy nhất.
 */
export {
  createCohortSchema,
  createGroupingSchema,
  createGroupSchema,
  groupingGroupSchema,
  groupMemberSchema,
  updateCohortSchema,
  updateGroupSchema,
};
export type CreateGroupDto = CreateGroup;
export type UpdateGroupDto = UpdateGroup;
export type MemberDto = GroupMember;
export type CreateGroupingDto = CreateGrouping;
export type GroupingGroupDto = GroupingGroup;
export type CreateCohortDto = CreateCohort;
export type UpdateCohortDto = UpdateCohort;
