export type LaunchMode = "now" | "schedule";

export type SchedulePreset =
  | "1h"
  | "6h"
  | "tomorrow_10"
  | "tomorrow_18"
  | "3d"
  | "7d"
  | "custom";

export const SCHEDULE_PRESETS: { id: SchedulePreset; label: string }[] = [
  { id: "1h", label: "In 1 hour" },
  { id: "6h", label: "In 6 hours" },
  { id: "tomorrow_10", label: "Tomorrow at 10:00" },
  { id: "tomorrow_18", label: "Tomorrow at 18:00" },
  { id: "3d", label: "In 3 days (same time)" },
  { id: "7d", label: "In 1 week (same time)" },
  { id: "custom", label: "Pick a date & time…" },
];

export const SCHEDULE_HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, "0")}:00`,
}));

export const SCHEDULE_MINUTES = [
  { value: 0, label: "00" },
  { value: 15, label: "15" },
  { value: 30, label: "30" },
  { value: 45, label: "45" },
];

function atLocal(y: number, m: number, d: number, hour: number, minute: number) {
  return new Date(y, m, d, hour, minute, 0, 0);
}

function tomorrowAt(hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return atLocal(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute);
}

/** Local YYYY-MM-DD for date inputs / dropdowns */
export function localDateValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next 30 calendar days for the custom date dropdown */
export function upcomingDateOptions(from = new Date(), days = 30) {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const value = localDateValue(d);
    const label = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    out.push({ value, label: i === 0 ? `Today · ${label}` : i === 1 ? `Tomorrow · ${label}` : label });
  }
  return out;
}

export function resolveLaunchAt(params: {
  mode: LaunchMode;
  preset: SchedulePreset;
  customDate: string;
  customHour: number;
  customMinute: number;
}): string | null {
  if (params.mode === "now") return null;

  const now = new Date();
  let when: Date;

  switch (params.preset) {
    case "1h":
      when = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    case "6h":
      when = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      break;
    case "tomorrow_10":
      when = tomorrowAt(10);
      break;
    case "tomorrow_18":
      when = tomorrowAt(18);
      break;
    case "3d":
      when = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      break;
    case "7d":
      when = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case "custom": {
      const [y, m, d] = params.customDate.split("-").map(Number);
      if (!y || !m || !d) throw new Error("Pick a launch date.");
      when = atLocal(y, m - 1, d, params.customHour, params.customMinute);
      break;
    }
    default:
      throw new Error("Pick when minting should open.");
  }

  if (when.getTime() <= Date.now() + 60_000) {
    throw new Error("Scheduled time must be at least 1 minute from now.");
  }
  return when.toISOString();
}

export function formatLaunchAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timezoneHint() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "local time";
  }
}
