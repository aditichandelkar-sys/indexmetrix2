'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  Activity,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
} from 'lucide-react';

interface IndexingJobItem {
  id: string;
  status: string;
  attempts: number;
  lastError?: string;
  operationResult?: string;
  url?: {
    id: string;
    originalUrl: string;
    normalizedUrl: string;
    status: string;
    lastGoogleVerdict?: string;
    lastCoverageState?: string;
  };
}

interface IndexingJob {
  id: string;
  userId: string;
  projectId: string;
  type: string;
  status: string;
  totalUrls: number;
  queuedUrls: number;
  processingUrls: number;
  completedUrls: number;
  failedUrls: number;
  creditsCharged: number;
  creditsRefunded: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  project?: {
    id: string;
    name: string;
    domain: string;
  };
  items?: IndexingJobItem[];
}

export default function JobsQueuePage() {
  const [jobs, setJobs] = useState<IndexingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [expandedJobDetails, setExpandedJobDetails] = useState<IndexingJob | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadJobs = async () => {
    try {
      const res = await fetch('/api/jobs?limit=50');
      const data = await res.json();
      if (data.success && data.jobs) {
        setJobs(data.jobs);
      }
    } catch {
      // Failed to load jobs
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  // Poll active jobs every 3 seconds if any are queued or processing
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'QUEUED' || j.status === 'PROCESSING');
    if (!hasActive) return;

    const interval = setInterval(() => {
      loadJobs();
      if (expandedJobId) {
        fetchJobDetails(expandedJobId, false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs, expandedJobId]);

  const fetchJobDetails = async (jobId: string, setSpinner = true) => {
    if (setSpinner) setLoadingDetails(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      const data = await res.json();
      if (data.success && data.job) {
        setExpandedJobDetails(data.job);
      }
    } catch {
      // Error fetching details
    } finally {
      if (setSpinner) setLoadingDetails(false);
    }
  };

  const toggleExpandJob = (jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setExpandedJobDetails(null);
    } else {
      setExpandedJobId(jobId);
      fetchJobDetails(jobId, true);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setActionLoading(jobId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Retry failed' });
      } else {
        setActionMessage({ type: 'success', text: data.message || 'Retrying failed items' });
        loadJobs();
        fetchJobDetails(jobId, false);
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Network error executing retry' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel this job? Pending items will not be processed.')) return;
    setActionLoading(jobId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Cancellation failed' });
      } else {
        setActionMessage({ type: 'success', text: 'Job cancelled successfully' });
        loadJobs();
        fetchJobDetails(jobId, false);
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Network error cancelling job' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="Commercial Indexing Jobs & Worker Telemetry"
        description="Monitor real-time progress, Google URL inspection telemetry, and retries for URL indexing batches"
      >
        <button
          onClick={() => {
            setLoading(true);
            loadJobs();
          }}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
          title="Refresh Jobs"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </DashboardHeader>

      <div className="p-6 max-w-6xl space-y-6">
        {actionMessage && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-center justify-between animate-fade-in ${
              actionMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white text-xs">
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-panel p-5 rounded-2xl border border-white/5">
            <span className="text-xs text-slate-400">Queue Architecture</span>
            <div className="text-lg font-bold text-white mt-1">Worker + Realtime Queue</div>
            <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Live Telemetry Active
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-white/5">
            <span className="text-xs text-slate-400">Google Policy Gate</span>
            <div className="text-lg font-bold text-white mt-1">Strict Verification</div>
            <div className="text-[11px] text-cyan-400 mt-1">No fake &ldquo;Indexed&rdquo; claims</div>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-white/5">
            <span className="text-xs text-slate-400">Ledger Security</span>
            <div className="text-lg font-bold text-white mt-1">ACID Credit Deductions</div>
            <div className="text-[11px] text-slate-400 mt-1">Auto-refund on permanent failures</div>
          </div>
        </div>

        {/* Jobs Table */}
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-400" />
              <span>Indexing & Discovery Jobs</span>
            </h3>
            <span className="text-xs text-slate-400">
              Showing {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-5 py-3.5">Job ID</th>
                  <th className="px-4 py-3.5">Project</th>
                  <th className="px-4 py-3.5">Workflow Type</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Progress</th>
                  <th className="px-3 py-3.5">Credits</th>
                  <th className="px-4 py-3.5">Created</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-400" />
                      Loading jobs...
                    </td>
                  </tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                      No indexing jobs created yet. Go to <Link href="/urls" className="text-brand-400 underline">URLs</Link> and select URLs to start your first job.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const isExpanded = expandedJobId === job.id;
                    const processed = job.completedUrls + job.failedUrls;
                    const pct = job.totalUrls > 0 ? Math.round((processed / job.totalUrls) * 100) : 0;
                    const isActionLoading = actionLoading === job.id;

                    return (
                      <React.Fragment key={job.id}>
                        <tr
                          className={`hover:bg-white/[0.02] cursor-pointer transition-colors ${
                            isExpanded ? 'bg-white/[0.03]' : ''
                          }`}
                          onClick={() => toggleExpandJob(job.id)}
                        >
                          <td className="px-5 py-3.5 font-mono text-cyan-300 font-semibold">
                            #{job.id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-3.5 font-medium text-white truncate max-w-[150px]">
                            {job.project?.name || 'Workspace'}
                          </td>
                          <td className="px-4 py-3.5 text-[11px] font-mono text-slate-300">
                            {job.type === 'OFFICIAL_INDEXING_API' ? 'Official Indexing API' : 'Discovery & GSC Inspection'}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                job.status === 'COMPLETED'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : job.status === 'PROCESSING'
                                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 animate-pulse'
                                  : job.status === 'PARTIAL'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : job.status === 'FAILED'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : job.status === 'CANCELLED'
                                  ? 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                              }`}
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="w-28 space-y-1">
                              <div className="flex justify-between text-[10px] text-slate-400">
                                <span>{processed} / {job.totalUrls}</span>
                                <span>{pct}%</span>
                              </div>
                              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${
                                    job.status === 'COMPLETED'
                                      ? 'bg-emerald-500'
                                      : job.status === 'FAILED'
                                      ? 'bg-rose-500'
                                      : 'bg-brand-500'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5 font-mono text-[11px] text-slate-300">
                            {job.creditsCharged > 0 ? (
                              <span>
                                {job.creditsCharged}
                                {job.creditsRefunded > 0 && (
                                  <span className="text-[10px] text-emerald-400 block">
                                    (-{job.creditsRefunded} refunded)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-500">0 (Owner)</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-[11px] text-slate-400">
                            {new Date(job.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-5 py-3.5 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                            {job.failedUrls > 0 && (
                              <button
                                onClick={() => handleRetryJob(job.id)}
                                disabled={isActionLoading}
                                title="Retry Failed Items"
                                className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 disabled:opacity-50"
                              >
                                <RotateCcw className={`w-3.5 h-3.5 ${isActionLoading ? 'animate-spin' : ''}`} />
                              </button>
                            )}
                            {(job.status === 'QUEUED' || job.status === 'PROCESSING') && (
                              <button
                                onClick={() => handleCancelJob(job.id)}
                                disabled={isActionLoading}
                                title="Cancel Job"
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleExpandJob(job.id)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Item Details */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={8} className="p-0 bg-slate-950/60 border-y border-white/5">
                              <div className="p-5 space-y-4">
                                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>Job Item Breakdown ({job.totalUrls} URLs)</span>
                                  </h4>
                                  <div className="flex items-center gap-3 text-xs">
                                    <span className="text-emerald-400">✓ Completed: {job.completedUrls}</span>
                                    <span className="text-rose-400">✗ Failed: {job.failedUrls}</span>
                                    <span className="text-purple-400">⏳ Processing: {job.processingUrls}</span>
                                    <span className="text-slate-400">⏸ Queued: {job.queuedUrls}</span>
                                  </div>
                                </div>

                                {loadingDetails ? (
                                  <div className="py-6 text-center text-xs text-slate-400">
                                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-cyan-400" />
                                    Loading job items...
                                  </div>
                                ) : expandedJobDetails?.items?.length === 0 ? (
                                  <div className="py-4 text-center text-xs text-slate-500">
                                    No item breakdown records found.
                                  </div>
                                ) : (
                                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                                    {expandedJobDetails?.items?.map((item) => (
                                      <div
                                        key={item.id}
                                        className="p-2.5 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between text-xs"
                                      >
                                        <div className="flex items-center gap-2.5 truncate max-w-lg">
                                          <span
                                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                              item.status === 'COMPLETED'
                                                ? 'bg-emerald-400'
                                                : item.status === 'FAILED'
                                                ? 'bg-rose-400'
                                                : item.status === 'PROCESSING'
                                                ? 'bg-purple-400 animate-ping'
                                                : 'bg-slate-500'
                                            }`}
                                          />
                                          <span className="font-mono text-white truncate">
                                            {item.url?.normalizedUrl || 'URL Target'}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-3 flex-shrink-0 text-[11px]">
                                          {item.url?.lastGoogleVerdict && (
                                            <span className="font-mono text-cyan-300 font-semibold">
                                              Verdict: {item.url.lastGoogleVerdict}
                                            </span>
                                          )}
                                          {item.lastError && (
                                            <span className="text-rose-400 truncate max-w-xs" title={item.lastError}>
                                              Error: {item.lastError}
                                            </span>
                                          )}
                                          <span className="text-slate-500">
                                            Attempts: {item.attempts}
                                          </span>
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                                              item.status === 'COMPLETED'
                                                ? 'text-emerald-400 bg-emerald-500/10'
                                                : item.status === 'FAILED'
                                                ? 'text-rose-400 bg-rose-500/10'
                                                : 'text-slate-400 bg-slate-500/10'
                                            }`}
                                          >
                                            {item.status}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
