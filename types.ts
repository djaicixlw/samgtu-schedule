export type DegreeType = 'Бакалавриат' | 'Специалитет' | 'Магистратура';

export type UserRole = 'admin' | 'starosta' | 'student';

export interface UserProfile {
  uid: string;
  email?: string;
  role: UserRole;
  facultyId?: string;
  groupId?: string;
  displayName?: string;
  updatedAt?: any;
}

export interface Faculty {
  id: string;
  name: string;
  shortName: string;
}

export interface GroupConfig {
  id: string;
  name: string;
  facultyId: string;
  degree: DegreeType;
  course: number;
}

export interface Student {
  id: number;
  name: string;
  slot?: string;
}

export type Registry<T> = Record<string, T>;

export enum LessonType {
  Lecture = "Лекции",
  Practice = "Практические занятия",
  Lab = "Лабораторные работы",
  Consultation = "Консультация"
}

export interface Lesson {
  id: string;
  timeStart: string;
  timeEnd: string;
  subject: string;
  type: string;
  location: string;
  teacher: string;
  groups?: string;
  subgroup?: number;
  note?: string;
  isCancelled?: boolean;
  isHidden?: boolean;
  order?: number;
  attachments?: HomeworkAttachment[];
}

export interface DaySchedule {
  dayName: string;
  lessons: Lesson[];
}

export interface WeekData {
  [key: number]: DaySchedule[];
}

export interface HomeworkAttachment {
  id?: string;
  name: string;
  url?: string;
  tgUrl?: string;
  data?: string; // base64 string for offline storage
  type?: string;
  size?: string | number;
}

export interface HomeworkItem {
  id: string;
  groupId: string;
  subject: string;
  lessonId?: string;
  assignedDate: string; // YYYY-MM-DD
  dueDate: string;      // YYYY-MM-DD (Дедлайн)
  title: string;
  description: string;
  teacher?: string;
  attachments?: HomeworkAttachment[];
  createdAt: string;
  createdBy?: string;
}