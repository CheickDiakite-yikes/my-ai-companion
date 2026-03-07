export type LiveAudioPlatformClass = "desktop" | "android" | "ios";

export interface LiveAudioCompatibilityProfile {
  isMobile: boolean;
  platformClass: LiveAudioPlatformClass;
  isAndroid: boolean;
  androidMajor: number | null;
  isLegacyAndroid: boolean;
  isIOS: boolean;
  iosMajor: number | null;
  isStandalonePwa: boolean;
  isSamsungBrowser: boolean;
  microphonePermissionTimeoutMs: number;
  connectionTimeoutMs: number;
}

export interface LiveSpeechDetectionProfile {
  mode: "desktop_default" | "mobile_relaxed";
  thresholdScale: number;
  assistantThresholdScale: number;
  ambientMultiplierScale: number;
  idleMaxRmsCap: number | null;
  assistantMaxRmsCap: number | null;
  startMinSpeechDurationMultiplier: number;
  assistantMinSpeechDurationMultiplier: number;
  endSilenceDurationMultiplier: number;
  candidateClearSilenceMultiplier: number;
  minimumCandidateClearSilenceMs: number;
  minimumEndSilenceMs: number;
}

export interface ResolveLiveAudioCompatibilityProfileInput {
  userAgent?: string | null;
  maxTouchPoints?: number | null;
  isStandalonePwa?: boolean | null;
  legacyAndroidMaxMajor?: number | null;
}

function parseAndroidMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/Android\s+(\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIosMajorVersion(userAgent: string): number | null {
  const iosMatch = userAgent.match(/(?:OS|CPU(?:\s+iPhone)?\s+OS)\s+(\d+)[._]/i);
  if (iosMatch) {
    const parsed = Number.parseInt(iosMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const versionMatch = userAgent.match(/Version\/(\d+)\./i);
  if (versionMatch && /Safari\//i.test(userAgent)) {
    const parsed = Number.parseInt(versionMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function detectIpadOsDesktopUa(userAgent: string, maxTouchPoints: number): boolean {
  return (
    /Macintosh/i.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    maxTouchPoints > 1
  );
}

export function resolveLiveAudioCompatibilityProfile(
  input: ResolveLiveAudioCompatibilityProfileInput = {},
): LiveAudioCompatibilityProfile {
  const userAgent = (input.userAgent ?? "").trim();
  const maxTouchPoints = Math.max(0, input.maxTouchPoints ?? 0);
  const isStandalonePwa = Boolean(input.isStandalonePwa);

  const isAndroid = /android/i.test(userAgent);
  const androidMajor = isAndroid ? parseAndroidMajorVersion(userAgent) : null;
  const legacyAndroidMaxMajor = Math.max(1, input.legacyAndroidMaxMajor ?? 10);
  const isLegacyAndroid =
    isAndroid &&
    typeof androidMajor === "number" &&
    androidMajor <= legacyAndroidMaxMajor;

  const isIphoneLike = /iphone|ipod/i.test(userAgent);
  const isIpadLike = /ipad/i.test(userAgent);
  const isIpadDesktopUa = detectIpadOsDesktopUa(userAgent, maxTouchPoints);
  const isIOS = isIphoneLike || isIpadLike || isIpadDesktopUa;
  const iosMajor = isIOS ? parseIosMajorVersion(userAgent) : null;

  const isMobile = isAndroid || isIOS || /mobile/i.test(userAgent);
  const isSamsungBrowser = /SamsungBrowser\//i.test(userAgent);
  const platformClass: LiveAudioPlatformClass = isAndroid
    ? "android"
    : isIOS
      ? "ios"
      : "desktop";

  const microphonePermissionTimeoutMs =
    platformClass === "android"
      ? isLegacyAndroid
        ? 25000
        : isSamsungBrowser
          ? 22000
          : 18000
      : platformClass === "ios"
        ? isStandalonePwa
          ? 22000
          : 18000
        : 12000;

  const connectionTimeoutMs =
    platformClass === "android"
      ? isLegacyAndroid
        ? 30000
        : isSamsungBrowser
          ? 26000
          : 22000
      : platformClass === "ios"
        ? isStandalonePwa
          ? 24000
          : 20000
        : 15000;

  return {
    isMobile,
    platformClass,
    isAndroid,
    androidMajor,
    isLegacyAndroid,
    isIOS,
    iosMajor,
    isStandalonePwa,
    isSamsungBrowser,
    microphonePermissionTimeoutMs,
    connectionTimeoutMs,
  };
}

export function resolveLiveSpeechDetectionProfile(params: {
  compatibility: LiveAudioCompatibilityProfile;
  mobileThresholdScale?: number;
  mobileAssistantThresholdScale?: number;
  mobileAmbientMultiplierScale?: number;
  mobileIdleMaxRmsCap?: number;
  mobileAssistantMaxRmsCap?: number;
  mobileStartMinDurationMultiplier?: number;
  mobileAssistantMinDurationMultiplier?: number;
  mobileEndSilenceMultiplier?: number;
  mobileCandidateClearMultiplier?: number;
  mobileMinCandidateClearMs?: number;
  mobileMinEndSilenceMs?: number;
}): LiveSpeechDetectionProfile {
  const {
    compatibility,
    mobileThresholdScale = 0.84,
    mobileAssistantThresholdScale = 0.88,
    mobileAmbientMultiplierScale = 0.82,
    mobileIdleMaxRmsCap = 0.02,
    mobileAssistantMaxRmsCap = 0.03,
    mobileStartMinDurationMultiplier = 0.85,
    mobileAssistantMinDurationMultiplier = 0.88,
    mobileEndSilenceMultiplier = 1.35,
    mobileCandidateClearMultiplier = 2.1,
    mobileMinCandidateClearMs = 96,
    mobileMinEndSilenceMs = 760,
  } = params;

  if (!compatibility.isMobile) {
    return {
      mode: "desktop_default",
      thresholdScale: 1,
      assistantThresholdScale: 1,
      ambientMultiplierScale: 1,
      idleMaxRmsCap: null,
      assistantMaxRmsCap: null,
      startMinSpeechDurationMultiplier: 1,
      assistantMinSpeechDurationMultiplier: 1,
      endSilenceDurationMultiplier: 1,
      candidateClearSilenceMultiplier: 1,
      minimumCandidateClearSilenceMs: 0,
      minimumEndSilenceMs: 0,
    };
  }

  return {
    mode: "mobile_relaxed",
    thresholdScale: mobileThresholdScale,
    assistantThresholdScale: mobileAssistantThresholdScale,
    ambientMultiplierScale: mobileAmbientMultiplierScale,
    idleMaxRmsCap: mobileIdleMaxRmsCap,
    assistantMaxRmsCap: mobileAssistantMaxRmsCap,
    startMinSpeechDurationMultiplier: mobileStartMinDurationMultiplier,
    assistantMinSpeechDurationMultiplier: mobileAssistantMinDurationMultiplier,
    endSilenceDurationMultiplier: mobileEndSilenceMultiplier,
    candidateClearSilenceMultiplier: mobileCandidateClearMultiplier,
    minimumCandidateClearSilenceMs: mobileMinCandidateClearMs,
    minimumEndSilenceMs: mobileMinEndSilenceMs,
  };
}
