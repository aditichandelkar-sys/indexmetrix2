'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  ShieldAlert,
  Users,
  Coins,
  Sliders,
  Globe,
  ArrowRight,
  Database,
  Server,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FolderGit2,
  Search,
  Zap,
} from 'lucide-react';

export default function AdminOverviewPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAdminSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview');
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load admin summary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminSummary();
  }, []);

  const stats = data?.stats;
  const health = data?.health;

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="Owner Operations & System Control"
        description="Comprehensive platform management, user ledger auditing, system health, and Google API telemetry"
      >
        <button
          onClick={loadAdminSummary}
          disabled={loading}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
          title="Refresh Data"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </DashboardHeader>

      <div className="p-6 max-w-6xl space-y-6">
        {/* Owner Unlimited Credits Status Card */}
        <div className="glass-panel p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              👑
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Owner Account Privileges Active</h3>
              <p className="text-xs text-slate-400">
                Credit Mode: <span className="text-amber-300 font-mono font-bold">UNLIMITED</span>. All URL inspections, discovery audits, and indexing jobs bypass billing deduction (0 credits charged).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/customers"
              className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold"
            >
              Customer Accounts
            </Link>
          </div>
        </div>

        {/* System Health Indicators */}
        <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" />
            <span>Infrastructure & Integration Health</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-400">Database</span>
                <Database className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{health?.database?.status || 'HEALTHY'}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-400">Google OAuth</span>
                <Search className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{health?.googleOAuth?.status || 'CONFIGURED'}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-400">GSC Sites API</span>
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{health?.searchConsoleApi?.status || 'AVAILABLE'}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-400">URL Inspection</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span>{health?.urlInspectionApi?.status || 'VERIFIED'}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#090e1a] border border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-400">Queue Worker</span>
                <Activity className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="text-xs font-bold text-purple-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span>{health?.queueWorker?.status || 'ACTIVE'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Global Statistics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Total Users</span>
            <div className="text-xl font-bold text-white mt-1">{stats?.users ?? 0}</div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Total Projects</span>
            <div className="text-xl font-bold text-white mt-1">{stats?.projects ?? 0}</div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Total URLs</span>
            <div className="text-xl font-bold text-white mt-1">{stats?.urls?.total ?? 0}</div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Indexed (Google)</span>
            <div className="text-xl font-bold text-emerald-400 mt-1">{stats?.urls?.indexed ?? 0}</div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Not Indexed</span>
            <div className="text-xl font-bold text-amber-400 mt-1">{stats?.urls?.notIndexed ?? 0}</div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-white/5">
            <span className="text-[11px] text-slate-400">Total Jobs</span>
            <div className="text-xl font-bold text-cyan-400 mt-1">{stats?.jobs?.total ?? 0}</div>
          </div>
        </div>

        {/* Detailed Operations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>Credit Accounting & Ledger Status</span>
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Customer Balance Pool:</span>
                <span className="font-mono font-bold text-white">{stats?.credits?.customerBalanceTotal ?? 0} credits</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Lifetime Credits Consumed:</span>
                <span className="font-mono font-bold text-emerald-400">{stats?.credits?.lifetimeUsedTotal ?? 0} credits</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Owner Credit Mode:</span>
                <span className="font-mono font-bold text-amber-400">UNLIMITED (Non-billed)</span>
              </div>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" />
              <span>Google Search Console Telemetry</span>
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Connected Google Accounts:</span>
                <span className="font-mono font-bold text-white">{stats?.googleConnections ?? 0}</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Verified GSC Properties:</span>
                <span className="font-mono font-bold text-cyan-400">{stats?.verifiedProperties ?? 0}</span>
              </div>
              <div className="flex justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5">
                <span className="text-slate-400">Live URL Inspections Logged:</span>
                <span className="font-mono font-bold text-emerald-400">{stats?.inspectionsLogged ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
