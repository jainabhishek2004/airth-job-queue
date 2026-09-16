import type { ApiError, CreateJobInput, Job, JobsResponse, JobStatus, JobStatusFilter } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      `Request failed with status ${response.status}`;

    const error: ApiError = {
      message,
      status: response.status,
    };

    throw error;
  }

  return data as T;
}

export const jobsApi = {
  eventsUrl: `${API_BASE_URL}/jobs/events`,
  async getJobs(page = 1, limit = 10, status: JobStatusFilter = 'all'): Promise<JobsResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status !== 'all') {
      params.set('status', status);
    }

    const response = await fetch(`${API_BASE_URL}/jobs?${params}`);
    return parseResponse<JobsResponse>(response);
  },

  async createJob(payload: CreateJobInput): Promise<Job> {
    const response = await fetch(`${API_BASE_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return parseResponse<Job>(response);
  },

  async updateJobStatus(id: string, status: JobStatus): Promise<Job> {
    const response = await fetch(`${API_BASE_URL}/jobs/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });

    return parseResponse<Job>(response);
  },

  async deleteJob(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/jobs/${id}`, {
      method: 'DELETE',
    });

    await parseResponse<void>(response);
  },
};
