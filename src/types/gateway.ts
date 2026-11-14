import type { EndpointPath, GatewayStats, ModelSpec, RequestLogEntry } from '../shared/inference.ts';

export type NavSection = 'overview' | 'playground' | 'reference' | 'logs';

export interface GatewayInfoResponse {
  publicBaseUrl: string;
  uptimeSeconds: number;
  rateLimit: {
    maxRequests: number;
    windowSeconds: number;
  };
  models: ModelSpec[];
  stats: GatewayStats;
}

export interface GatewayLogsResponse {
  logs: RequestLogEntry[];
  stats: GatewayStats;
}

export interface PlaygroundDraft {
  endpoint: Extract<EndpointPath, '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'>;
  model: string;
  prompt: string;
  systemInstruction?: string;
  stream: boolean;
  thinkingLevel?: string;
  jsonMode?: boolean;
}
