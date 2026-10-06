'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardHeader from '@/components/layout/DashboardHeader';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function BulkImportContent() {
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get('projectId') || '';

  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [rawContent, setRawContent] = useState('');
  const [sourceType, setSourceType] = useState<'RAW_TEXT' | 'CSV_FILE'>('RAW_TEXT');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.projects) {
          setProjects(data.projects);
          if (!projectId && data.projects.length > 0) {
            setProjectId(data.projects[0].id);
          }
        }
      });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawContent(content);
      if (file.name.toLowerCase().endsWith('.csv')) {
        setSourceType('CSV_FILE');
      } else {
        setSourceType('RAW_TEXT');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) {
      setError('Please select or create a project first');
      return;
    }
    if (!rawContent.trim()) {
      setError('Please provide URLs to import');
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/urls/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          content: rawContent,
          sourceType,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to import URLs');
      } else {
        setResult({
          totalProcessed: data.totalExtracted || 0,
          importedCount: data.accepted || 0,
          invalidCount: (data.invalid || 0) + (data.blocked || 0) + (data.duplicates || 0),
          duplicates: data.duplicates || 0,
          blocked: data.blocked || 0,
        });
        setRawContent('');
      }
    } catch {
      setError('An unexpected error occurred during import.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="Bulk URL Importer"
        description="Ingest single or hundreds of URLs, validate syntax, and link to GSC properties"
      />

      <div className="p-6 max-w-4xl space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Import Completed Successfully!</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-black/40">
                <div className="text-slate-400">Total Lines</div>
                <div className="text-lg font-bold text-white font-mono">{result.totalProcessed}</div>
              </div>
              <div className="p-3 rounded-xl bg-black/40">
                <div className="text-slate-400">Valid Ingested</div>
                <div className="text-lg font-bold text-emerald-400 font-mono">{result.importedCount}</div>
              </div>
              <div className="p-3 rounded-xl bg-black/40">
                <div className="text-slate-400">Invalid / Skipped</div>
                <div className="text-lg font-bold text-amber-400 font-mono">{result.invalidCount}</div>
              </div>
            </div>
            <div className="pt-2">
              <Link
                href={`/urls?projectId=${projectId}`}
                className="inline-flex items-center gap-1.5 text-xs text-brand-300 hover:text-white font-semibold"
              >
                <span>View Imported URLs in Table</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}

        <div className="glass-panel p-6 rounded-2xl border border-white/5 space-y-6">
          <form onSubmit={handleImport} className="space-y-5">
            {/* Project Selection */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.domain})
                  </option>
                ))}
              </select>
            </div>

            {/* File Upload Option */}
            <div className="p-4 rounded-xl border border-dashed border-white/10 bg-[#090e1a]/50 text-center space-y-2">
              <UploadCloud className="w-8 h-8 text-brand-400 mx-auto" />
              <div className="text-xs text-slate-300 font-medium">Upload CSV or TXT file</div>
              <p className="text-[11px] text-slate-500">Supports raw URL lists, single column CSVs, or newline files</p>
              <label className="inline-block cursor-pointer px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold border border-white/10">
                Choose File
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Direct Paste Text Area */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">Paste URLs (One URL per line)</label>
                <span className="text-[11px] text-slate-500 font-mono">
                  {rawContent.split(/\r?\n/).filter((l) => l.trim()).length} lines detected
                </span>
              </div>
              <textarea
                rows={8}
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                placeholder={`https://example.com/\nhttps://example.com/blog/seo-audit\nhttps://example.com/pricing`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#090e1a] border border-white/10 text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-brand-500 leading-relaxed"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-brand-600 to-cyan-500 hover:from-brand-500 hover:to-cyan-400 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-xs shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 transition-all"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Processing & Normalizing URLs...
                </>
              ) : (
                <>
                  Import & Validate URLs
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function BulkImportPage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-slate-400">Loading URL importer...</div>}>
      <BulkImportContent />
    </Suspense>
  );
}
