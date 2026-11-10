// Type surface for sb-executor.mjs (ESM facade over sb-executor.cjs).

export interface CodeBlock {
  language: string
  code: string
  hash: string
}

export interface ExecOptions {
  backendUrl?: string
  execMode?: 'auto' | 'confirm' | 'dry-run' | 'off'
  maxChainSteps?: number
  [key: string]: unknown
}

export interface ExecResult {
  success: boolean
  exitCode?: number | null
  killed?: boolean
  duration?: number
  stdout?: string
  stderr?: string
  output?: string
  error?: string
  env?: string
  file?: string
  hash?: string
  language?: string
  analysis?: string
  chain?: unknown[]
}

export const CONFIG: Record<string, unknown>

export function extractCodeBlocks(llmResponse: string): CodeBlock[] | null

export function classifyEnvironment(code: string, language: string): 'kali' | 'windows'

export function execute(block: CodeBlock, options?: ExecOptions): Promise<ExecResult>

export function analyzeResult(block: CodeBlock, result: ExecResult, backendUrl?: string): Promise<unknown>

export function runChain(llmResponse: string, options?: ExecOptions): Promise<ExecResult>
