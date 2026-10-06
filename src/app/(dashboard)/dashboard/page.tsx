'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  Globe,
  CheckCircle2,
  AlertTriangle,
  Search,
  Zap,
  Coins,
  Activity,
  Layers,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Plus,
  Clock,
  Sparkles,
  Bot,
} from 'lucide-react';

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalUrls: 0,
    indexedUrls: 0,
    notIndexed: 0,
    pendingUrls: 0,
    processingUrls: 0,
    blockedUrls: 0,
    errorUrls: 0,
    remainingCredits: '...',
    googleConnections: 0,
    activeJobs: 0,
    completedJobs: 0,
  });
  const [recentUrls, setRecentUrls] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [urlsRes, credRes, projRes, googleRes, jobsRes] = await Promise.all([
        fetch('/api/urls?limit=10'),
        fetch('/api/credits/balance'),
        fetch('/api/projects'),
        fetch('/api/google/properties'),
        fetch('/api/jobs?limit=5'),
      ]);

      const urlsData = await urlsRes.json();
      const credData = await credRes.json();
      const projData = await projRes.json();
      const googleData = await googleRes.json();
      const jobsData = await jobsRes.json();

      const urls = urlsData.urls || [];
      const total = urlsData.pagination?.total || urls.length;
      const stats = urlsData.stats || {};

      const indexed = stats.INDEXED || 0;
      const notIndexed = stats.NOT_INDEXED || 0;
      const pending = (stats.DISCOVERY_PENDING || 0) + (stats.UNINSPECTED || 0) + (stats.IMPORTED || 0) + (stats.ANALYZED || 0);
      const processing = stats.PROCESSING || 0;
      const blocked = stats.BLOCKED || 0;
      const errors = stats.ERROR || 0;

      let connCount = 0;
      if (googleData.success && googleData.accounts) {
        connCount = googleData.accounts.length;
      }

      let activeJobsCount = 0;
      let completedJobsCount = 0;
      const jobsList = jobsData.jobs || [];
      for (const j of jobsList) {
        if (j.status === 'QUEUED' || j.status === 'PROCESSING') {
          activeJobsCount++;
        } else if (j.status === 'COMPLETED' || j.status === 'PARTIAL') {
          completedJobsCount++;
        }
      }

      setMetrics({
        totalUrls: total,
        indexedUrls: indexed,
        notIndexed,
        pendingUrls: pending,
        processingUrls: processing,
        blockedUrls: blocked,
        errorUrls: errors,
        remainingCredits: credData.creditMode === 'UNLIMITED' ? 'UNLIMITED' : credData.balance?.toLocaleString() || '0',
        googleConnections: connCount,
        activeJobs: activeJobsCount,
        completedJobs: completedJobsCount,
      });

      setRecentUrls(urls);
      setProjects(projData.projects || []);
      setRecentJobs(jobsList);
    } catch (e) {
      console.error('Failed to load dashboard metrics', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const cards = [
    { title: 'Total URLs', value: metrics.totalUrls, icon: Globe, color: 'text-brand-400' },
    { title: 'Indexed (GSC)', value: metrics.indexedUrls, icon: CheckCircle2, color: 'text-emerald-400' },
    { title: 'Not Indexed', value: metrics.notIndexed, icon: AlertTriangle, color: 'text-amber-400' },
    { title: 'Discovery Pending', value: metrics.pendingUrls, icon: Clock, color: 'text-cyan-400' },
    { title: 'Blocked', value: metrics.blockedUrls, icon: ShieldCheck, color: 'text-rose-400' },
    { title: 'Active Jobs', value: metrics.activeJobs, icon: Activity, color: 'text-purple-400' },
    { title: 'Remaining Credits', value: metrics.remainingCredits, icon: Coins, color: 'text-amber-300' },
    { title: 'GSC Accounts', value: metrics.googleConnections, icon: Search, color: 'text-cyan-300' },
  ];

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="URL Indexing & Discovery Command Center"
        description="Real-time URL health metrics, Google Search Console sync status, and indexing job telemetry"
      >
        <button
          onClick={fetchDashboardData}
          disabled={loading}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 transition-colors"
          title="Refresh Metrics"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </DashboardHeader>

      <div className="p-6 space-y-6">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {cards.map((c, i) => (
            <div key={i} className="glass-panel p-4 rounded-xl border border-white/5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-400 truncate">{c.title}</span>
                <c.icon className={`w-4 h-4 ${c.color} shrink-0`} />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">{c.value}</span>
            </div>
          ))}
        </div>

        {/* Action Row: Quick Audit / Shortcuts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Start Project Guide */}
          <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand-400" />
              <span>Project Workspaces</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Organize URLs by domain, link Search Console properties, and manage automated sitemap imports.
            </p>
            <div className="space-y-2">
              {projects.slice(0, 3).map((p) => (
                <Link
                  key={p.id}
                  href={`/urls?projectId=${p.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#090e1a] border border-white/5 hover:border-brand-500/30 text-xs transition-all"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-white">{p.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{p.domain}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{p._count?.urls || 0} URLs</span>
                </Link>
              ))}
            </div>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 font-semibold"
            >
              <span>Manage All Projects</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Integration Status Box */}
          <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" />
              <span>Google Search Console Integration</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Authorized via OAuth 2.0 to inspect URLs directly via the official Google URL Inspection API.
            </p>
            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Connection Health:</span>
                <span className="text-emerald-400 font-mono font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Live & Verified
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Inspection API Quota:</span>
                <span className="text-slate-300 font-mono">2,000 / day</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Verified Properties:</span>
                <span className="text-slate-300 font-mono">{projects.filter((p) => p.googlePropertyUrl).length} Linked</span>
              </div>
            </div>
            <Link
              href="/google"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
            >
              <span>Manage Google Connections</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Active Job Telemetry */}
          <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <span>Commercial Job Telemetry</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Batch queue worker status for URL analysis, robots checking, and official Google inspection.
            </p>
            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Active Jobs:</span>
                <span className="text-purple-400 font-mono font-semibold">{metrics.activeJobs}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Completed Jobs:</span>
                <span className="text-emerald-400 font-mono font-semibold">{metrics.completedJobs}</span>
              </div>
            </div>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold"
            >
              <span>Open Jobs Center</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Recent URL Registry */}
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand-400" />
              <span>Recent URL Statuses</span>
            </h3>
            <Link
              href="/urls"
              className="text-xs text-brand-400 hover:text-brand-300 font-semibold flex items-center gap-1"
            >
              <span>View All URLs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-5 py-3">URL</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Google Verdict</th>
                  <th className="px-4 py-3">Last Inspected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {recentUrls.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                      No URLs in the registry yet.
                    </td>
                  </tr>
                ) : (
                  recentUrls.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-mono text-xs max-w-sm truncate text-white">
                        <Link href={`/urls?id=${u.id}`} className="hover:text-brand-400">
                          {u.normalizedUrl}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            u.status === 'INDEXED'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : u.status === 'NOT_INDEXED'
                              ? 'bg-amber-500/10 text-amber-400'
                              : u.status === 'DISCOVERY_PENDING'
                              ? 'bg-cyan-500/10 text-cyan-400'
                              : 'bg-slate-500/10 text-slate-400'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {u.lastGoogleVerdict || u.inspections?.[0]?.verdict || 'Uninspected'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-[11px]">
                        {u.lastInspectedAt ? new Date(u.lastInspectedAt).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
