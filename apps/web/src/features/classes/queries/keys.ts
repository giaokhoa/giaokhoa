export const queryKeys = {
  payment: (paymentId: string) => ['payments', paymentId] as const,
  classRoot: (classId: string) => ['classes', classId] as const,
  classDetail: (classId: string) => ['classes', classId, 'detail'] as const,
  classOverview: (classId: string) => ['classes', classId, 'overview'] as const,
  classPublic: (classId: string) => ['classes', classId, 'public'] as const,
  classRoster: (classId: string) => ['classes', classId, 'roster'] as const,
  classSuspended: (classId: string) => ['classes', classId, 'suspended'] as const,
  classStaff: (classId: string) => ['classes', classId, 'staff'] as const,
  classJoinRequests: (classId: string) => ['classes', classId, 'join-requests'] as const,
};
