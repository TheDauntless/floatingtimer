import { invoke } from "@tauri-apps/api/core";
import { applyColors, DEFAULT_SETTINGS, type Settings } from "./theme";

const colorA = document.querySelector<HTMLInputElement>("#colorA")!;
const colorB = document.querySelector<HTMLInputElement>("#colorB")!;
const sound = document.querySelector<HTMLInputElement>("#sound")!;
const opacity = document.querySelector<HTMLInputElement>("#opacity")!;
const opacityValue = document.querySelector<HTMLOutputElement>("#opacityValue")!;
const reset = document.querySelector<HTMLButtonElement>("#reset")!;

function show(settings: Settings) {
  colorA.value = settings.colorA;
  colorB.value = settings.colorB;
  sound.checked = settings.sound;
  opacity.value = String(Math.round(settings.opacity * 100));
  opacityValue.value = `${opacity.value}%`;
  applyColors(document.documentElement, settings);
}

function read(): Settings {
  return {
    colorA: colorA.value,
    colorB: colorB.value,
    sound: sound.checked,
    opacity: Number(opacity.value) / 100,
  };
}

// Every change is saved at once; the timer window restyles live.
async function save() {
  const settings = read();
  show(settings);
  await invoke("save_settings", { settings });
}

for (const el of [colorA, colorB, sound, opacity]) el.addEventListener("input", save);
reset.addEventListener("click", async () => show(await invoke<Settings>("reset_settings")));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

show(DEFAULT_SETTINGS);
invoke<Settings>("get_settings").then(show).catch(() => {});
