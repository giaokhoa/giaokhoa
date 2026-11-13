export const queryKeys = {
  gradeItemHistory: (itemId: string, userId: string) =>
    ['grades', 'items', itemId, 'users', userId, 'history'] as const,
};
