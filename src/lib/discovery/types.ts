import { AnalysisResult } from '../analyzer';

export interface DiscoveryContext {
  urlId: string;
  originalUrl: string;
  normalizedUrl: string;
  userId: string;
  projectId: string;
  analysis: AnalysisResult;
  userProperties: any[];
  matchedProperty?: any | null;
  requestedJobType?: 'DISCOVERY_AND_INSPECTION' | 'OFFICIAL_INDEXING_API' | 'REINSPECT';
}

export interface DiscoveryResult {
  adapter: string;
  handled: boolean;
  success?: boolean;
  reason?: string;
  provider?: string;
  indexed?: boolean;
  verified?: boolean;
  status:
    | 'DISCOVERY_SIGNAL_SENT'
    | 'DISCOVERY_PENDING'
    | 'NO_DISCOVERY_SIGNAL_AVAILABLE'
    | 'INDEXING_API_NOTIFIED'
    | 'NOT_ELIGIBLE'
    | 'BLOCKED'
    | 'SKIPPED'
    | 'FAILED'
    | 'VERIFIED'
    | 'GSC_INSPECTED';
  signalType: string;
  explanation: string;
  details?: any;
}

export * from './provider-types';

export interface DiscoveryAdapter {
  name: string;
  canHandle(ctx: DiscoveryContext): boolean;
  execute(ctx: DiscoveryContext): Promise<DiscoveryResult>;
  getStatus(): string;
  explain(): string;
}

export interface DiscoveryEngineResult {
  urlId: string;
  normalizedUrl: string;
  isOwnedProperty: boolean;
  matchedPropertyUrl?: string | null;
  readinessScore: number;
  readinessLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'BLOCKED';
  overallStatus: string;
  discoveryStatus: string;
  signals: DiscoveryResult[];
  explanations: string[];
}
