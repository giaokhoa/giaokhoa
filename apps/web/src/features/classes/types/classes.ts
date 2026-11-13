import type { ClassStaffRole } from '@giaokhoa/contracts';


export type {
  AddRosterStudentResult,
  ClassJoinPreview,
  ClassJoinRequest,
  ClassListItem,
  ClassOverview,
  ClassPublicView,
  ClassRosterImportReport,
  ClassRosterMember,
  ClassStaffRole,
  ClassStaffView,
  ClassSuspendedMember,
  ClassView,
  JoinClassResult,
  RosterStudentIdentity,
} from '@giaokhoa/contracts';

export const CLASS_STAFF_ROLE_ORDER: ClassStaffRole[] = ['classassigner', 'classgrader', 'classrostermanager'];
export interface ClassFeePaymentView {
  id: string;
  amount: number;
  currency: string;
  status: string;
  component: string;
  itemId: string | null;
  paymentCode: string | null;
  vietqrPayload: string | null;
}
