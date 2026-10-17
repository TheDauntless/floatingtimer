/** Mirrors `Settings` in src-tauri/src/settings.rs. */
export type Settings = {
  colorA: string;
  colorB: string;
  sound: boolean;
  opacity: number;
};

export const DEFAULT_SETTINGS: Settings = {
  colorA: "#2bb3a3",
  colorB: "#e5484d",
  sound: true,
  opacity: 1,
};

/** Picks black or white text, whichever contrasts more with the background. */
export function textColorFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000" : "#fff";
}

/** Sets the sweep colors and matching text colors as CSS variables on `el`. */
export function applyColors(el: HTMLElement, settings: Settings) {
  el.style.setProperty("--a", settings.colorA);
  el.style.setProperty("--b", settings.colorB);
  el.style.setProperty("--on-a", textColorFor(settings.colorA));
  el.style.setProperty("--on-b", textColorFor(settings.colorB));
}
