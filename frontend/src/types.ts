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

export interface JobsResponse {
  data: Job[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  counts: Record<JobStatusFilter, number>;
}
