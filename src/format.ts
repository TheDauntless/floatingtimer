/** Remaining time as m:ss, or h:mm:ss from one hour up. Rounds up so a 10m timer starts at 10:00. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Clock time of day; `use24h` undefined falls back to the locale default. */
export function formatClock(date: Date, use24h?: boolean): string {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: use24h === undefined ? undefined : !use24h,
  });
}
