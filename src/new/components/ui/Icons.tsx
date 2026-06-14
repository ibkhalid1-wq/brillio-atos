import React from "react";

interface IconProps {
  className?: string;
}

function baseProps(className = "") {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function GraphIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="8" cy="18" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8 7.5l7.5-.5M7.5 8l-1 7M10 17l5.5 0M16 9l1 5.5" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M12 4l8 4-8 4-8-4 8-4Z" />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 16l8 4 8-4" />
    </svg>
  );
}

export function InboxIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M4 6h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
      <path d="M4 13h4l2 3h4l2-3h4" />
    </svg>
  );
}

export function SparklesIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
      <path d="M5 16l.7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7L5 16Z" />
      <path d="M19 14l.7 1.8L22 16.5l-2.3.7L19 19l-.7-1.8-2.3-.7 2.3-.7L19 14Z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.7H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1L4.8 8a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .7-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1.1-.2l.1-.1A2 2 0 1 1 19.2 8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.7h.2a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.7Z" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function CommandIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M7 7h4v4H7a2 2 0 1 1 0-4Z" />
      <path d="M13 7h4a2 2 0 1 1 0 4h-4V7Z" />
      <path d="M7 13h4v4H7a2 2 0 1 1 0-4Z" />
      <path d="M13 13h4v4a2 2 0 1 1-4 0v-4Z" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M20 11a8 8 0 1 0 2 5.3" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  );
}
