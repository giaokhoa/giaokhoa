
export interface ProgressReportStudent {
  userId: string;
  username: string;
  fullName: string;
  completed: number;
  total: number;
  percent: number | null;
  lastAccessAt: string | null;
  states: Record<string, number>;
}

export interface ProgressReport {
  courseId: string;
  items: { cmId: string; name: string; component: string; completedCount: number; totalStudents: number; percent: number | null }[];
  students: ProgressReportStudent[];
}

export interface CourseGroup {
  id: string;
  name: string;
}
