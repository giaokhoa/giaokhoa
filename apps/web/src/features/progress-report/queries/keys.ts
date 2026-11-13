export const queryKeys = {
  courseProgressReport: (courseId: string, groupId: string) =>
    ['courses', courseId, 'progress', 'report', groupId] as const,
};
