import type { LiveAudioCompatibilityProfile } from "./live-audio-compatibility";

export interface LiveMicrophoneAttemptProfile {
  label: string;
  audio:
    | true
    | {
        channelCount?: number;
        echoCancellation?: boolean;
        noiseSuppression?: boolean;
        autoGainControl?: boolean;
        voiceIsolation?: boolean;
      };
}

export function buildLiveMicrophoneAttemptProfiles(
  compatibility: LiveAudioCompatibilityProfile,
): LiveMicrophoneAttemptProfile[] {
  if (compatibility.isMobile) {
    return [
      {
        label: "mobile_echo_cancel_agc",
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
          voiceIsolation: false,
        },
      },
      {
        label: "mobile_echo_cancel_only",
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: false,
        },
      },
      {
        label: "mono_only",
        audio: {
          channelCount: 1,
        },
      },
      {
        label: "mobile_processed_mono",
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      {
        label: "basic_audio",
        audio: true,
      },
    ];
  }

  return [
    {
      label: "desktop_echo_cancel_only",
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
      },
    },
    {
      label: "desktop_voice_safe",
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        voiceIsolation: false,
      },
    },
    {
      label: "mono_only",
      audio: {
        channelCount: 1,
      },
    },
    {
      label: "basic_audio",
      audio: true,
    },
  ];
}

export function getAdaptiveSpeechThresholdFloor(params: {
  adaptiveThresholdFloor: number;
  speechProfileMode: "desktop_default" | "mobile_relaxed";
  desktopMinimumThreshold: number;
}): number {
  if (params.speechProfileMode !== "desktop_default") {
    return params.adaptiveThresholdFloor;
  }
  return Math.max(params.adaptiveThresholdFloor, params.desktopMinimumThreshold);
}

export function getCandidateSpeechThresholdFloor(params: {
  adaptiveThresholdFloor: number;
  userSpeechCandidateMinThreshold: number;
  adaptiveAbsoluteFloor: number;
  speechProfileMode: "desktop_default" | "mobile_relaxed";
  desktopCandidateMinThreshold: number;
}): number {
  const adaptiveFloor = Math.min(
    params.userSpeechCandidateMinThreshold,
    Math.max(params.adaptiveAbsoluteFloor, params.adaptiveThresholdFloor * 0.7),
  );
  if (params.speechProfileMode !== "desktop_default") {
    return adaptiveFloor;
  }
  return Math.max(adaptiveFloor, params.desktopCandidateMinThreshold);
}

export function clampDesktopSpeechThreshold(params: {
  threshold: number;
  speechProfileMode: "desktop_default" | "mobile_relaxed";
  desktopMinimumThreshold: number;
}): number {
  if (params.speechProfileMode !== "desktop_default") {
    return params.threshold;
  }
  return Math.max(params.threshold, params.desktopMinimumThreshold);
}
