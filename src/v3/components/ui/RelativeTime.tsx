import React from "react";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatRelative } from "@/lib/formatTime";

export function RelativeTime({
  date,
  className,
}: {
  date: string | number | Date | null | undefined;
  className?: string;
}) {
  const relative = formatRelative(date);
  const absolute = formatAbsolute(date);
  if (!relative) return null;

  return (
    <time dateTime={typeof date === "string" ? date : undefined} title={absolute} className={cn("adam-relative-time", className)}>
      {relative}
    </time>
  );
}
