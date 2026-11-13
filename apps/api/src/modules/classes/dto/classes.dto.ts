import {
  addClassRosterMemberSchema,
  createClassSchema,
  importClassRosterSchema,
  joinClassByCodeSchema,
  rosterStudentIdentitySchema,
  setClassStaffRolesSchema,
  updateClassSchema,
  type AddClassRosterMember,
  type CreateClass,
  type ImportClassRoster,
  type JoinClassByCode,
  type RosterStudentIdentity,
  type SetClassStaffRoles,
  type UpdateClass,
} from '@giaokhoa/contracts';

export {
  addClassRosterMemberSchema,
  createClassSchema,
  importClassRosterSchema,
  joinClassByCodeSchema,
  rosterStudentIdentitySchema,
  setClassStaffRolesSchema,
  updateClassSchema,
};
export type CreateClassDto = CreateClass;
export type UpdateClassDto = UpdateClass;
export type AddClassRosterMemberDto = AddClassRosterMember;
export type RosterStudentIdentityDto = RosterStudentIdentity;
export type ImportClassRosterDto = ImportClassRoster;
export type SetClassStaffRolesDto = SetClassStaffRoles;
export type JoinClassByCodeDto = JoinClassByCode;
