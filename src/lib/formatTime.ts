function toDate(input: string | number | Date | null | undefined): Date | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatRelative(dateInput: string | number | Date | null | undefined): string {
  const date = toDate(dateInput);
  if (!date) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const month = date.toLocaleDateString("en-GB", { month: "short" });
  const day = date.toLocaleDateString("en-GB", { day: "numeric" });
  if (diffDays < 365) return `${day} ${month}`;

  const year = date.toLocaleDateString("en-GB", { year: "numeric" });
  return `${day} ${month} ${year}`;
}

export function formatAbsolute(dateInput: string | number | Date | null | undefined): string {
  const date = toDate(dateInput);
  if (!date) return "";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateOnly(dateInput: string | number | Date | null | undefined): string {
  const date = toDate(dateInput);
  if (!date) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
