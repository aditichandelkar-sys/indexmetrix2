import { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { ExternalLink, ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

interface RelayProps {
  params: { slug: string };
}

async function resolveTargetUrl(slug: string): Promise<string | null> {
  try {
    // 1. Check if slug matches URL ID
    const record = await prisma.url.findUnique({
      where: { id: slug },
      select: { normalizedUrl: true, originalUrl: true },
    });
    if (record) return record.normalizedUrl || record.originalUrl;

    // 2. Decode from base64url
    const decoded = Buffer.from(slug, 'base64url').toString('utf-8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // ignore decoding errors
  }
  return null;
}

export async function generateMetadata({ params }: RelayProps): Promise<Metadata> {
  const targetUrl = await resolveTargetUrl(params.slug);
  return {
    title: targetUrl ? `Redirecting to ${targetUrl}` : 'Crawl Gateway Relay',
    robots: {
      index: true,
      follow: true,
    },
    alternates: targetUrl
      ? {
          canonical: targetUrl,
        }
      : undefined,
  };
}

export default async function RelayPage({ params }: RelayProps) {
  const targetUrl = await resolveTargetUrl(params.slug);

  if (!targetUrl) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold text-red-400 mb-2">Invalid Relay Gateway</h1>
          <p className="text-sm text-slate-400 mb-6">Target destination could not be resolved.</p>
          <Link href="/" className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-sm">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
      {/* Search Engine and Crawler Fast Redirect Directives */}
      <head>
        <meta httpEquiv="refresh" content={`0;url=${targetUrl}`} />
        <link rel="canonical" href={targetUrl} />
        <meta name="robots" content="index, follow" />
      </head>

      <div className="max-w-lg w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl text-center">
        <div className="w-14 h-14 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldCheck className="w-7 h-7 text-indigo-400" />
        </div>

        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          High-Authority Bot Relay
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Dispatching to Target URL</h1>
        <p className="text-sm text-slate-400 mb-6">
          Googlebot & Search Engine Crawl Gateway Bridge.
        </p>

        <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl mb-6 text-left break-all">
          <span className="text-xs uppercase tracking-wider text-slate-500 font-mono block mb-1">Destination</span>
          <a
            href={targetUrl}
            rel="follow"
            className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1.5 font-mono"
          >
            {targetUrl}
            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
          </a>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href={targetUrl}
            rel="follow"
            className="w-full py-3 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2"
          >
            <span>Proceed to External URL</span>
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(function() { window.location.href = ${JSON.stringify(targetUrl)}; }, 1200);`,
          }}
        />
      </div>
    </div>
  );
}
