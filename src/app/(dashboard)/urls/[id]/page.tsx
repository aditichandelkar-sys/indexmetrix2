'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  Globe,
  ArrowLeft,
  RefreshCw,
  Search,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ShieldCheck,
  Clock,
  Layers,
  FileCode,
  ShieldAlert,
  Bot,
  Activity,
  History,
  Info,
} from 'lucide-react';

export default function UrlDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [urlData, setUrlData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUrlDetails = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/urls/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to load URL details');
        return;
      }
      setUrlData(data.url);
    } catch {
      setError('An error occurred while loading URL details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUrlDetails();
  }, [id]);

  const handleRunAudit = async () => {
    setActionLoading('analyze');
    setActionMessage(null);
    try {
      const res = await fetch(`/api/urls/${id}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error?.message || data.error || 'Analysis failed' });
        return;
      }
      setActionMessage({ type: 'success', text: 'Technical URL audit completed successfully!' });
      loadUrlDetails();
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to trigger technical analysis' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunGoogleInspection = async () => {
    setActionLoading('inspect');
    setActionMessage(null);
    try {
      const res = await fetch('/api/google/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlId: id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({
          type: 'error',
          text: data.error?.message || data.error || 'Google inspection failed',
        });
        return;
      }
      setActionMessage({
        type: 'success',
        text: `Google URL Inspection completed! Verdict: ${data.inspection?.verdict || data.status}`,
      });
      loadUrlDetails();
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to trigger Google URL inspection' });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin text-brand-400 mb-3" />
        <p className="text-xs">Loading URL Intelligence & Audit Telemetry...</p>
      </div>
    );
  }

  if (error || !urlData) {
    return (
      <div className="flex-1 p-8 max-w-4xl mx-auto space-y-4">
        <Link
          href="/urls"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to URLs</span>
        </Link>
        <div className="glass-panel p-8 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <h2 className="text-base font-bold text-white">URL Not Found or Unauthorized</h2>
          <p className="text-xs text-slate-400">{error || 'This URL does not exist or you do not have permission to view it.'}</p>
          <button
            onClick={() => router.push('/urls')}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold"
          >
            Return to URLs Directory
          </button>
        </div>
      </div>
    );
  }

  const latestAnalysis = urlData.analyses?.[0];
  const latestInspection = urlData.inspections?.[0];
  let redirectChain: any[] = [];
  let auditIssues: any[] = [];
  if (latestAnalysis?.redirectChain) {
    try {
      redirectChain = JSON.parse(latestAnalysis.redirectChain);
    } catch {}
  }
  if (latestAnalysis?.issues) {
    try {
      auditIssues = JSON.parse(latestAnalysis.issues);
    } catch {}
  }

  const isHttps = urlData.normalizedUrl?.startsWith('https://');

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="URL Intelligence & Inspection Details"
        description="Comprehensive technical SEO diagnostics, redirection audit, and official Google Search Console verdict"
      >
        <div className="flex items-center gap-2">
          <Link
            href="/urls"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold border border-white/5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All URLs</span>
          </Link>
          <button
            onClick={loadUrlDetails}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 transition-colors"
            title="Refresh URL Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </DashboardHeader>

      <div className="p-6 space-y-6 max-w-7xl">
        {/* Banner with Target URL & Primary Actions */}
        <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                    urlData.status === 'INDEXED'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : urlData.status === 'NOT_INDEXED'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : urlData.status === 'BLOCKED' || urlData.status === 'ERROR'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                  }`}
                >
                  {urlData.status}
                </span>
                {urlData.project && (
                  <Link
                    href={`/urls?projectId=${urlData.project.id}`}
                    className="text-xs text-slate-400 hover:text-brand-300 transition-colors flex items-center gap-1"
                  >
                    <Layers className="w-3 h-3" />
                    <span>{urlData.project.name}</span>
                  </Link>
                )}
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white break-all flex items-center gap-2">
                <span>{urlData.normalizedUrl}</span>
                <a
                  href={urlData.normalizedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-brand-300 inline-flex shrink-0"
                  title="Open live URL in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </h1>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                onClick={handleRunAudit}
                disabled={actionLoading === 'analyze'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-semibold border border-white/10 transition-all disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 text-amber-400 ${actionLoading === 'analyze' ? 'animate-spin' : ''}`} />
                <span>{actionLoading === 'analyze' ? 'Auditing...' : 'Run Technical Audit'}</span>
              </button>

              <button
                onClick={handleRunGoogleInspection}
                disabled={actionLoading === 'inspect'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 transition-all disabled:opacity-50"
              >
                <Search className={`w-3.5 h-3.5 ${actionLoading === 'inspect' ? 'animate-spin' : ''}`} />
                <span>{actionLoading === 'inspect' ? 'Inspecting...' : 'Google URL Inspection'}</span>
              </button>
            </div>
          </div>

          {actionMessage && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                actionMessage.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
              }`}
            >
              {actionMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{actionMessage.text}</span>
            </div>
          )}
        </div>

        {/* 2-Column Grid: Technical Audit vs Google Inspection */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* SECTION A: Technical URL Audit */}
          <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Technical SEO Audit</h2>
                    <p className="text-[11px] text-slate-400">Deterministic SSRF-safe server-side probe</p>
                  </div>
                </div>
                {latestAnalysis?.analyzedAt && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(latestAnalysis.analyzedAt).toLocaleString()}
                  </span>
                )}
              </div>

              {latestAnalysis ? (
                <div className="space-y-4">
                  {/* Key Technical Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-1">HTTP Status</span>
                      <span
                        className={`font-mono font-bold text-sm ${
                          latestAnalysis.httpStatus === 200
                            ? 'text-emerald-400'
                            : latestAnalysis.httpStatus >= 300 && latestAnalysis.httpStatus < 400
                            ? 'text-cyan-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {latestAnalysis.httpStatus || 'N/A'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-1">Response Time</span>
                      <span className="font-mono font-bold text-white text-sm">
                        {latestAnalysis.responseTimeMs} ms
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-1">HTTPS Security</span>
                      <span
                        className={`font-semibold text-xs flex items-center gap-1 ${
                          isHttps ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{isHttps ? 'Valid HTTPS' : 'Insecure HTTP'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Technical Metadata Table */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Canonical Tag</span>
                      <span className="font-mono text-slate-200 text-right truncate max-w-[280px]">
                        {latestAnalysis.canonicalUrl || 'None declared'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Robots Meta</span>
                      <span className="font-mono text-slate-200">{latestAnalysis.robotsMeta || 'None (Index allowed)'}</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">X-Robots-Tag Header</span>
                      <span className="font-mono text-slate-200">{latestAnalysis.xRobotsTag || 'None'}</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Content-Type</span>
                      <span className="font-mono text-slate-200">{latestAnalysis.contentType || 'text/html'}</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">robots.txt Status</span>
                      <span className="font-mono text-emerald-400">
                        {latestAnalysis.robotsTxtStatus || 'ALLOWED'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">XML Sitemap Presence</span>
                      <span className="font-medium text-slate-200">
                        {urlData.project?._count?.sitemaps ? 'Sitemap active in project' : 'No sitemap linked'}
                      </span>
                    </div>
                  </div>

                  {/* Redirection Chain */}
                  {redirectChain.length > 0 && (
                    <div className="p-3 rounded-xl bg-[#090e1a] border border-white/5 space-y-2">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                        Redirect Chain ({redirectChain.length} hops)
                      </span>
                      <div className="space-y-1 font-mono text-[11px]">
                        {redirectChain.map((hop: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 text-slate-300 break-all">
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold">
                              {hop.status || 301}
                            </span>
                            <span className="truncate">{hop.url || hop.target}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Audit Issues */}
                  {auditIssues.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                      <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Detected Issues ({auditIssues.length})</span>
                      </span>
                      <div className="space-y-1.5">
                        {auditIssues.map((issue: any, idx: number) => (
                          <div key={idx} className="text-xs text-slate-300">
                            <span className="font-semibold text-amber-300">{issue.issue}:</span>{' '}
                            <span>{issue.explanation || issue.recommendation || issue.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 space-y-2">
                  <Info className="w-6 h-6 mx-auto text-slate-600" />
                  <p className="text-xs">No technical audit has been performed on this URL yet.</p>
                  <button
                    onClick={handleRunAudit}
                    className="text-xs text-brand-400 hover:text-brand-300 font-semibold"
                  >
                    Run technical audit now
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* SECTION B: Official Google Search Console URL Inspection */}
          <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                    <Search className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      Google Search Console Intelligence
                    </h2>
                    <p className="text-[11px] text-slate-400">Official URL Inspection API live telemetry</p>
                  </div>
                </div>
                {latestInspection?.inspectedAt && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(latestInspection.inspectedAt).toLocaleString()}
                  </span>
                )}
              </div>

              {latestInspection ? (
                <div className="space-y-4">
                  {/* Verdict & Coverage Cards */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-1">Inspection Verdict</span>
                      <span
                        className={`font-mono font-bold text-base ${
                          latestInspection.verdict === 'PASS'
                            ? 'text-emerald-400'
                            : latestInspection.verdict === 'FAIL'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {latestInspection.verdict}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-1">Indexing Status</span>
                      <span
                        className={`font-mono font-bold text-base ${
                          urlData.status === 'INDEXED'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {urlData.status}
                      </span>
                    </div>
                  </div>

                  {/* Coverage State Banner */}
                  {latestInspection.coverageState && (
                    <div className="p-3 rounded-xl bg-[#090e1a] border border-white/5">
                      <span className="text-[10px] text-slate-400 block mb-0.5">Coverage State</span>
                      <span className="text-xs font-semibold text-slate-200">
                        {latestInspection.coverageState}
                      </span>
                    </div>
                  )}

                  {/* Google Inspection Telemetry Details Table */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Robots State</span>
                      <span className="font-mono text-slate-200">
                        {latestInspection.robotsTxtState || 'ALLOWED'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Indexing State</span>
                      <span className="font-mono text-slate-200">
                        {latestInspection.indexingState || 'INDEXING_ALLOWED'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Page Fetch State</span>
                      <span className="font-mono text-slate-200">
                        {latestInspection.pageFetchState || 'SUCCESSFUL'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Crawled As</span>
                      <span className="font-mono text-slate-200">
                        {latestInspection.crawledAs || 'GOOGLEBOT_DESKTOP'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Last Google Crawl</span>
                      <span className="font-mono text-slate-200">
                        {latestInspection.lastCrawlTime
                          ? new Date(latestInspection.lastCrawlTime).toLocaleString()
                          : 'Not recorded'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">User Declared Canonical</span>
                      <span className="font-mono text-slate-200 text-right truncate max-w-[280px]">
                        {latestInspection.userCanonical || 'None'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090e1a] border border-white/5">
                      <span className="text-slate-400">Google Selected Canonical</span>
                      <span className="font-mono text-slate-200 text-right truncate max-w-[280px]">
                        {latestInspection.googleCanonical || 'None'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 space-y-2">
                  <Search className="w-6 h-6 mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">Not inspected yet.</p>
                  <p className="text-xs text-slate-500">
                    Connect your Search Console property and click below to request live Google inspection telemetry.
                  </p>
                  <button
                    onClick={handleRunGoogleInspection}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Inspect with Google</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status History Timeline */}
        <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <History className="w-4 h-4 text-brand-400" />
            <span>URL Status History & Audit Log</span>
          </h3>

          {urlData.statusHistory && urlData.statusHistory.length > 0 ? (
            <div className="space-y-2">
              {urlData.statusHistory.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between p-3 rounded-xl bg-[#090e1a] border border-white/5 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-brand-400">{item.newStatus}</span>
                      <span className="text-[10px] text-slate-500 uppercase px-1.5 py-0.5 rounded bg-white/5">
                        {item.source}
                      </span>
                    </div>
                    {item.reason && <p className="text-slate-400 text-xs">{item.reason}</p>}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-4">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No status transitions recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
