'use client';

import React, { useState } from 'react';
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Send,
  Radio,
  FileText,
  RotateCw,
  Copy,
  Check,
  Search,
} from 'lucide-react';

interface VectorResult {
  vector: string;
  name: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'SKIPPED';
  statusCode?: number;
  latencyMs: number;
  message: string;
  timestamp: string;
}

interface DispatchResult {
  targetUrl: string;
  overallStatus: 'DISPATCHED' | 'PARTIAL' | 'FAILED';
  totalVectors: number;
  successfulVectors: number;
  vectors: VectorResult[];
  dispatchDurationMs: number;
  scheduledNextCheck: string;
}

export default function QuickIndexPage() {
  const [urlsInput, setUrlsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<DispatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [checkingSerp, setCheckingSerp] = useState<Record<string, boolean>>({});
  const [serpResults, setSerpResults] = useState<Record<string, any>>({});
  const [serviceAccount, setServiceAccount] = useState<{ isConfigured: boolean; clientEmail?: string } | null>(null);
  const [showSaModal, setShowSaModal] = useState(false);
  const [saJsonInput, setSaJsonInput] = useState('');
  const [saLoading, setSaLoading] = useState(false);
  const [saMessage, setSaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/admin/google-service-account')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setServiceAccount(d);
      })
      .catch(() => {});
  }, []);

  const handleSaveSa = async () => {
    setSaLoading(true);
    setSaMessage(null);
    try {
      const res = await fetch('/api/admin/google-service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonContent: saJsonInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSaMessage({ type: 'error', text: data.error || 'Failed to connect service account' });
      } else {
        setSaMessage({ type: 'success', text: data.message });
        setServiceAccount({ isConfigured: true, clientEmail: data.clientEmail });
        setTimeout(() => setShowSaModal(false), 2000);
      }
    } catch (err: any) {
      setSaMessage({ type: 'error', text: err.message });
    } finally {
      setSaLoading(false);
    }
  };

  const sampleLinks = [
    'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help',
    'https://exceptionalhh.com/wp-content/uploads/everest_forms_uploads/tmp/c93a9f5a0463d286267606fbc9472cb1.pdf',
  ];

  const handleFillSamples = () => {
    setUrlsInput(sampleLinks.join('\n'));
    setError(null);
  };

  const handleCheckSerp = async (targetUrl: string) => {
    setCheckingSerp((prev) => ({ ...prev, [targetUrl]: true }));
    try {
      const res = await fetch('/api/urls/check-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json();
      if (data.success && data.report) {
        setSerpResults((prev) => ({ ...prev, [targetUrl]: data.report }));
      } else {
        setSerpResults((prev) => ({
          ...prev,
          [targetUrl]: {
            targetUrl,
            isIndexed: false,
            verificationState: 'UNABLE_TO_VERIFY',
            statusText: 'UNABLE_TO_VERIFY',
            details: data.error || 'Unable to verify Google SERP status. Please check live SERP directly.',
          },
        }));
      }
    } catch (err: any) {
      console.error('SERP check error:', err);
      setSerpResults((prev) => ({
        ...prev,
        [targetUrl]: {
          targetUrl,
          isIndexed: false,
          verificationState: 'UNABLE_TO_VERIFY',
          statusText: 'UNABLE_TO_VERIFY',
          details: 'Network error or timeout during verification. Please check live SERP directly.',
        },
      }));
    } finally {
      setCheckingSerp((prev) => ({ ...prev, [targetUrl]: false }));
    }
  };

  const handleQuickIndex = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawLines = urlsInput.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);

    if (rawLines.length === 0) {
      setError('Please paste at least one valid external URL');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setProgress(15);
    setResults([]);

    const progressTimer = setInterval(() => {
      setProgress((prev) => (prev < 90 ? prev + 15 : prev));
    }, 400);

    try {
      const res = await fetch('/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: rawLines }),
      });

      clearInterval(progressTimer);
      setProgress(100);

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch fast indexing');
      }

      setResults(data.results || []);
    } catch (err: any) {
      clearInterval(progressTimer);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500/10 via-brand-600/10 to-cyan-500/10 border border-amber-500/20 p-8">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Zap className="w-64 h-64 text-amber-400" />
        </div>
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-4">
            <Zap className="w-3.5 h-3.5 fill-current" />
            QuickIndexing 10-Second Engine
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
            Third-Party Instant Crawl & Index Engine
          </h1>
          <p className="mt-3 text-base text-slate-300 leading-relaxed">
            Submit any external link—including forum threads (ProBoards), PDF uploads, parasite SEO, backlinks, and Web 2.0 properties. 
            Dispatches directly to Googlebot via Google Translate Proxies, Google WebSub Realtime Hub, Dynamic Sitemap pings, and IndexNow within 10 seconds.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {serviceAccount?.isConfigured ? (
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Official Google Indexing API: <strong>Connected ({serviceAccount.clientEmail})</strong></span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSaModal(true)}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs font-semibold transition-colors shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Connect Google Cloud Service Account (Official API Key)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal for Google Cloud Service Account */}
      {showSaModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1329] border border-white/10 rounded-3xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Connect Google Service Account</h3>
              </div>
              <button
                onClick={() => setShowSaModal(false)}
                className="text-slate-400 hover:text-white text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Paste your Google Cloud Service Account JSON file contents below. This enables direct, signed RS256 token communication with <strong>indexing.googleapis.com</strong>.
            </p>

            <textarea
              value={saJsonInput}
              onChange={(e) => setSaJsonInput(e.target.value)}
              placeholder='{ "type": "service_account", "project_id": "...", "private_key": "...", "client_email": "..." }'
              rows={8}
              className="w-full bg-[#070b14] border border-white/10 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
            />

            {saMessage && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  saMessage.type === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/10 border border-red-500/20 text-red-300'
                }`}
              >
                <span>{saMessage.text}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSaModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSa}
                disabled={saLoading || !saJsonInput.trim()}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {saLoading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {saLoading ? 'Verifying with Google...' : 'Verify & Save Credentials'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Submission Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#0b1329] border border-white/10 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">Enter Target URLs (One per line)</h2>
              </div>
              <button
                type="button"
                onClick={handleFillSamples}
                className="text-xs text-amber-400 hover:text-amber-300 underline font-medium"
              >
                Paste Sample URLs
              </button>
            </div>

            <form onSubmit={handleQuickIndex} className="space-y-4">
              <textarea
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder="https://gb32.proboards.com/thread/4903/emergency-repair&#10;https://exceptionalhh.com/wp-content/uploads/...pdf"
                rows={6}
                disabled={isSubmitting}
                className="w-full bg-[#070b14] border border-white/10 rounded-xl p-4 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
              />

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {isSubmitting && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      Dispatching to Googlebot Vectors...
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-brand-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  No Google Search Console verification needed
                </span>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <Zap className="w-4 h-4 fill-current" />
                  {isSubmitting ? 'Pushing to Googlebot...' : '⚡ Push to Googlebot (Within 10s)'}
                </button>
              </div>
            </form>
          </div>

          {/* Results Telemetry */}
          {results.length > 0 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Dispatch Telemetry ({results.length} URLs processed)
              </h2>

              {results.map((res, idx) => (
                <div
                  key={idx}
                  className="bg-[#0b1329] border border-white/10 rounded-2xl p-6 shadow-xl space-y-4"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-white/5">
                    <div className="space-y-1">
                      <span className="text-xs font-mono text-slate-500 uppercase tracking-wider block">Target URL</span>
                      <a
                        href={res.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-white hover:text-amber-400 flex items-center gap-1.5 break-all"
                      >
                        {res.targetUrl}
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {res.successfulVectors}/{res.totalVectors} Vectors Dispatched
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {res.dispatchDurationMs}ms
                      </span>
                    </div>
                  </div>

                  {/* Vectors Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {res.vectors.map((vec, vIdx) => (
                      <div
                        key={vIdx}
                        className="p-3 bg-white/[0.02] border border-white/5 rounded-xl flex items-start gap-3 text-xs"
                      >
                        <div className="mt-0.5 shrink-0">
                          {vec.status === 'SUCCESS' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                          )}
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-semibold text-slate-200 flex items-center justify-between gap-2">
                            <span>{vec.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{vec.latencyMs}ms</span>
                          </div>
                          <p className="text-slate-400 text-[11px] leading-tight line-clamp-2">
                            {vec.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Real-Time Google SERP Verification Section */}
                  <div className="p-4 bg-slate-950/70 border border-white/10 rounded-2xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Search className="w-3.5 h-3.5 text-cyan-400" />
                          Real-Time Google SERP Index Verification
                        </span>
                        <p className="text-[11px] text-slate-400">
                          Verify whether Google search currently displays this URL in public search results.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCheckSerp(res.targetUrl)}
                          disabled={checkingSerp[res.targetUrl]}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {checkingSerp[res.targetUrl] ? (
                            <>
                              <RotateCw className="w-3 h-3 animate-spin" />
                              Checking Google...
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3" />
                              Check Live on Google
                            </>
                          )}
                        </button>

                        <a
                          href={`https://www.google.com/search?q=site:${encodeURIComponent(res.targetUrl)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <span>Open on Google</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>

                    {serpResults[res.targetUrl] && (
                      <div
                        className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${
                          serpResults[res.targetUrl].verificationState === 'CONFIRMED_INDEXED' || serpResults[res.targetUrl].isIndexed
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                            : serpResults[res.targetUrl].verificationState === 'UNABLE_TO_VERIFY'
                            ? 'bg-slate-800/60 border-slate-700 text-slate-300'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                        }`}
                      >
                        {serpResults[res.targetUrl].verificationState === 'CONFIRMED_INDEXED' || serpResults[res.targetUrl].isIndexed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : serpResults[res.targetUrl].verificationState === 'UNABLE_TO_VERIFY' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        )}
                        <div className="space-y-1">
                          <div className="font-bold flex items-center gap-2 text-sm">
                            <span>
                              {serpResults[res.targetUrl].verificationState === 'CONFIRMED_INDEXED' || serpResults[res.targetUrl].isIndexed
                                ? '🟢 CONFIRMED INDEXED ON GOOGLE SERP'
                                : serpResults[res.targetUrl].verificationState === 'UNABLE_TO_VERIFY'
                                ? '⚠️ UNABLE TO VERIFY (GOOGLE RATE-LIMITED OR BLOCKED)'
                                : '⚪ NOT INDEXED ON GOOGLE SERP'}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed opacity-90">
                            {serpResults[res.targetUrl].details}
                          </p>
                          {serpResults[res.targetUrl].matchedResultUrl && (
                            <p className="text-[10px] text-emerald-400/80 font-mono mt-1 break-all">
                              Matched Result: {serpResults[res.targetUrl].matchedResultUrl}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Multi-Vector Pipeline Telemetry State */}
                  <div className="p-3 bg-white/[0.02] border border-white/10 rounded-xl text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        <strong>Signals Dispatched</strong> — Crawl signal queued across multi-vector pipeline. (Googlebot crawl logs and SERP presence verify independently).
                      </span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(res.targetUrl)}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 shrink-0"
                    >
                      {copiedUrl === res.targetUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy URL
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Vector Explanation Sidebar */}
        <div className="space-y-6">
          <div className="bg-[#0b1329] border border-white/10 rounded-2xl p-6 shadow-xl space-y-5">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-amber-400" />
              Active Googlebot Vectors
            </h3>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                <span className="font-bold text-amber-400 block">1. Google Translate Proxy Fetcher</span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Forces Google&apos;s internal translation crawler infrastructure to immediately make an outbound HTTP GET to the target URL.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                <span className="font-bold text-indigo-400 block">2. Google WebSub Hub (pubsubhubbub)</span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Direct HTTP POST to Google&apos;s appspot pubsubhubbub hub, instructing Googlebot to ingest real-time feed updates.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                <span className="font-bold text-cyan-400 block">3. Live Dynamic Sitemap & RSS Ping</span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  URLs are instantly appended to our self-updating XML sitemap and search engine endpoints are notified in real-time.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                <span className="font-bold text-emerald-400 block">4. IndexNow Protocol</span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Simultaneous instantaneous notification to Bing, Yandex, Seznam, and international search engines.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                <span className="font-bold text-purple-400 block">5. High-Authority Relay Gateway</span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Generates crawlable canonical bridges with follow links to channel bot crawl equity directly to the 3rd-party page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
