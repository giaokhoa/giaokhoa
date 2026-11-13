export const queryKeys = {
  playerView: (courseId: string, cmId: string) => ['courses', courseId, 'player', cmId] as const,
};
