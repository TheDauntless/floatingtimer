import { describe, expect, it } from "vitest";
import { parseInput } from "./parser";
import { formatRemaining } from "./format";

// Saturday 17 Oct 2026, 14:20:00 local time.
const now = new Date(2026, 9, 17, 14, 20, 0);
const at = (h: number, m: number, s = 0, dayOffset = 0) => new Date(2026, 9, 17 + dayOffset, h, m, s);

describe("parseInput", () => {
  const valid: [string, Date, "duration" | "clock"][] = [
    ["10m", at(14, 30), "duration"],
    ["10 min", at(14, 30), "duration"],
    ["10 minutes", at(14, 30), "duration"],
    ["1h", at(15, 20), "duration"],
    ["1hr", at(15, 20), "duration"],
    ["1 hour", at(15, 20), "duration"],
    ["1h30", at(15, 50), "duration"],
    ["1h 30m", at(15, 50), "duration"],
    ["1 hour and 30 minutes", at(15, 50), "duration"],
    ["1:30:00", at(15, 50), "duration"],
    ["90s", at(14, 21, 30), "duration"],
    ["45 sec", at(14, 20, 45), "duration"],
    ["5m30", at(14, 25, 30), "duration"],
    ["25", at(14, 45), "duration"],
    ["1.5h", at(15, 50), "duration"],
    ["in 20 minutes", at(14, 40), "duration"],
    ["  10M  ", at(14, 30), "duration"],
    ["until 8 am", at(8, 0, 0, 1), "clock"],
    ["until 8am", at(8, 0, 0, 1), "clock"],
    ["until 8:30 pm", at(20, 30), "clock"],
    ["until 8:30 p.m.", at(20, 30), "clock"],
    ["8:30 am", at(8, 30, 0, 1), "clock"],
    ["until 17:45", at(17, 45), "clock"],
    ["@17:45", at(17, 45), "clock"],
    ["17:45", at(17, 45), "clock"],
    ["until 08:30", at(8, 30, 0, 1), "clock"],
    ["until 8", at(20, 0), "clock"],
    ["until 3", at(15, 0), "clock"],
    ["until 2", at(2, 0, 0, 1), "clock"],
    ["until 12 pm", at(12, 0, 0, 1), "clock"],
    ["until 12 am", at(0, 0, 0, 1), "clock"],
    ["until noon", at(12, 0, 0, 1), "clock"],
    ["until midnight", at(0, 0, 0, 1), "clock"],
    ["until 14:20", at(14, 20, 0, 1), "clock"],
  ];

  it.each(valid)("%s", (input, end, kind) => {
    expect(parseInput(input, now)).toEqual({ ok: true, end, kind });
  });

  const invalid = ["", "abc", "0m", "25h", "10x", "1h 2h", "until 25", "until 8:75", "until banana", "13pm", "until 0 am"];

  it.each(invalid)("rejects %j", (input) => {
    const result = parseInput(input, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe("");
  });
});

describe("formatRemaining", () => {
  it.each([
    [600_000, "10:00"],
    [599_001, "10:00"],
    [59_000, "0:59"],
    [0, "0:00"],
    [-500, "0:00"],
    [3_600_000, "1:00:00"],
    [5_430_000, "1:30:30"],
  ])("%d ms -> %s", (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});
