import { DiscoveryProvider } from '../provider-types';
import { DiscoveryContext } from '../types';
import { GoogleWebSubProvider } from './GoogleWebSubProvider';
import { IndexNowProvider } from './IndexNowProvider';
import { GoogleIndexingApiProvider } from './GoogleIndexingApiProvider';

export class DiscoveryProviderRegistry {
  private static instance: DiscoveryProviderRegistry | null = null;
  private providers: DiscoveryProvider[] = [];

  private constructor() {
    this.resetDefaultProviders();
  }

  public static getInstance(): DiscoveryProviderRegistry {
    if (!DiscoveryProviderRegistry.instance) {
      DiscoveryProviderRegistry.instance = new DiscoveryProviderRegistry();
    }
    return DiscoveryProviderRegistry.instance;
  }

  public resetDefaultProviders(): void {
    this.providers = [
      new GoogleIndexingApiProvider(),
      new IndexNowProvider(),
      new GoogleWebSubProvider(),
    ];
  }

  public registerProvider(provider: DiscoveryProvider, prepend: boolean = false): void {
    if (prepend) {
      this.providers.unshift(provider);
    } else {
      this.providers.push(provider);
    }
  }

  public clearProviders(): void {
    this.providers = [];
  }

  public getAllProviders(): DiscoveryProvider[] {
    return [...this.providers];
  }

  /**
   * Returns all providers that support the given URL and context.
   */
  public async getSupportingProviders(
    url: string,
    ctx?: DiscoveryContext
  ): Promise<DiscoveryProvider[]> {
    const supported: DiscoveryProvider[] = [];
    for (const provider of this.providers) {
      const isSupported = await provider.supports(url, ctx);
      if (isSupported) {
        supported.push(provider);
      }
    }
    return supported;
  }

  /**
   * Selects the single best/highest-priority provider for a URL.
   */
  public async selectProvider(
    url: string,
    ctx?: DiscoveryContext
  ): Promise<DiscoveryProvider | null> {
    for (const provider of this.providers) {
      const isSupported = await provider.supports(url, ctx);
      if (isSupported) {
        // For Google Indexing API, only select if actually eligible
        if (provider.name === 'GOOGLE_INDEXING_API' && !ctx?.analysis?.hasStructuredJob && ctx?.requestedJobType !== 'OFFICIAL_INDEXING_API') {
          continue;
        }
        return provider;
      }
    }
    return null;
  }
}

export const providerRegistry = DiscoveryProviderRegistry.getInstance();
