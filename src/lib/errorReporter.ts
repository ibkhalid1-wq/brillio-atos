export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const payload = {
    level: "error",
    message: normalized.message,
    stack: normalized.stack,
    timestamp: new Date().toISOString(),
    ...context,
  };

  console.error(JSON.stringify(payload));
}
