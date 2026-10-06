import { DiscoveryContext } from './types';

export type ProviderRequestStatus =
  | 'SUCCESS'
  | 'REJECTED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'NOT_ELIGIBLE'
  | 'NOT_AUTHORIZED';

export interface ProviderExecutionRecord {
  urlId: string;
  provider: string;
  requestUrl: string;
  httpMethod: string;
  startedAt: string;
  completedAt: string;
  requestStatus: ProviderRequestStatus;
  httpStatus?: number;
  responseBodySummary?: string;
  accepted: boolean;
  providerReference?: string;
  errorCode?: string;
  errorMessage?: string;
  evidenceType: 'WEBSUB_FEED_ACCEPTED' | 'INDEXNOW_ACCEPTED' | 'INDEXING_API_ACCEPTED' | 'NONE';
  timestamp: string;
}

export interface ProviderStatusRecord {
  provider: string;
  referenceId?: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CONFIRMED' | 'UNKNOWN';
  lastCheckedAt: string;
  details?: any;
}

export interface DiscoveryProvider {
  name: string;
  supports(url: string, ctx?: DiscoveryContext): Promise<boolean> | boolean;
  submit(url: string, ctx?: DiscoveryContext): Promise<ProviderExecutionRecord>;
  getStatus(referenceIdOrUrl: string, ctx?: DiscoveryContext): Promise<ProviderStatusRecord>;
}
