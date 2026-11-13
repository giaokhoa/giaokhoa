
export interface GradeHistoryView {
  id: string;
  action: number;
  itemId: string;
  userId: string;
  rawGrade: number | null;
  finalGrade: number | null;
  source: string | null;
  updatedAt: string;
  loggedUser: string | null;
}
