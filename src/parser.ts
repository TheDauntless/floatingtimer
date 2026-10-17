export type ParseResult =
  | { ok: true; end: Date; kind: "duration" | "clock" }
  | { ok: false; error: string };

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1_000;
const MAX_DURATION = 24 * HOUR;

const UNITS: Record<string, number> = {
  h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
  m: MINUTE, min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
  s: SECOND, sec: SECOND, secs: SECOND, second: SECOND, seconds: SECOND,
};

const fail = (error: string): ParseResult => ({ ok: false, error });

/** Turns "10m", "1h30", "until 8:30 am" and friends into an absolute end time. */
export function parseInput(raw: string, now: Date = new Date()): ParseResult {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return fail("Type 10m, 1h30 or until 8:30 am");
  return parseClock(text, now) ?? parseDuration(text, now) ?? fail("Try 10m, 1h30 or until 8:30 am");
}

/** Returns null when the text is not clock-shaped, so the duration parser gets a turn. */
function parseClock(text: string, now: Date): ParseResult | null {
  const prefix = /^(?:until|till|til|at|@)\s*/.exec(text);
  const rest = prefix ? text.slice(prefix[0].length) : text;

  if (rest === "noon") return clockAt(now, [12], 0);
  if (rest === "midnight") return clockAt(now, [0], 0);

  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?$/.exec(rest);
  if (!m) return prefix ? fail("Use a time like until 8 am or until 17:45") : null;

  const [, hourText, minuteText, meridiem] = m;
  // Without "until", a bare number like "25" means minutes, not a clock time.
  if (!prefix && minuteText === undefined && !meridiem) return null;

  const hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (minute > 59) return fail("Minutes go up to 59");

  if (meridiem) {
    if (hour < 1 || hour > 12) return fail("With am/pm, hours go from 1 to 12");
    return clockAt(now, [(hour % 12) + (meridiem.startsWith("p") ? 12 : 0)], minute);
  }
  if (hour > 23) return fail("Hours go up to 23");
  // 0, 13-23 or a leading zero ("08:30") can only be 24-hour time.
  if (hour === 0 || hour > 12 || hourText.startsWith("0")) return clockAt(now, [hour], minute);
  // "until 8" means whichever of 8:00 or 20:00 comes first.
  return clockAt(now, [hour % 12, (hour % 12) + 12], minute);
}

function clockAt(now: Date, hours: number[], minute: number): ParseResult {
  const ends = hours.map((hour) => {
    const end = new Date(now);
    end.setHours(hour, minute, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end;
  });
  const end = ends.reduce((a, b) => (b < a ? b : a));
  return { ok: true, end, kind: "clock" };
}

function parseDuration(text: string, now: Date): ParseResult | null {
  let rest = text.replace(/^in /, "");
  let total = 0;

  const hms = /^(\d+):(\d{2}):(\d{2})$/.exec(rest);
  if (hms) {
    const [h, m, s] = hms.slice(1).map(Number);
    if (m > 59 || s > 59) return null;
    total = h * HOUR + m * MINUTE + s * SECOND;
  } else {
    const token = /^(\d+(?:\.\d+)?)\s*([a-z]*)\s*(?:and\s+|,\s*)?/;
    const used = new Set<number>();
    let lastUnit: number | null = null;
    while (rest) {
      const m = token.exec(rest);
      if (!m) return null;
      rest = rest.slice(m[0].length);

      let unit: number;
      if (m[2]) {
        unit = UNITS[m[2]];
        if (!unit) return null;
      } else if (lastUnit === null) {
        if (rest) return null;
        unit = MINUTE; // A lone number means minutes.
      } else if (lastUnit === HOUR) {
        unit = MINUTE; // "1h30"
      } else if (lastUnit === MINUTE) {
        unit = SECOND; // "5m30"
      } else {
        return null;
      }
      if (used.has(unit)) return null;
      used.add(unit);
      lastUnit = unit;
      total += Number(m[1]) * unit;
    }
  }

  if (total <= 0) return fail("Duration must be more than 0");
  if (total > MAX_DURATION) return fail("Maximum is 24 hours");
  return { ok: true, end: new Date(now.getTime() + Math.round(total)), kind: "duration" };
}
