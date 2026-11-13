import type { Course, CourseContent, EnrolInstance } from '@giaokhoa/contracts';


export interface MyEnrolmentView {
  courseId: string;
  userId: string;
  enrolled: boolean;
  active: boolean;
}

export interface MyPaymentView {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  component: string;
  itemId: string | null;
}

export interface CompletionActivityView {
  cmId: string;
  state: number;
  viewed: boolean;
}

export interface MyCompletionView {
  activities: CompletionActivityView[];
  course: { id: string; userId: string; course: string; status: string; timeCompleted: string | null };
}

export interface MyProgressView {
  percent: number | null;
  completed: number;
  total: number;
  sections: {
    sectionId: string; percent: number | null; completed: number; total: number;
    items: { cmId: string; completion: number; done: boolean }[];
  }[];
  resume: { cmId: string; reason: string } | null;
}

export interface ClassMarkersView {
  markers: { groupId: string | null; groupName: string; markerCmId: string | null }[];
}

export interface CoursePageData {
  course: Course | null;
  instances: EnrolInstance[];
  enrolment: MyEnrolmentView | null;
  content: CourseContent | null;
  completion: MyCompletionView | null;
  progress: MyProgressView | null;
  classMarkers: ClassMarkersView | null;
}
