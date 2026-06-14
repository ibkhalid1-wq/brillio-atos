type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  agentId?: string;
  programId?: string;
  phaseId?: string;
  runId?: string;
  durationMs?: number;
  tokenCount?: number;
  errorCode?: string;
  errorMessage?: string;
  traceId?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, ctx: LogContext = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "adam-edge",
    ...ctx,
  }));
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => write("debug", message, ctx),
  info: (message: string, ctx?: LogContext) => write("info", message, ctx),
  warn: (message: string, ctx?: LogContext) => write("warn", message, ctx),
  error: (message: string, ctx?: LogContext) => write("error", message, ctx),
};
