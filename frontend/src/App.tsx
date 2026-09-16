import { useEffect, useState, type FormEvent } from 'react';
import './App.css';
import { jobsApi } from './jobsApi';
import type { ApiError, Job, JobStatus, JobStatusFilter } from './types';

const STATUS_OPTIONS: Array<JobStatusFilter> = ['all', 'pending', 'running', 'completed', 'failed'];
const PAGE_SIZE = 10;

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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Record<JobStatusFilter, number>>({
    all: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', type: '' });

  const fetchJobs = async (
    requestedPage: number,
    requestedFilter: JobStatusFilter,
    showLoading = true,
  ) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await jobsApi.getJobs(requestedPage, PAGE_SIZE, requestedFilter);
      setJobs(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
      setCounts(data.counts);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Unable to load jobs.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    queueMicrotask(() => void fetchJobs(1, selectedFilter));
  }, [selectedFilter]);

  useEffect(() => {
    const eventSource = new EventSource(jobsApi.eventsUrl);
    const handleJobsChanged = () => void fetchJobs(page, selectedFilter, false);

    eventSource.addEventListener('message', handleJobsChanged);

    return () => {
      eventSource.removeEventListener('message', handleJobsChanged);
      eventSource.close();
    };
  }, [page, selectedFilter]);

  const handleCreateJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.title.trim() || !form.type.trim()) {
      setError('Title and type are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await jobsApi.createJob({
        title: form.title.trim(),
        type: form.type.trim(),
      });

      setSelectedFilter('all');
      await fetchJobs(1, 'all', false);
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
      await jobsApi.updateJobStatus(job.id, nextStatus);

      await fetchJobs(page, selectedFilter, false);
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
      await fetchJobs(page, selectedFilter, false);
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

      <section className="panel filter-panel" aria-labelledby="job-filter-heading">
        <h2 id="job-filter-heading">Filter jobs</h2>
        <div className="stats-panel">
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
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <div className="state-box">Loading jobs...</div>
        ) : jobs.length === 0 ? (
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
                {jobs.map((job) => {
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
        {totalPages > 1 && (
          <nav className="pagination" aria-label="Job list pagination">
            <button
              type="button"
              className="secondary-button"
              disabled={page === 1 || loading}
              onClick={() => void fetchJobs(page - 1, selectedFilter)}
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={page === totalPages || loading}
              onClick={() => void fetchJobs(page + 1, selectedFilter)}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}

export default App;
