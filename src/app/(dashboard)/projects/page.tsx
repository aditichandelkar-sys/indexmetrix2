'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardHeader from '@/components/layout/DashboardHeader';
import {
  FolderGit2,
  Plus,
  Globe,
  Trash2,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Edit2,
  CheckCircle2,
  ShieldCheck,
  Search,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  domain: string;
  description?: string;
  googlePropertyId?: string;
  googlePropertyUrl?: string;
  createdAt: string;
  _count?: {
    urls: number;
    sitemaps: number;
    properties: number;
    indexingJobs: number;
  };
}

interface GscProperty {
  id: string;
  propertyUrl: string;
  permissionLevel?: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [gscProperties, setGscProperties] = useState<GscProperty[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projRes, gscRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/google/properties'),
      ]);

      const projData = await projRes.json();
      if (projData.success) {
        setProjects(projData.projects || []);
      }

      const gscData = await gscRes.json();
      if (gscData.success && gscData.accounts) {
        const props: GscProperty[] = [];
        for (const acc of gscData.accounts) {
          if (acc.properties) {
            for (const p of acc.properties) {
              props.push({ id: p.id, propertyUrl: p.propertyUrl, permissionLevel: p.permissionLevel });
            }
          }
        }
        setGscProperties(props);
      }
    } catch {
      // Error loading data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingProject(null);
    setName('');
    setDomain('');
    setDescription('');
    setSelectedPropertyId('');
    setError(null);
    setShowModal(true);
  };

  const openEditModal = (proj: Project) => {
    setEditingProject(proj);
    setName(proj.name);
    setDomain(proj.domain);
    setDescription(proj.description || '');
    setSelectedPropertyId(proj.googlePropertyId || '');
    setError(null);
    setShowModal(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const matchedProp = gscProperties.find((p) => p.id === selectedPropertyId);

    try {
      const url = editingProject ? `/api/projects/${editingProject.id}` : '/api/projects';
      const method = editingProject ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          domain,
          description,
          googlePropertyId: selectedPropertyId || null,
          googlePropertyUrl: matchedProp?.propertyUrl || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to save project');
        setSubmitting(false);
        return;
      }

      setShowModal(false);
      loadData();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project and all its URLs and jobs?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="flex-1 flex flex-col">
      <DashboardHeader
        title="Project Workspaces"
        description="Organize websites, link verified Google Search Console properties, and track indexing progress"
      >
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </DashboardHeader>

      <div className="p-6">
        {loading ? (
          <div className="py-20 flex justify-center items-center text-slate-400 text-xs">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading projects & properties...
          </div>
        ) : projects.length === 0 ? (
          <div className="glass-panel p-12 rounded-2xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
            <div className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto">
              <FolderGit2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">No Projects Found</h3>
            <p className="text-xs text-slate-400">
              Create your first project to start managing domain properties, importing URLs, and tracking verified Google indexing.
            </p>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
            >
              <Plus className="w-4 h-4" />
              <span>Create Project</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                className="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col justify-between hover:border-brand-500/30 transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-500/20 transition-colors">
                        <FolderGit2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white group-hover:text-brand-400 transition-colors">
                          {project.name}
                        </h4>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Globe className="w-3.5 h-3.5 text-slate-500" />
                          <span>{project.domain}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(project)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                        title="Edit Project"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(project.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Delete Project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {project.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 mb-4">
                      {project.description}
                    </p>
                  )}

                  {/* Connected GSC Property Badge */}
                  <div className="mb-4 p-2.5 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <ShieldCheck
                        className={`w-4 h-4 flex-shrink-0 ${
                          project.googlePropertyUrl ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      />
                      <span className="text-[11px] truncate text-slate-300">
                        {project.googlePropertyUrl || 'No Search Console property linked'}
                      </span>
                    </div>
                    {project.googlePropertyUrl ? (
                      <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded flex-shrink-0">
                        Linked
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded flex-shrink-0">
                        Unlinked
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-white/5 my-3">
                    <div className="text-center">
                      <div className="text-base font-bold text-white">
                        {project._count?.urls ?? 0}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        URLs
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-white">
                        {project._count?.indexingJobs ?? 0}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        Jobs
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-white">
                        {project._count?.sitemaps ?? 0}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        Sitemaps
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                  <Link
                    href={`/urls?projectId=${project.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300"
                  >
                    <span>Manage URLs</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md p-6 rounded-2xl border border-white/10 shadow-2xl relative space-y-5">
            <h3 className="text-base font-bold text-white">
              {editingProject ? 'Edit Project Workspace' : 'Create New Project Workspace'}
            </h3>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Index Metrix Main Site"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Target Domain
                </label>
                <input
                  type="text"
                  required
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. indexmetrix.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Google Search Console Property
                </label>
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-xs focus:outline-none focus:border-brand-500"
                >
                  <option value="">-- No Property (Manual Linking Later) --</option>
                  {gscProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.propertyUrl} ({p.permissionLevel || 'Verified'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Connect your Google Search Console account in <Link href="/google" className="text-brand-400 hover:underline">Google Settings</Link> to import verified properties.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Project scope, team notes, or indexing goals..."
                  rows={2}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-500/25 transition-all disabled:opacity-50"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingProject ? 'Save Changes' : 'Create Project'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
