export type AppThemeId =
  | "classic_teal"
  | "sunset_path"
  | "violet_city"
  | "crimson_noir";

export interface AppThemeOption {
  id: AppThemeId;
  label: string;
  description: string;
  palette: string[];
  vars: {
    shellBg: string;
    panelBg: string;
    headerBg: string;
    footerBg: string;
    accent: string;
    accentText: string;
    muted: string;
    textOnDark: string;
    textOnDarkMuted: string;
    inputBg: string;
    inputBorder: string;
    inputText: string;
    inputPlaceholder: string;
    userBubbleBg: string;
    userBubbleText: string;
    assistantBubbleBg: string;
    assistantBubbleText: string;
    mediaTrayFrom: string;
    mediaTrayTo: string;
    mediaTrayBorder: string;
    cardSoftBg: string;
    cardSoftBorder: string;
  };
}

export const DEFAULT_APP_THEME_ID: AppThemeId = "sunset_path";

export const APP_THEME_OPTIONS: AppThemeOption[] = [
  {
    id: "classic_teal",
    label: "Classic Teal",
    description: "Current signature palette.",
    palette: ["#10383A", "#0D2E30", "#DAA112", "#809276", "#E8E8E8", "#FFFFFF"],
    vars: {
      shellBg: "#10383A",
      panelBg: "#0D2E30",
      headerBg: "#10383A",
      footerBg: "rgba(16,56,58,0.90)",
      accent: "#DAA112",
      accentText: "#10383A",
      muted: "#809276",
      textOnDark: "#E8E8E8",
      textOnDarkMuted: "rgba(232,232,232,0.68)",
      inputBg: "rgba(0,0,0,0.22)",
      inputBorder: "rgba(255,255,255,0.10)",
      inputText: "#E8E8E8",
      inputPlaceholder: "rgba(232,232,232,0.42)",
      userBubbleBg: "#DAA112",
      userBubbleText: "#10383A",
      assistantBubbleBg: "#FFFFFF",
      assistantBubbleText: "#10383A",
      mediaTrayFrom: "#10383A",
      mediaTrayTo: "#0D2E30",
      mediaTrayBorder: "rgba(218,161,18,0.24)",
      cardSoftBg: "rgba(255,255,255,0.06)",
      cardSoftBorder: "rgba(255,255,255,0.12)",
    },
  },
  {
    id: "sunset_path",
    label: "Sunset Path",
    description: "Warm earthy dusk tones.",
    palette: ["#DB8F59", "#834D33", "#302020", "#929456", "#EBBA62", "#F7E7B4"],
    vars: {
      shellBg: "#302020",
      panelBg: "#302020",
      headerBg: "#302020",
      footerBg: "rgba(48,32,32,0.92)",
      accent: "#EBBA62",
      accentText: "#302020",
      muted: "#929456",
      textOnDark: "#F7E7B4",
      textOnDarkMuted: "rgba(247,231,180,0.74)",
      inputBg: "rgba(247,231,180,0.11)",
      inputBorder: "rgba(247,231,180,0.20)",
      inputText: "#F7E7B4",
      inputPlaceholder: "rgba(247,231,180,0.56)",
      userBubbleBg: "#EBBA62",
      userBubbleText: "#302020",
      assistantBubbleBg: "#F7E7B4",
      assistantBubbleText: "#302020",
      mediaTrayFrom: "#834D33",
      mediaTrayTo: "#302020",
      mediaTrayBorder: "rgba(235,186,98,0.26)",
      cardSoftBg: "rgba(247,231,180,0.10)",
      cardSoftBorder: "rgba(247,231,180,0.20)",
    },
  },
  {
    id: "violet_city",
    label: "Violet City",
    description: "Dreamy twilight purples.",
    palette: ["#413F8A", "#7C58AA", "#D277BD", "#FEC2B5", "#553769", "#BCA2E7"],
    vars: {
      shellBg: "#413F8A",
      panelBg: "#553769",
      headerBg: "#413F8A",
      footerBg: "rgba(65,63,138,0.92)",
      accent: "#FEC2B5",
      accentText: "#553769",
      muted: "#BCA2E7",
      textOnDark: "#F3E8FF",
      textOnDarkMuted: "rgba(243,232,255,0.72)",
      inputBg: "rgba(188,162,231,0.18)",
      inputBorder: "rgba(188,162,231,0.30)",
      inputText: "#F3E8FF",
      inputPlaceholder: "rgba(243,232,255,0.60)",
      userBubbleBg: "#D277BD",
      userBubbleText: "#2D1A3D",
      assistantBubbleBg: "#BCA2E7",
      assistantBubbleText: "#2E1F44",
      mediaTrayFrom: "#7C58AA",
      mediaTrayTo: "#553769",
      mediaTrayBorder: "rgba(254,194,181,0.32)",
      cardSoftBg: "rgba(188,162,231,0.14)",
      cardSoftBorder: "rgba(188,162,231,0.26)",
    },
  },
  {
    id: "crimson_noir",
    label: "Crimson Noir",
    description: "Bold black and red contrast.",
    palette: ["#070709", "#4B2D2E", "#824334", "#F42C1D", "#AE1918", "#701C1A"],
    vars: {
      shellBg: "#070709",
      panelBg: "#4B2D2E",
      headerBg: "#070709",
      footerBg: "rgba(7,7,9,0.94)",
      accent: "#F42C1D",
      accentText: "#070709",
      muted: "#824334",
      textOnDark: "#F4DDDD",
      textOnDarkMuted: "rgba(244,221,221,0.72)",
      inputBg: "rgba(244,221,221,0.10)",
      inputBorder: "rgba(244,221,221,0.18)",
      inputText: "#F4DDDD",
      inputPlaceholder: "rgba(244,221,221,0.56)",
      userBubbleBg: "#F42C1D",
      userBubbleText: "#070709",
      assistantBubbleBg: "#824334",
      assistantBubbleText: "#F4DDDD",
      mediaTrayFrom: "#701C1A",
      mediaTrayTo: "#070709",
      mediaTrayBorder: "rgba(244,44,29,0.30)",
      cardSoftBg: "rgba(255,255,255,0.05)",
      cardSoftBorder: "rgba(255,255,255,0.14)",
    },
  },
];

export function isAppThemeId(value: unknown): value is AppThemeId {
  return (
    typeof value === "string" &&
    APP_THEME_OPTIONS.some((theme) => theme.id === value)
  );
}

export function getAppTheme(themeId?: string | null): AppThemeOption {
  if (!themeId) {
    return APP_THEME_OPTIONS[0];
  }
  return (
    APP_THEME_OPTIONS.find((theme) => theme.id === themeId) ??
    APP_THEME_OPTIONS[0]
  );
}

export function applyAppTheme(themeId?: string | null): AppThemeOption {
  const resolved = getAppTheme(themeId);
  if (typeof document === "undefined") {
    return resolved;
  }

  const root = document.documentElement;
  root.setAttribute("data-app-theme", resolved.id);

  root.style.setProperty("--app-shell-bg", resolved.vars.shellBg);
  root.style.setProperty("--app-panel-bg", resolved.vars.panelBg);
  root.style.setProperty("--app-header-bg", resolved.vars.headerBg);
  root.style.setProperty("--app-footer-bg", resolved.vars.footerBg);
  root.style.setProperty("--app-accent", resolved.vars.accent);
  root.style.setProperty("--app-accent-text", resolved.vars.accentText);
  root.style.setProperty("--app-muted", resolved.vars.muted);
  root.style.setProperty("--app-on-dark", resolved.vars.textOnDark);
  root.style.setProperty("--app-on-dark-muted", resolved.vars.textOnDarkMuted);
  root.style.setProperty("--app-input-bg", resolved.vars.inputBg);
  root.style.setProperty("--app-input-border", resolved.vars.inputBorder);
  root.style.setProperty("--app-input-text", resolved.vars.inputText);
  root.style.setProperty("--app-input-placeholder", resolved.vars.inputPlaceholder);
  root.style.setProperty("--app-user-bubble-bg", resolved.vars.userBubbleBg);
  root.style.setProperty("--app-user-bubble-text", resolved.vars.userBubbleText);
  root.style.setProperty(
    "--app-assistant-bubble-bg",
    resolved.vars.assistantBubbleBg,
  );
  root.style.setProperty(
    "--app-assistant-bubble-text",
    resolved.vars.assistantBubbleText,
  );
  root.style.setProperty("--app-media-tray-from", resolved.vars.mediaTrayFrom);
  root.style.setProperty("--app-media-tray-to", resolved.vars.mediaTrayTo);
  root.style.setProperty("--app-media-tray-border", resolved.vars.mediaTrayBorder);
  root.style.setProperty("--app-soft-card-bg", resolved.vars.cardSoftBg);
  root.style.setProperty("--app-soft-card-border", resolved.vars.cardSoftBorder);

  return resolved;
}
