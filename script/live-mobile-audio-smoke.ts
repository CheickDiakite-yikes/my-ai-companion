import assert from "node:assert/strict";
import {
  buildLiveMicrophoneAttemptProfiles,
  getAdaptiveSpeechThresholdFloor,
  getCandidateSpeechThresholdFloor,
} from "@shared/live-audio-capture";
import {
  isPreferredGrantedDesktopAudioTrackSettings,
  resolveLiveAudioCompatibilityProfile,
  resolveLiveSpeechDetectionProfile,
  scoreGrantedDesktopAudioTrackSettings,
} from "@shared/live-audio-compatibility";

function main(): void {
  const desktop = resolveLiveAudioCompatibilityProfile({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  });
  assert.equal(desktop.platformClass, "desktop");
  assert.equal(desktop.isMobile, false);
  assert.equal(desktop.microphonePermissionTimeoutMs, 12000);
  assert.equal(desktop.connectionTimeoutMs, 15000);

  const android = resolveLiveAudioCompatibilityProfile({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  });
  assert.equal(android.platformClass, "android");
  assert.equal(android.isMobile, true);
  assert.equal(android.androidMajor, 14);
  assert.equal(android.isLegacyAndroid, false);
  assert.equal(android.microphonePermissionTimeoutMs, 18000);
  assert.equal(android.connectionTimeoutMs, 22000);

  const samsung = resolveLiveAudioCompatibilityProfile({
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  });
  assert.equal(samsung.isSamsungBrowser, true);
  assert.equal(samsung.microphonePermissionTimeoutMs, 22000);
  assert.equal(samsung.connectionTimeoutMs, 26000);

  const iphone = resolveLiveAudioCompatibilityProfile({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  assert.equal(iphone.platformClass, "ios");
  assert.equal(iphone.isMobile, true);
  assert.equal(iphone.isIOS, true);
  assert.equal(iphone.iosMajor, 18);

  const ipadDesktopUa = resolveLiveAudioCompatibilityProfile({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    maxTouchPoints: 5,
  });
  assert.equal(ipadDesktopUa.isIOS, true);
  assert.equal(ipadDesktopUa.isMobile, true);

  const mobileProfile = resolveLiveSpeechDetectionProfile({
    compatibility: iphone,
  });
  assert.equal(mobileProfile.mode, "mobile_relaxed");
  assert.equal(mobileProfile.thresholdScale < 1, true);
  assert.equal(
    typeof mobileProfile.idleMaxRmsCap === "number" &&
      mobileProfile.idleMaxRmsCap <= 0.02,
    true,
  );
  assert.equal(mobileProfile.minimumCandidateClearSilenceMs >= 96, true);
  assert.equal(mobileProfile.minimumEndSilenceMs >= 760, true);

  const desktopProfile = resolveLiveSpeechDetectionProfile({
    compatibility: desktop,
  });
  assert.equal(desktopProfile.mode, "desktop_default");
  assert.equal(desktopProfile.thresholdScale, 1);
  assert.equal(desktopProfile.idleMaxRmsCap, null);

  const mobileCaptureProfiles = buildLiveMicrophoneAttemptProfiles(iphone);
  assert.equal(mobileCaptureProfiles[0]?.label, "mobile_echo_cancel_agc");
  assert.equal(mobileCaptureProfiles[0]?.audio !== true, true);
  if (mobileCaptureProfiles[0]?.audio !== true) {
    assert.equal(mobileCaptureProfiles[0].audio.voiceIsolation, false);
    assert.equal(mobileCaptureProfiles[0].audio.noiseSuppression, false);
  }
  assert.equal(
    mobileCaptureProfiles.some((profile) => profile.label === "mobile_processed_mono"),
    true,
  );
  assert.equal(
    mobileCaptureProfiles.findIndex((profile) => profile.label === "mobile_processed_mono") >
      mobileCaptureProfiles.findIndex((profile) => profile.label === "mono_only"),
    true,
  );

  const desktopCaptureProfiles = buildLiveMicrophoneAttemptProfiles(desktop);
  assert.equal(desktopCaptureProfiles[0]?.label, "desktop_echo_cancel_only");

  assert.equal(
    getAdaptiveSpeechThresholdFloor({
      adaptiveThresholdFloor: 0.0017,
      speechProfileMode: "desktop_default",
      desktopMinimumThreshold: 0.0032,
    }),
    0.0032,
  );
  assert.equal(
    getCandidateSpeechThresholdFloor({
      adaptiveThresholdFloor: 0.0032,
      userSpeechCandidateMinThreshold: 0.0055,
      adaptiveAbsoluteFloor: 0.001,
      speechProfileMode: "desktop_default",
      desktopCandidateMinThreshold: 0.0024,
    }) >= 0.0024,
    true,
  );
  assert.equal(
    getAdaptiveSpeechThresholdFloor({
      adaptiveThresholdFloor: 0.0017,
      speechProfileMode: "mobile_relaxed",
      desktopMinimumThreshold: 0.0032,
    }),
    0.0017,
  );

  const safeDesktopTrack = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    voiceIsolation: false,
  };
  const processedDesktopTrack = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true,
  };
  assert.equal(
    isPreferredGrantedDesktopAudioTrackSettings(safeDesktopTrack),
    true,
  );
  assert.equal(
    isPreferredGrantedDesktopAudioTrackSettings(processedDesktopTrack),
    false,
  );
  assert.equal(
    scoreGrantedDesktopAudioTrackSettings(processedDesktopTrack) >
      scoreGrantedDesktopAudioTrackSettings(safeDesktopTrack),
    true,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        desktop,
        android,
        samsung,
        iphone,
        mobileProfile,
      },
      null,
      2,
    ),
  );
}

main();
