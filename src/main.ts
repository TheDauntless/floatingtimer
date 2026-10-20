import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { formatClock, formatRemaining } from "./format";
import { parseInput } from "./parser";
import { applyColors, DEFAULT_SETTINGS, type Settings } from "./theme";

const STORAGE_KEY = "timer-state";

type ResizeDirection = Parameters<Window["startResizeDragging"]>[0];

type State =
  | { kind: "idle"; input: string }
  | { kind: "running"; input: string; start: number; end: number; pausedAt: number | null }
  | { kind: "finished"; input: string };

const app = document.querySelector<HTMLElement>("#app")!;
const form = document.querySelector<HTMLFormElement>("#idle-view")!;
const input = document.querySelector<HTMLInputElement>("#input")!;
const preview = document.querySelector<HTMLElement>("#preview")!;
const timeLayers = document.querySelectorAll<HTMLElement>(".time");
const until = document.querySelector<HTMLElement>("#until")!;

let state: State = loadState();
let use24h: boolean | undefined;
let audio: AudioContext | undefined;
let shownText = "";
let settings: Settings = DEFAULT_SETTINGS;

// ---------- state transitions ----------

function setState(next: State) {
  state = next;
  saveState();
  render();
}

function start(text: string) {
  const result = parseInput(text);
  if (!result.ok) {
    preview.textContent = result.error;
    form.classList.remove("shake");
    void form.offsetWidth; // restart the animation
    form.classList.add("shake");
    return;
  }
  // Created during a keypress so macOS lets it play sound later.
  audio ??= new AudioContext();
  const now = Date.now();
  setState({ kind: "running", input: text, start: now, end: result.end.getTime(), pausedAt: null });
  armAlarm();
}

function togglePause() {
  if (state.kind !== "running") return;
  const now = Date.now();
  if (state.pausedAt === null) {
    setState({ ...state, pausedAt: now });
    void invoke("disarm_alarm");
  } else {
    const shift = now - state.pausedAt;
    setState({ ...state, start: state.start + shift, end: state.end + shift, pausedAt: null });
    armAlarm();
  }
}

function cancel() {
  void invoke("disarm_alarm");
  setState({ kind: "idle", input: state.input });
}

function finish() {
  if (state.kind !== "running") return;
  setState({ kind: "finished", input: state.input });
  chime();
}

function dismiss() {
  setState({ kind: "idle", input: state.input });
}

/** The Rust side owns the alarm so it fires even if the webview is throttled or asleep. */
function armAlarm() {
  if (state.kind === "running" && state.pausedAt === null) {
    void invoke("arm_alarm", { endMs: state.end, label: state.input });
  }
}

// ---------- rendering ----------

function render() {
  app.className = state.kind + (state.kind === "running" && state.pausedAt !== null ? " paused" : "");
  if (state.kind === "idle") {
    app.style.setProperty("--p", "0%");
    input.value = state.input;
    updatePreview();
    input.focus();
    input.select();
  } else if (state.kind === "running") {
    until.textContent = `until ${formatClock(new Date(state.end), use24h)}`;
    tick();
  } else {
    app.style.setProperty("--p", "100%");
    setTime("0:00");
  }
}

function tick() {
  if (state.kind !== "running") return;
  const now = state.pausedAt ?? Date.now();
  const progress = Math.min(1, Math.max(0, (now - state.start) / (state.end - state.start)));
  app.style.setProperty("--p", `${(progress * 100).toFixed(3)}%`);
  setTime(formatRemaining(state.end - now));
  // Fallback in case the alarm event never arrives.
  if (state.pausedAt === null && now > state.end + 1500) finish();
}

function setTime(text: string) {
  if (text === shownText) return;
  shownText = text;
  app.style.setProperty("--chars", String(text.length));
  timeLayers.forEach((el) => (el.textContent = text));
}

function frame() {
  tick();
  requestAnimationFrame(frame);
}

function updatePreview() {
  const text = input.value;
  if (!text.trim()) {
    preview.textContent = "";
    return;
  }
  const result = parseInput(text);
  preview.textContent = result.ok ? `ends at ${formatClock(result.end, use24h)}` : "…";
}

function applySettings(next: Settings) {
  settings = next;
  applyColors(document.documentElement, settings);
  app.style.opacity = String(settings.opacity);
}

/** Three short rising tones. */
function chime() {
  if (!audio || !settings.sound) return;
  void audio.resume();
  const t0 = audio.currentTime;
  [660, 880, 990].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = freq;
    const t = t0 + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

// ---------- persistence ----------

function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved.kind === "string") return saved as State;
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { kind: "idle", input: "" };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is a convenience; ignore failures.
  }
}

// ---------- input ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  start(input.value);
});

input.addEventListener("input", updatePreview);
form.addEventListener("animationend", () => form.classList.remove("shake"));

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
    e.preventDefault();
    void invoke("quit");
  } else if (state.kind === "finished") {
    e.preventDefault();
    dismiss();
  } else if (state.kind === "running") {
    if (e.key === " ") {
      e.preventDefault();
      togglePause();
    } else if (e.key === "Escape") {
      cancel();
    }
  } else if (e.key === "Escape") {
    input.value = "";
    updatePreview();
  }
});

// Corners resize; anywhere else drags (and dismisses a finished timer). Clicks never pause.
app.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target === input) return;
  const corner = (e.target as HTMLElement).dataset.resize as ResizeDirection | undefined;
  if (corner) {
    void getCurrentWindow().startResizeDragging(corner);
    return;
  }
  if (state.kind === "finished") dismiss();
  void getCurrentWindow().startDragging();
});

// Replaces the webview's own menu (Reload, Inspect) with ours.
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  void invoke("show_context_menu");
});

window.addEventListener("focus", () => {
  if (state.kind === "idle") input.focus();
});

// ---------- startup ----------

applySettings(DEFAULT_SETTINGS);
render();
requestAnimationFrame(frame);
armAlarm(); // resume a timer that was running when the app quit

void listen("alarm", finish);
void listen<Settings>("settings-changed", (e) => applySettings(e.payload));
invoke<Settings>("get_settings").then(applySettings).catch(() => {});
void listen("focus-input", () => {
  if (state.kind === "idle") {
    input.focus();
    input.select();
  }
});
invoke<boolean | null>("uses_24h")
  .then((value) => {
    use24h = value ?? undefined;
    render();
  })
  .catch(() => {});
