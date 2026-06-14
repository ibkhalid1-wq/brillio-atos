export class ConcurrencyError extends Error {
  constructor(public readonly field: string, public readonly knownVersion: number) {
    super(`Concurrency conflict on field "${field}" — expected version ${knownVersion}`);
    this.name = "ConcurrencyError";
  }
}

export class AgentRunError extends Error {
  constructor(public readonly agentId: string, message: string) {
    super(`Agent "${agentId}" failed: ${message}`);
    this.name = "AgentRunError";
  }
}

export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`Validation failed on "${field}": ${message}`);
    this.name = "ValidationError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network unavailable") {
    super(message);
    this.name = "NetworkError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}

export function isKnownError(e: unknown): e is Error {
  return e instanceof Error;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "An unexpected error occurred";
}
