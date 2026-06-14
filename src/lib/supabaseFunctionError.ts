export async function getSupabaseFunctionErrorMessage(error: unknown, fallback = "Edge Function request failed."): Promise<string> {
  if (!error) return fallback;

  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    const cloned = context.clone();
    try {
      const body = await cloned.json() as { error?: unknown; message?: unknown };
      const message = typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "";
      if (message) return message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text.slice(0, 500);
      } catch {
        // Fall through to generic error extraction.
      }
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
