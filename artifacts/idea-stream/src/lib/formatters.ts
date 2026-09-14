import {
  type Subject,
  type Idea,
  type SubjectDetail,
} from "@workspace/api-client-react";
export function formatDate(dateString: string, language = "en"): string {
  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string, language = "en"): string {
  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

export function formatTimeAgo(dateString: string, language = "en"): string {
  try {
    const elapsedSeconds = Math.round((new Date(dateString).getTime() - Date.now()) / 1000);
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
      ["second", 1],
    ];
    const [unit, seconds] = units.find(([, size]) => Math.abs(elapsedSeconds) >= size) ?? units.at(-1)!;
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
      Math.round(elapsedSeconds / seconds),
      unit,
    );
  } catch {
    return dateString;
  }
}
