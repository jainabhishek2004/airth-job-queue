export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  title: string;
  type: string;
  status: JobStatus;
  createdAt: string;
}

export type JobStatusFilter = 'all' | JobStatus;

export interface CreateJobInput {
  title: string;
  type: string;
}

export interface ApiError {
  message: string;
  status?: number;
}
