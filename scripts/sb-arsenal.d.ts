// Type surface for sb-arsenal.mjs (ESM facade over sb-arsenal.cjs).

export interface ArsenalTool {
  desc: string;
  params: string[];
  build: (params: Record<string, unknown>) => string;
}

export interface ArsenalResult {
  success: boolean;
  output?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: string;
  tool?: string;
  command?: string;
}

export const TOOLS: Record<string, ArsenalTool>;

export function dispatch(toolName: string, params?: Record<string, unknown>): Promise<ArsenalResult>;

export function listTools(): {
  total: number;
  categories: Record<string, Array<{ name: string; desc: string }>>;
};

export function runInKali(command: string, timeoutMs?: number): Promise<ArsenalResult>;
