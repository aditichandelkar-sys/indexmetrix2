'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  Globe,
  Search,
  Filter,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Info,
  Layers,
  ArrowRight,
  Activity,
  ShieldCheck,
  Bot,
  Calendar,
  Link as LinkIcon,
  Check,
  Upload,
  FileText,
  Rss,
  Clock,
  Sparkles,
  X,
} from 'lucide-react';

function UrlsManagerContent() {
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get('projectId') || '';
  const initialUrlId = searchParams.get('id') || '';

  const [urls, setUrls] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUrls, setTotalUrls] = useState(0);

  // Selected URLs for Batch Jobs
  const [selectedUrlIds, setSelectedUrlIds] = useState<string[]>([]);

  // Direct URL Inspection & Indexing form
  const [inputUrl, setInputUrl] = useState('');
  const [inputProjectId, setInputProjectId] = useState('');
  const [isDirectInspecting, setIsDirectInspecting] = useState(false);
  const [isSubmittingIndexing, setIsSubmittingIndexing] = useState(false);
  const [isPreflightAnalyzing, setIsPreflightAnalyzing] = useState(false);
  const [preflightData, setPreflightData] = useState<any | null>(null);
  const [inspectionModalData, setInspectionModalData] = useState<any | null>(null);

  // Bulk Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSourceType, setImportSourceType] = useState<'RAW_TEXT' | 'CSV_FILE' | 'SITEMAP' | 'RSS_FEED'>('RAW_TEXT');
  const [importContent, setImportContent] = useState('');
  const [importSourceUrl, setImportSourceUrl] = useState('');
  const [importProjectId, setImportProjectId] = useState(initialProjectId);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Batch Job Creation Modal
  const [showJobModal, setShowJobModal] = useState(false);
  const [jobType, setJobType] = useState<'DISCOVERY_AND_INSPECTION' | 'OFFICIAL_INDEXING_API' | 'REINSPECT'>('DISCOVERY_AND_INSPECTION');
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [jobCreatedSuccess, setJobCreatedSuccess] = useState<any | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  // Detail drawer / modal
  const [selectedUrl, setSelectedUrl] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUrls = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: page.toString(),
        limit: '15',
        ...(projectId ? { projectId } : {}),
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
        ...(searchQuery ? { search: searchQuery } : {}),
      });

      const res = await fetch(`/api/urls?${query.toString()}`);
      const data = await res.json();
      if (data.success) {
        setUrls(data.urls || []);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotalUrls(data.pagination?.total || 0);

        if (initialUrlId && !selectedUrl) {
          const matched = data.urls?.find((u: any) => u.id === initialUrlId);
          if (matched) setSelectedUrl(matched);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        setProjects(data.projects || []);
        if (!inputProjectId && data.projects?.length > 0) {
          setInputProjectId(data.projects[0].id);
        }
        if (!importProjectId && data.projects?.length > 0) {
          setImportProjectId(data.projects[0].id);
        }
      }
    } catch {}
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    loadUrls();
  }, [projectId, statusFilter, page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadUrls();
  };

  // Direct URL Inspection handler
  const handleDirectInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    if (!inputProjectId || inputProjectId.trim() === '') {
      setActionMessage({
        type: 'error',
        text: 'Please select a project before adding URLs.',
      });
      return;
    }

    setIsDirectInspecting(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/urls/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: inputUrl.trim(),
          projectId: inputProjectId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setActionMessage({
          type: 'error',
          text: data.error?.message || data.error || 'Google URL Inspection failed',
        });
      } else {
        setInspectionModalData({
          url: inputUrl.trim(),
          result: data.inspectionResult,
          inspectionResultLink: data.inspectionResultLink,
          property: data.matchedProperty,
          urlRecord: data.url,
        });

        setActionMessage({
          type: 'success',
          text: `Google URL Inspection completed for ${inputUrl.trim()}`,
        });

        loadUrls();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Inspection network error' });
    } finally {
      setIsDirectInspecting(false);
    }
  };

  // Submit for Indexing & Discovery handler (supports any third-party or owned public URL)
  const handleSubmitForIndexing = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputUrl.trim()) return;

    if (!inputProjectId || inputProjectId.trim() === '') {
      setActionMessage({
        type: 'error',
        text: 'Please select a project before adding URLs.',
      });
      return;
    }

    setIsSubmittingIndexing(true);
    setActionMessage(null);

    try {
      // 1. Add URL record
      const addRes = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: inputUrl.trim(),
          projectId: inputProjectId,
        }),
      });

      const addData = await addRes.json();
      if (!addRes.ok || !addData.success) {
        setActionMessage({
          type: 'error',
          text: addData.error?.message || addData.error || 'Failed to submit URL',
        });
        return;
      }

      const createdUrl = addData.url;

      // 2. Automatically dispatch background discovery job
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: inputProjectId,
          urlIds: [createdUrl.id],
          type: 'DISCOVERY_AND_INSPECTION',
          idempotencyKey: `submit_${createdUrl.id}_${Date.now()}`,
        }),
      });

      const jobData = await jobRes.json();
      if (!jobRes.ok || !jobData.success) {
        setActionMessage({
          type: 'error',
          text: `URL saved, but discovery job initialization failed: ${jobData.error}`,
        });
      } else {
        setActionMessage({
          type: 'success',
          text: `Submitted for Discovery! Technical audit and discovery signals initiated.`,
        });
        loadUrls();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Submission network error' });
    } finally {
      setIsSubmittingIndexing(false);
    }
  };

  // Pre-flight technical analyzer
  const handlePreflightAnalyze = async () => {
    if (!inputUrl.trim()) return;
    setIsPreflightAnalyzing(true);
    setActionMessage(null);
    setPreflightData(null);

    try {
      const res = await fetch('/api/urls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Pre-flight analysis failed' });
      } else {
        setPreflightData(data.analysis);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Network error' });
    } finally {
      setIsPreflightAnalyzing(false);
    }
  };

  // Reinspect a URL
  const handleReinspect = async (urlId: string, scheduleHours?: number) => {
    setActionLoading(urlId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/urls/${urlId}/reinspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleHours }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Reinspection failed' });
      } else {
        setActionMessage({
          type: 'success',
          text: scheduleHours
            ? `Reinspection scheduled in ${scheduleHours}h`
            : `Reinspected! Verdict: ${data.inspectionResult?.verdict || 'NEUTRAL'} (${data.inspectionResult?.coverageState || 'No state'})`,
        });
        loadUrls();
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Network request error' });
    } finally {
      setActionLoading(null);
    }
  };

  // Discovery workflow
  const handleDiscoveryWorkflow = async (urlId: string) => {
    setActionLoading(urlId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/urls/${urlId}/discovery`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Discovery workflow failed' });
      } else {
        setActionMessage({
          type: 'success',
          text: `Discovery workflow completed. HTTP ${data.analysis?.httpStatus}. ${data.recommendations?.length || 0} recommended action(s).`,
        });
        loadUrls();
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Network request error' });
    } finally {
      setActionLoading(null);
    }
  };

  // Bulk Import
  const handleExecuteImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importProjectId) {
      setImportError('Please select a project for the imported URLs');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const res = await fetch('/api/urls/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: importProjectId,
          sourceType: importSourceType,
          content: importContent || undefined,
          sourceUrl: importSourceUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setImportError(data.error || 'Import failed');
      } else {
        setImportResult(data);
        loadUrls();
      }
    } catch (err: any) {
      setImportError(err.message || 'Import network error');
    } finally {
      setIsImporting(false);
    }
  };

  // Batch Job Creation
  const handleCreateBatchJob = async () => {
    if (selectedUrlIds.length === 0) return;
    const activeProject = projectId || projects[0]?.id;
    if (!activeProject) {
      setJobError('Please select a project');
      return;
    }

    setIsCreatingJob(true);
    setJobError(null);
    setJobCreatedSuccess(null);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject,
          urlIds: selectedUrlIds,
          type: jobType,
          idempotencyKey: `job_${Date.now()}_${selectedUrlIds.length}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setJobError(data.error || 'Failed to create job');
      } else {
        setJobCreatedSuccess(data.job);
        setSelectedUrlIds([]);
        loadUrls();
      }
    } catch (err: any) {
      setJobError(err.message || 'Network error creating job');
    } finally {
      setIsCreatingJob(false);
    }
  };

  // Checkbox Selection Helpers
  const toggleSelectAll = () => {
    if (selectedUrlIds.length === urls.length) {
      setSelectedUrlIds([]);
    } else {
      setSelectedUrlIds(urls.map((u) => u.id));
    }
  };

  const toggleSelectUrl = (id: string) => {
    setSelectedUrlIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="URL Intelligence & Indexing Registry"
        description="Inspect URLs via official Google Search Console API, analyze crawlability, and run verified discovery jobs"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-white/10 transition-colors"
          >
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>Bulk Import</span>
          </button>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 transition-all"
          >
            <Activity className="w-4 h-4" />
            <span>Jobs Center</span>
          </Link>
        </div>
      </DashboardHeader>

      <div className="p-6 space-y-5">
        {/* Status notification */}
        {actionMessage && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-center justify-between animate-fade-in ${
              actionMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            <span className="leading-relaxed">{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-white text-xs ml-4 shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {/* Real Commercial URL Indexing & Live Google Inspection Card */}
        <div className="glass-panel p-5 rounded-2xl border border-white/10 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Commercial URL Indexing & Real Discovery Engine</h3>
                <p className="text-[11px] text-slate-400">
                  Submit any public web page (including third-party forums, blogs, PDFs) for automated discovery, or query live Google telemetry for owned properties
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20 font-mono text-[10px]">
                <ShieldCheck className="w-3 h-3 text-brand-400" /> SSRF Protected
              </span>
            </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSubmitForIndexing(); }} className="space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="Paste URL (e.g. https://happyalone.proboards.com/... or https://www.indexmetrix.com/)"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              {projects.length === 0 ? (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs shrink-0">
                  <span>No projects.</span>
                  <Link href="/projects" className="underline font-semibold hover:text-white">Create project</Link>
                </div>
              ) : (
                <select
                  id="project-selector"
                  value={inputProjectId}
                  onChange={(e) => setInputProjectId(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500 shrink-0"
                >
                  <option value="">-- Select Project --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.domain})
                    </option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <button
                  type="submit"
                  disabled={isSubmittingIndexing || !inputUrl.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-brand-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Zap className={`w-3.5 h-3.5 ${isSubmittingIndexing ? 'animate-spin' : ''}`} />
                  <span>{isSubmittingIndexing ? 'Submitting...' : 'Submit for Indexing'}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePreflightAnalyze}
                  disabled={isPreflightAnalyzing || !inputUrl.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-white text-xs font-medium transition-colors disabled:opacity-50"
                  title="Run instant technical crawlability and indexability audit"
                >
                  <SlidersHorizontal className={`w-3.5 h-3.5 text-cyan-400 ${isPreflightAnalyzing ? 'animate-spin' : ''}`} />
                  <span>{isPreflightAnalyzing ? 'Analyzing...' : 'Pre-Flight'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDirectInspect}
                  disabled={isDirectInspecting || !inputUrl.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 text-cyan-300 text-xs font-medium transition-colors disabled:opacity-50"
                  title="Official Google URL Inspection for authorized Search Console properties"
                >
                  <Search className={`w-3.5 h-3.5 ${isDirectInspecting ? 'animate-spin' : ''}`} />
                  <span>{isDirectInspecting ? 'Inspecting...' : 'GSC Inspect'}</span>
                </button>
              </div>
            </div>

            {/* Quick test pills */}
            <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400 flex-wrap">
              <span>Quick Test:</span>
              <button
                type="button"
                onClick={() => setInputUrl('https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services')}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-indigo-300 font-mono text-[10px] transition-colors"
                title="Third-Party Forum URL"
              >
                happyalone.proboards.com/... (Third-Party Forum)
              </button>
              <button
                type="button"
                onClick={() => setInputUrl('https://www.indexmetrix.com/')}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-cyan-300 font-mono text-[10px] transition-colors"
                title="Owned Verified GSC Property"
              >
                https://www.indexmetrix.com/ (Owned GSC)
              </button>
              <button
                type="button"
                onClick={() => setInputUrl('https://www.indexmetrix.com/terms')}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-cyan-300 font-mono text-[10px] transition-colors"
              >
                https://www.indexmetrix.com/terms
              </button>
            </div>
          </form>

          {/* Pre-flight Technical Audit Card */}
          {preflightData && (
            <div className="p-4 rounded-xl bg-[#060a12] border border-cyan-500/30 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white">Pre-Flight URL Analysis Summary</span>
                  <span className="text-[10px] text-slate-400">({preflightData.responseTimeMs}ms)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    preflightData.discoveryEligible
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    {preflightData.discoveryEligible ? 'DISCOVERY READY' : 'BLOCKED / NOT ELIGIBLE'}
                  </span>
                  <button
                    onClick={() => setPreflightData(null)}
                    className="text-slate-500 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">HTTP Status</div>
                  <div className="font-bold text-white flex items-center gap-1 mt-0.5">
                    <span className={preflightData.httpStatus === 200 ? 'text-emerald-400' : 'text-amber-400'}>
                      {preflightData.httpStatus || 'N/A'}
                    </span>
                    <span className="text-[10px] text-slate-400">{preflightData.reachable ? 'Reachable' : 'Unreachable'}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">Robots.txt</div>
                  <div className={`font-bold text-xs mt-0.5 ${preflightData.robotsAllowed ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {preflightData.robotsAllowed ? 'Allowed' : 'Disallowed'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">Noindex Directive</div>
                  <div className={`font-bold text-xs mt-0.5 ${preflightData.noindex ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {preflightData.noindex ? 'Detected (Blocked)' : 'Clean (Indexable)'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">Canonical Tag</div>
                  <div className={`font-bold text-xs mt-0.5 ${preflightData.canonicalMatches ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {preflightData.canonicalMatches ? 'Matches Target' : 'External Target'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">Content Type</div>
                  <div className="font-bold text-xs text-slate-200 mt-0.5 truncate" title={preflightData.contentType}>
                    {preflightData.documentType === 'PDF_DOCUMENT' ? 'PDF Document' : 'HTML Document'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] text-slate-400">XML Sitemaps</div>
                  <div className="font-bold text-xs text-slate-200 mt-0.5">
                    {preflightData.hasSitemap ? `${preflightData.sitemapUrls.length} Declared` : 'None Declared'}
                  </div>
                </div>
              </div>

              {preflightData.title && (
                <div className="text-[11px] text-slate-300">
                  <span className="text-slate-500 font-semibold mr-1.5">Page Title:</span>
                  <span>{preflightData.title}</span>
                  {preflightData.wordCount > 0 && (
                    <span className="text-slate-500 ml-2">({preflightData.wordCount} words)</span>
                  )}
                </div>
              )}

              {preflightData.warnings && preflightData.warnings.length > 0 && (
                <div className="space-y-1 pt-1">
                  {preflightData.warnings.map((w: string, idx: number) => (
                    <div key={idx} className="text-[10px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected URLs Action Banner */}
        {selectedUrlIds.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-brand-600/10 border border-brand-500/30 flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-brand-500 text-white font-bold text-xs flex items-center justify-center">
                {selectedUrlIds.length}
              </span>
              <span className="text-xs font-semibold text-white">
                {selectedUrlIds.length} URL{selectedUrlIds.length > 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedUrlIds([])}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Deselect All
              </button>
              <button
                onClick={() => setShowJobModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Start Indexing / Discovery Job</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col md:flex-row gap-3 items-center justify-between">
          <form onSubmit={handleSearch} className="flex items-center gap-2 w-full md:w-auto flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search registry by path or domain..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold"
            >
              Search
            </button>
          </form>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.domain})
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="INDEXED">INDEXED</option>
              <option value="NOT_INDEXED">NOT_INDEXED</option>
              <option value="DISCOVERY_PENDING">DISCOVERY_PENDING</option>
              <option value="UNINSPECTED">UNINSPECTED</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="ERROR">ERROR</option>
            </select>

            <button
              onClick={loadUrls}
              title="Refresh"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* URLs Table */}
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-3 py-3.5 text-center w-10">
                    <input
                      type="checkbox"
                      checked={urls.length > 0 && selectedUrlIds.length === urls.length}
                      onChange={toggleSelectAll}
                      className="rounded border-white/20 bg-slate-900 text-brand-500 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3.5">URL Target</th>
                  <th className="px-4 py-3.5">Project</th>
                  <th className="px-4 py-3.5">System Status</th>
                  <th className="px-4 py-3.5">Google Verdict</th>
                  <th className="px-3 py-3.5">HTTP</th>
                  <th className="px-4 py-3.5">Last Checked</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-400" />
                      Loading URL registry...
                    </td>
                  </tr>
                ) : urls.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                      No URLs match the current filter. Click &ldquo;Bulk Import&rdquo; or inspect a URL above.
                    </td>
                  </tr>
                ) : (
                  urls.map((u) => {
                    const isSelected = selectedUrlIds.includes(u.id);
                    const isRowLoading = actionLoading === u.id;
                    const latestInspection = u.inspections?.[0];

                    return (
                      <tr
                        key={u.id}
                        className={`hover:bg-white/[0.02] transition-colors ${
                          isSelected ? 'bg-brand-500/[0.03]' : ''
                        }`}
                      >
                        <td className="px-3 py-3.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectUrl(u.id)}
                            className="rounded border-white/20 bg-slate-900 text-brand-500 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3.5 max-w-sm truncate font-medium text-white">
                          <button
                            onClick={() => setSelectedUrl(u)}
                            className="hover:text-brand-400 truncate text-left block w-full"
                          >
                            {u.normalizedUrl}
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-slate-400 truncate max-w-[140px]">
                          {u.project?.name || 'Default'}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              u.status === 'INDEXED'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : u.status === 'NOT_INDEXED'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : u.status === 'DISCOVERY_PENDING'
                                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                : u.status === 'BLOCKED'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : u.status === 'PROCESSING'
                                ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                            }`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {latestInspection || u.lastGoogleVerdict ? (
                            <span
                              className={`text-[11px] font-mono ${
                                (latestInspection?.verdict || u.lastGoogleVerdict) === 'PASS'
                                  ? 'text-emerald-400 font-bold'
                                  : 'text-slate-300'
                              }`}
                            >
                              {latestInspection?.verdict || u.lastGoogleVerdict}
                              {latestInspection?.coverageState && (
                                <span className="text-[10px] text-slate-400 block truncate max-w-[160px]">
                                  {latestInspection.coverageState}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[10px]">Uninspected</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[11px]">
                          {u.httpStatus ? (
                            <span
                              className={
                                u.httpStatus >= 200 && u.httpStatus < 300
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }
                            >
                              {u.httpStatus}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-slate-400 text-[11px]">
                          {u.lastInspectedAt
                            ? new Date(u.lastInspectedAt).toLocaleDateString()
                            : u.lastAnalyzedAt
                            ? new Date(u.lastAnalyzedAt).toLocaleDateString()
                            : 'Never'}
                        </td>
                        <td className="px-5 py-3.5 text-right space-x-1">
                          <button
                            onClick={() => handleReinspect(u.id)}
                            disabled={isRowLoading}
                            title="Inspect Now with Google Search Console"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRowLoading ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleDiscoveryWorkflow(u.id)}
                            disabled={isRowLoading}
                            title="Run Technical Discovery Audit"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-brand-400 hover:text-brand-300 disabled:opacity-50"
                          >
                            <Zap className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setSelectedUrl(u)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between bg-[#090e1a] text-xs text-slate-400">
            <div>
              Total: <span className="text-white font-semibold">{totalUrls}</span> URLs
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-lg p-6 rounded-2xl border border-white/10 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-cyan-400" />
                <span>Bulk Import URLs</span>
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {importError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Import Completed Successfully!</span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-emerald-500/20 text-center font-mono">
                  <div>
                    <div className="text-sm font-bold text-white">{importResult.accepted}</div>
                    <div className="text-[10px] text-slate-400">Accepted</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-amber-400">{importResult.duplicates}</div>
                    <div className="text-[10px] text-slate-400">Duplicates</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-rose-400">{importResult.invalid}</div>
                    <div className="text-[10px] text-slate-400">Invalid</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-purple-400">{importResult.blocked}</div>
                    <div className="text-[10px] text-slate-400">SSRF Blocked</div>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleExecuteImport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Target Project</label>
                <select
                  required
                  value={importProjectId}
                  onChange={(e) => setImportProjectId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Select Project --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.domain})
                    </option>
                  ))}
                </select>
              </div>

              {/* Source Type Tabs */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Import Source</label>
                <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-900/60 border border-white/5">
                  <button
                    type="button"
                    onClick={() => setImportSourceType('RAW_TEXT')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      importSourceType === 'RAW_TEXT' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Paste Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSourceType('CSV_FILE')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      importSourceType === 'CSV_FILE' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    CSV Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSourceType('SITEMAP')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      importSourceType === 'SITEMAP' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sitemap XML
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSourceType('RSS_FEED')}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      importSourceType === 'RSS_FEED' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    RSS / Feed
                  </button>
                </div>
              </div>

              {/* Input for Sitemap or RSS */}
              {importSourceType === 'SITEMAP' || importSourceType === 'RSS_FEED' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {importSourceType === 'SITEMAP' ? 'Sitemap URL (supports sitemapindex)' : 'RSS / Atom Feed URL'}
                  </label>
                  <input
                    type="url"
                    required
                    value={importSourceUrl}
                    onChange={(e) => setImportSourceUrl(e.target.value)}
                    placeholder={
                      importSourceType === 'SITEMAP'
                        ? 'https://example.com/sitemap.xml'
                        : 'https://example.com/feed.xml'
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    SSRF protection active. Child sitemaps will be processed recursively up to 5,000 URLs.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {importSourceType === 'CSV_FILE' ? 'Paste CSV Content' : 'Paste URLs (one per line)'}
                  </label>
                  <textarea
                    required
                    value={importContent}
                    onChange={(e) => setImportContent(e.target.value)}
                    placeholder={
                      importSourceType === 'CSV_FILE'
                        ? 'url,title\nhttps://example.com/page-1,Page 1\nhttps://example.com/page-2,Page 2'
                        : 'https://example.com/page-1\nhttps://example.com/page-2\nhttps://example.com/page-3'
                    }
                    rows={6}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-xs font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isImporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 disabled:opacity-50"
                >
                  {isImporting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isImporting ? 'Importing & Validating...' : 'Start Import'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Job Creation Modal */}
      {showJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md p-6 rounded-2xl border border-white/10 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-400" />
                <span>Start Indexing / Discovery Job</span>
              </h3>
              <button onClick={() => setShowJobModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {jobError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {jobError}
              </div>
            )}

            {jobCreatedSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-3">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Job Queued Successfully!</span>
                </div>
                <p className="text-slate-300">
                  Job #{jobCreatedSuccess.id.slice(0, 8)} is running in the background queue.
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <Link
                    href={`/jobs`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                  >
                    <span>View in Jobs Center</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    onClick={() => setShowJobModal(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold text-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 text-xs text-slate-300 space-y-1">
                  <div>Selected URLs: <span className="font-bold text-white">{selectedUrlIds.length}</span></div>
                  <div>Estimated Credits: <span className="font-bold text-white">{selectedUrlIds.length} credit(s)</span> (Owner: 0)</div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Workflow Engine</label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-900/40 border border-white/5 hover:border-brand-500/30 cursor-pointer">
                      <input
                        type="radio"
                        name="jobType"
                        checked={jobType === 'DISCOVERY_AND_INSPECTION'}
                        onChange={() => setJobType('DISCOVERY_AND_INSPECTION')}
                        className="mt-0.5 text-brand-500"
                      />
                      <div>
                        <div className="text-xs font-bold text-white">Discovery & Google URL Inspection (Recommended)</div>
                        <p className="text-[11px] text-slate-400">
                          Legitimate workflow for standard pages, blogs, and PDFs. Checks crawlability, canonicals, robots.txt, Search Console properties, and queries Google URL inspection.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-900/40 border border-white/5 hover:border-brand-500/30 cursor-pointer">
                      <input
                        type="radio"
                        name="jobType"
                        checked={jobType === 'OFFICIAL_INDEXING_API'}
                        onChange={() => setJobType('OFFICIAL_INDEXING_API')}
                        className="mt-0.5 text-brand-500"
                      />
                      <div>
                        <div className="text-xs font-bold text-white">Official Google Indexing API</div>
                        <p className="text-[11px] text-slate-400">
                          Strictly for pages with JobPosting or BroadcastEvent schema. Ineligible pages will be rejected per Google policy.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowJobModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isCreatingJob}
                    onClick={handleCreateBatchJob}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 disabled:opacity-50"
                  >
                    {isCreatingJob && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isCreatingJob ? 'Starting Job...' : 'Start Job'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Inspection Telemetry Modal (Verified & Preserved) */}
      {inspectionModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <span>Google Search Console Real Telemetry</span>
              </h3>
              <button
                onClick={() => setInspectionModalData(null)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 font-mono text-xs text-cyan-300 break-all">
              {inspectionModalData.url}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Google Verdict
                </span>
                <span
                  className={`text-sm font-bold font-mono ${
                    inspectionModalData.result?.verdict === 'PASS'
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {inspectionModalData.result?.verdict || 'NEUTRAL'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Coverage State
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {inspectionModalData.result?.coverageState || 'Crawled - currently not indexed'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Robots.txt State
                </span>
                <span className="text-xs font-semibold text-slate-200 font-mono">
                  {inspectionModalData.result?.robotsTxtState || 'ALLOWED'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Page Fetch State
                </span>
                <span className="text-xs font-semibold text-slate-200 font-mono">
                  {inspectionModalData.result?.pageFetchState || 'SUCCESSFUL'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Crawled As
                </span>
                <span className="text-xs font-semibold text-slate-200 font-mono">
                  {inspectionModalData.result?.crawledAs || 'MOBILE'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Last Crawl Time
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  {inspectionModalData.result?.lastCrawlTime
                    ? new Date(inspectionModalData.result.lastCrawlTime).toLocaleString()
                    : 'Not yet crawled'}
                </span>
              </div>
            </div>

            {inspectionModalData.property && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 text-xs text-slate-300">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Authorized Search Console Property
                </span>
                <span className="font-mono text-cyan-300 font-semibold">
                  {inspectionModalData.property.propertyUrl}
                </span>
              </div>
            )}

            {inspectionModalData.inspectionResultLink && (
              <a
                href={inspectionModalData.inspectionResultLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 underline"
              >
                <span>Open in Google Search Console</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setInspectionModalData(null)}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Detail Drawer / Modal */}
      {selectedUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white">URL Intelligence Profile</h3>
              <button onClick={() => setSelectedUrl(null)} className="text-slate-400 hover:text-white text-xs">
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 font-mono text-xs text-cyan-300 break-all">
              {selectedUrl.normalizedUrl}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Status</span>
                <span className="text-xs font-bold text-white font-mono">{selectedUrl.status}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Google Verdict</span>
                <span className="text-xs font-bold text-white font-mono">{selectedUrl.lastGoogleVerdict || 'None'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">HTTP Status</span>
                <span className="text-xs font-bold text-emerald-400 font-mono">{selectedUrl.httpStatus || '-'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Last Crawl</span>
                <span className="text-[11px] font-mono text-slate-300">
                  {selectedUrl.lastCrawl ? new Date(selectedUrl.lastCrawl).toLocaleDateString() : 'None'}
                </span>
              </div>
            </div>

            {selectedUrl.lastCoverageState && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 text-xs">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Coverage State</span>
                <span className="text-slate-200">{selectedUrl.lastCoverageState}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleReinspect(selectedUrl.id);
                    setSelectedUrl(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold"
                >
                  Inspect Now
                </button>
                <button
                  onClick={() => {
                    handleDiscoveryWorkflow(selectedUrl.id);
                    setSelectedUrl(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
                >
                  Discovery Audit
                </button>
                <button
                  onClick={async () => {
                    const targetId = selectedUrl.id;
                    setActionLoading(targetId);
                    setSelectedUrl(null);
                    try {
                      const res = await fetch(`/api/urls/${targetId}/verify-index`, { method: 'POST' });
                      const data = await res.json();
                      if (!res.ok || !data.success) {
                        setActionMessage({ type: 'error', text: data.error || 'Verification failed' });
                      } else {
                        setActionMessage({
                          type: 'success',
                          text: `Verification Result: ${data.verification.result} — ${data.verification.explanation}`,
                        });
                        loadUrls();
                      }
                    } catch {
                      setActionMessage({ type: 'error', text: 'Verification network error' });
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                  title="Verify index status via Google URL Inspection or public search observation"
                >
                  Verify Index
                </button>
              </div>
              <button
                onClick={() => setSelectedUrl(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UrlsManagerPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-slate-500 text-xs">
          Loading URL Manager...
        </div>
      }
    >
      <UrlsManagerContent />
    </Suspense>
  );
}
