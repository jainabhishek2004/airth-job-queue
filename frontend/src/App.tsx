import { useEffect, useMemo, useState, type FormEvent } from 'react';
import './App.css';
import { jobsApi } from './jobsApi';
import type { ApiError, Job, JobStatus, JobStatusFilter } from './types';

const STATUS_OPTIONS: Array<JobStatusFilter> = ['all', 'pending', 'running', 'completed', 'failed'];

const statusLabels: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const allowedNextStatuses: Record<JobStatus, JobStatus[]> = {
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<JobStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', type: '' });

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await jobsApi.getJobs();
      setJobs(data);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Unable to load jobs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadJobs = async () => {
      await fetchJobs();
    };

    void loadJobs();
  }, []);

  const counts = useMemo(() => {
    return {
      all: jobs.length,
      pending: jobs.filter((job) => job.status === 'pending').length,
      running: jobs.filter((job) => job.status === 'running').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (selectedFilter === 'all') {
      return jobs;
    }

    return jobs.filter((job) => job.status === selectedFilter);
  }, [jobs, selectedFilter]);

  const handleCreateJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.title.trim() || !form.type.trim()) {
      setError('Title and type are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const createdJob = await jobsApi.createJob({
        title: form.title.trim(),
        type: form.type.trim(),
      });

      setJobs((currentJobs) => [createdJob, ...currentJobs]);
      setForm({ title: '', type: '' });
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Unable to create job.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusUpdate = async (job: Job, nextStatus: JobStatus) => {
    setUpdatingIds((current) => [...current, job.id]);
    setError(null);

    try {
      const updatedJob = await jobsApi.updateJobStatus(job.id, nextStatus);

      setJobs((currentJobs) =>
        currentJobs.map((currentJob) =>
          currentJob.id === updatedJob.id ? updatedJob : currentJob,
        ),
      );
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Unable to update job status.');
    } finally {
      setUpdatingIds((current) => current.filter((id) => id !== job.id));
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setDeletingIds((current) => [...current, jobId]);
    setError(null);

    try {
      await jobsApi.deleteJob(jobId);
      setJobs((currentJobs) => currentJobs.filter((job) => job.id !== jobId));
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Unable to delete job.');
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== jobId));
    }
  };

  return (
    <main className="app-shell">
      <header className="header">
        <div>
          <p className="eyebrow">Airth</p>
          <h1>Mini Job Queue</h1>
        </div>
      </header>

      <section className="panel create-panel">
        <h2>Create job</h2>
        <form className="job-form" onSubmit={handleCreateJob}>
          <label>
            <span>Title</span>
            <input
              type="text"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="e.g. Send onboarding email"
              disabled={submitting}
            />
          </label>

          <label>
            <span>Type</span>
            <input
              type="text"
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
              placeholder="e.g. email"
              disabled={submitting}
            />
          </label>

          <button type="submit" disabled={submitting || !form.title.trim() || !form.type.trim()}>
            {submitting ? 'Creating...' : 'Create job'}
          </button>
        </form>
      </section>

      <section className="panel stats-panel" aria-label="Job status summary">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            type="button"
            className={selectedFilter === status ? 'filter-chip active' : 'filter-chip'}
            onClick={() => setSelectedFilter(status)}
          >
            <span>{status === 'all' ? 'All' : statusLabels[status]}</span>
            <strong>{counts[status]}</strong>
          </button>
        ))}
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <div className="state-box">Loading jobs...</div>
        ) : filteredJobs.length === 0 ? (
          <div className="state-box">No jobs match the selected status.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const nextStatuses = allowedNextStatuses[job.status] ?? [];

                  return (
                    <tr key={job.id}>
                      <td>{job.title}</td>
                      <td>{job.type}</td>
                      <td>
                        <span className={`status-badge ${job.status}`}>{statusLabels[job.status]}</span>
                      </td>
                      <td>{new Date(job.createdAt).toLocaleString()}</td>
                      <td className="actions-cell">
                        <div className="status-actions">
                          {nextStatuses.length > 0 ? (
                            nextStatuses.map((nextStatus) => (
                              <button
                                key={nextStatus}
                                type="button"
                                className="secondary-button"
                                disabled={updatingIds.includes(job.id)}
                                onClick={() => handleStatusUpdate(job, nextStatus)}
                              >
                                {updatingIds.includes(job.id) ? 'Updating...' : `Mark ${statusLabels[nextStatus]}`}
                              </button>
                            ))
                          ) : (
                            <span className="muted">Terminal</span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDeleteJob(job.id)}
                          disabled={deletingIds.includes(job.id)}
                        >
                          {deletingIds.includes(job.id) ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
