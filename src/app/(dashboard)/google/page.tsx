'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardHeader from '@/components/layout/DashboardHeader';
import { Search, ShieldCheck, CheckCircle2, AlertCircle, Link as LinkIcon, RefreshCw, Unlink } from 'lucide-react';

function GoogleConnectionsContent() {
  const searchParams = useSearchParams();
  const successParam = searchParams.get('success');
  const errorParam = searchParams.get('error');

  const [accounts, setAccounts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accRes, projRes] = await Promise.all([
        fetch('/api/google/properties'),
        fetch('/api/projects'),
      ]);

      if (accRes.status === 401 || projRes.status === 401) {
        window.location.href = '/login?returnUrl=/google';
        return;
      }

      const accData = await accRes.json();
      const projData = await projRes.json();

      if (accData.success) setAccounts(accData.accounts || []);
      if (projData.success) setProjects(projData.projects || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (successParam === 'connected') {
      setNotification({ type: 'success', text: 'Google Search Console account linked successfully! Properties synchronized.' });
    } else if (errorParam) {
      setNotification({ type: 'error', text: `OAuth authorization error: ${errorParam}` });
    }
  }, [successParam, errorParam]);

  const handleSyncProperties = async (accountId?: string) => {
    setSyncingId(accountId || 'all');
    try {
      const res = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.accounts) setAccounts(data.accounts);
        setNotification({
          type: 'success',
          text: `Google Search Console properties synchronized successfully (${data.syncedCount} found).`,
        });
      } else {
        setNotification({
          type: 'error',
          text: data.error || 'Failed to sync Google Search Console properties.',
        });
      }
    } catch {
      setNotification({
        type: 'error',
        text: 'Network error occurred while syncing properties with Google Search Console.',
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleConnectGoogle = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/google/auth');
      if (res.status === 401) {
        window.location.href = '/login?returnUrl=/google';
        return;
      }
      const data = await res.json();
      if (data.success && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setNotification({ type: 'error', text: data.error || 'Failed to initialize OAuth' });
        setActionLoading(false);
      }
    } catch {
      setNotification({ type: 'error', text: 'Network request error' });
      setActionLoading(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    if (!confirm('Disconnect this Google account and unlink all associated Search Console properties?')) return;
    try {
      await fetch('/api/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      loadData();
    } catch {}
  };

  const handleLinkProperty = async (propertyId: string, projectId: string | null) => {
    try {
      const res = await fetch('/api/google/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, projectId }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ type: 'success', text: 'Search Console property linked to project successfully.' });
        loadData();
      }
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="Google Search Console Connections"
        description="Authorize official API access to inspect URLs and synchronize properties"
      >
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <button
              onClick={() => handleSyncProperties()}
              disabled={syncingId !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${syncingId === 'all' ? 'animate-spin' : ''}`} />
              <span>{syncingId === 'all' ? 'Syncing...' : 'Sync All'}</span>
            </button>
          )}
          <button
            onClick={handleConnectGoogle}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-500 hover:from-brand-500 hover:to-cyan-400 text-white text-xs font-semibold shadow-md shadow-brand-500/25 transition-all"
          >
            <Search className="w-4 h-4" />
            <span>{actionLoading ? 'Connecting...' : 'Connect Google Account'}</span>
          </button>
        </div>
      </DashboardHeader>

      <div className="p-6 max-w-5xl space-y-6">
        {notification && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
              notification.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            <span className="leading-relaxed">{notification.text}</span>
            <button onClick={() => setNotification(null)} className="text-slate-400 hover:text-white shrink-0 ml-3">✕</button>
          </div>
        )}

        {/* Documentation notice */}
        <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-2 text-xs text-slate-400">
          <div className="flex items-center gap-2 text-white font-bold">
            <ShieldCheck className="w-4 h-4 text-brand-400" />
            <span>Search Console OAuth Scopes & Security</span>
          </div>
          <p className="leading-relaxed">
            INDEX MATRIX requests the minimum scopes necessary (<code className="text-cyan-300 font-mono">webmasters.readonly</code> and <code className="text-cyan-300 font-mono">indexing</code>).
            Sensitive OAuth refresh tokens are encrypted at rest using AES-256-GCM. We never store or view your Google password.
          </p>
        </div>

        {/* Connected Accounts */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
            Connected Accounts ({accounts.length})
          </h3>

          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-400" />
              Loading connected Search Console accounts...
            </div>
          ) : accounts.length === 0 ? (
            <div className="glass-panel p-10 rounded-2xl border border-white/5 text-center space-y-3">
              <Search className="w-8 h-8 text-slate-500 mx-auto" />
              <h4 className="text-sm font-bold text-white">No Google Accounts Connected</h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Connect your Google account to retrieve your verified Search Console domain and URL-prefix properties.
              </p>
              <button
                onClick={handleConnectGoogle}
                className="mt-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
              >
                Connect Google Account Now
              </button>
            </div>
          ) : (
            accounts.map((acc) => (
              <div key={acc.id} className="glass-panel p-6 rounded-2xl border border-white/5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                      <Search className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">{acc.email}</h4>
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active (Auto-refresh enabled)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSyncProperties(acc.id)}
                      disabled={syncingId === acc.id || syncingId === 'all'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 border border-brand-500/20 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingId === acc.id ? 'animate-spin' : ''}`} />
                      <span>{syncingId === acc.id ? 'Syncing...' : 'Sync Properties'}</span>
                    </button>
                    <button
                      onClick={() => handleDisconnect(acc.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>Disconnect</span>
                    </button>
                  </div>
                </div>

                {/* Properties Section */}
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                    Authorized Search Console Properties ({acc.properties?.length || 0})
                  </span>

                  {acc.properties && acc.properties.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-white/5">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase text-[10px]">
                          <tr>
                            <th className="px-4 py-2.5">Property URL</th>
                            <th className="px-4 py-2.5">Type</th>
                            <th className="px-4 py-2.5">Permission / Access</th>
                            <th className="px-4 py-2.5">Linked Workspace Project</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-slate-300">
                          {acc.properties.map((prop: any) => {
                            const isDomain = prop.propertyUrl.startsWith('sc-domain:');
                            return (
                              <tr key={prop.id} className="hover:bg-white/[0.02]">
                                <td className="px-4 py-3 font-mono font-medium text-white">{prop.propertyUrl}</td>
                                <td className="px-4 py-3">
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300">
                                    {isDomain ? 'Domain Property' : 'URL Prefix'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-[11px] text-cyan-300 font-mono capitalize">
                                    {prop.permissionLevel || 'siteOwner'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={prop.projectId || ''}
                                    onChange={(e) => handleLinkProperty(prop.id, e.target.value || null)}
                                    className="px-2.5 py-1 rounded-lg bg-[#090e1a] border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
                                  >
                                    <option value="">Unlinked (Select Project)</option>
                                    {projects.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} ({p.domain})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl bg-surface-200/30 border border-white/5 text-center text-xs text-slate-400 space-y-1">
                      <p className="text-slate-300 font-medium">No Search Console properties found for this Google account.</p>
                      <p className="text-[11px] text-slate-500">
                        Ensure this Google account has verified ownership or user access on domains in Google Search Console, then click &quot;Sync Properties&quot;.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function GoogleConnectionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-slate-400">Loading Google Search Console connections...</div>}>
      <GoogleConnectionsContent />
    </Suspense>
  );
}
