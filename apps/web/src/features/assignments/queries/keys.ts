export const queryKeys = {
  assignmentDetail: (assignmentId: string) => ['assignments', assignmentId] as const,
  assignmentSubmissions: (assignmentId: string) => ['assignments', assignmentId, 'submissions'] as const,
  submissionDetail: (assignmentId: string, userId: string) =>
    ['assignments', assignmentId, 'submissions', userId] as const,
  commentBank: ['assign-comment-bank'] as const,
  currentUser: ['users', 'me'] as const,
};
