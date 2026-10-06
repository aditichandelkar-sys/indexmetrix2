import { DiscoveryAdapter, DiscoveryContext, DiscoveryResult } from '../types';
import { DiscoveryProvider, ProviderExecutionRecord } from '../provider-types';
import { providerRegistry } from '../providers/registry';
import { GoogleWebSubProvider } from '../providers/GoogleWebSubProvider';

export class PublicDiscoveryAdapter implements DiscoveryAdapter {
  name = 'PublicDiscoveryAdapter';

  constructor(private provider?: DiscoveryProvider) {}

  canHandle(ctx: DiscoveryContext): boolean {
    // Can handle any URL that is not explicitly noindexed
    return !ctx.analysis?.noindex;
  }

  getStatus(): string {
    return 'DISCOVERY_SIGNAL_SENT';
  }

  explain(): string {
    return 'External public discovery signal pipeline: dispatches real-time feed publication notifications to search engine hubs and tracks delivery evidence.';
  }

  async execute(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const { analysis, normalizedUrl } = ctx;

    // 1. Check if blocked by robots.txt
    if (!analysis.robotsAllowed) {
      return {
        adapter: this.name,
        handled: false,
        success: false,
        status: 'BLOCKED',
        provider: 'PUBLIC_DISCOVERY',
        signalType: 'PUBLIC_DISCOVERY',
        indexed: false,
        verified: false,
        explanation: 'Discovery blocked: Target website /robots.txt disallows search engine crawling.',
        details: { reason: 'ROBOTS_BLOCKED' },
      };
    }

    // 2. Check if blocked by noindex directive
    if (analysis.noindex) {
      return {
        adapter: this.name,
        handled: false,
        success: false,
        status: 'BLOCKED',
        provider: 'PUBLIC_DISCOVERY',
        signalType: 'PUBLIC_DISCOVERY',
        indexed: false,
        verified: false,
        explanation: 'Discovery blocked: Page declares "noindex" meta tag or X-Robots-Tag header.',
        details: { reason: 'NOINDEX_BLOCKED' },
      };
    }

    // 3. Check for target server HTTP error
    if (analysis.httpStatus >= 400) {
      return {
        adapter: this.name,
        handled: false,
        success: false,
        status: 'DISCOVERY_PENDING',
        provider: 'PUBLIC_DISCOVERY',
        signalType: 'PUBLIC_DISCOVERY',
        indexed: false,
        verified: false,
        explanation: `Discovery pending: Target server responded with HTTP ${analysis.httpStatus}. Scheduled for re-check.`,
        details: { httpStatus: analysis.httpStatus },
      };
    }

    // 4. Select and execute real DiscoveryProvider
    const activeProvider = this.provider || new GoogleWebSubProvider();

    // Verify provider supports URL
    const isSupported = await activeProvider.supports(normalizedUrl, ctx);
    if (!isSupported) {
      return {
        adapter: this.name,
        handled: true,
        success: false,
        status: 'NO_DISCOVERY_SIGNAL_AVAILABLE',
        provider: 'PUBLIC_DISCOVERY',
        signalType: 'PUBLIC_DISCOVERY',
        indexed: false,
        verified: false,
        explanation: `No discovery signal available: Provider "${activeProvider.name}" does not support this target URL.`,
        details: { provider: activeProvider.name, supported: false },
      };
    }

    // Execute actual external network request via provider
    const execution: ProviderExecutionRecord = await activeProvider.submit(normalizedUrl, ctx);

    // CRITICAL RULE 4:
    // PublicDiscoveryAdapter must NEVER return DISCOVERY_SIGNAL_SENT unless
    // an actual external network request succeeded and the provider confirmed receipt/acceptance.
    if (!execution.accepted) {
      const isUnavailable = execution.requestStatus === 'NOT_AUTHORIZED' || execution.requestStatus === 'NOT_ELIGIBLE';
      const status = isUnavailable ? 'NO_DISCOVERY_SIGNAL_AVAILABLE' : 'DISCOVERY_PENDING';

      return {
        adapter: this.name,
        handled: true,
        success: false,
        status,
        provider: 'PUBLIC_DISCOVERY',
        signalType: 'PUBLIC_DISCOVERY',
        indexed: false,
        verified: false,
        explanation: `Discovery pending: Remote provider "${execution.provider}" did not confirm acceptance (${execution.errorCode || execution.errorMessage || 'signal unconfirmed'}).`,
        details: {
          providerExecution: execution,
          requestStatus: execution.requestStatus,
          errorCode: execution.errorCode,
          errorMessage: execution.errorMessage,
        },
      };
    }

    // Real external signal succeeded and remote service confirmed acceptance!
    const explanation = ctx.matchedProperty
      ? `Public discovery signal confirmed accepted by ${execution.provider} (HTTP ${execution.httpStatus}). Proceeding to Search Console verification.`
      : `Public discovery signal confirmed accepted by ${execution.provider} (HTTP ${execution.httpStatus}). Real-time feed notification delivered; awaiting crawler activity.`;

    return {
      adapter: this.name,
      handled: true,
      success: true,
      status: 'DISCOVERY_SIGNAL_SENT',
      provider: 'PUBLIC_DISCOVERY',
      signalType: 'PUBLIC_DISCOVERY_SIGNAL',
      indexed: false,
      verified: false,
      explanation,
      details: {
        providerExecution: execution,
        signalsRecorded: [
          'TECHNICAL_AUDIT_PASSED',
          'CANONICAL_TARGET_EVALUATED',
          'ROBOTS_ALLOWED_VERIFIED',
          `EXTERNAL_SIGNAL_ACCEPTED_${execution.provider}`,
        ],
        isThirdParty: !ctx.matchedProperty,
        canonical: analysis.canonical,
        wordCount: analysis.wordCount,
        contentType: analysis.contentType,
      },
    };
  }
}
