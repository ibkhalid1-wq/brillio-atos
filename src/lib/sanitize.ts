const SCRIPT_TAG_REGEX = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const IFRAME_TAG_REGEX = /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi;
const EVENT_HANDLER_ATTR_REGEX = /\son[a-z]+\s*=\s*(['"]).*?\1/gi;
const JAVASCRIPT_URL_REGEX = /javascript:/gi;
const GENERIC_HTML_TAG_REGEX = /<[^>]*>/g;

export function sanitizeAgentOutput(html: string): string {
  return String(html || "")
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(IFRAME_TAG_REGEX, "")
    .replace(EVENT_HANDLER_ATTR_REGEX, "")
    .replace(JAVASCRIPT_URL_REGEX, "");
}

export function sanitizeMarkdown(markdown: string): string {
  return String(markdown || "")
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(IFRAME_TAG_REGEX, "")
    .replace(EVENT_HANDLER_ATTR_REGEX, "")
    .replace(GENERIC_HTML_TAG_REGEX, "");
}
