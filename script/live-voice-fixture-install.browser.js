(() => {
  window.__installLiveVoiceFixtureMic = ({ fixtureManifest, fixtureOptions }) => {
    if (window.__pwLiveAudio?.playFixture) {
      return;
    }

    const fixtures = fixtureManifest.fixtures ?? [];
    const traceBuffer = [];
    const traceLimit = 500;
    const diagnostics = {
      fixturePlayCount: 0,
      getUserMediaInterceptCount: 0,
      lastFixtureId: null,
      lastRequestedConstraints: null,
      lastReturnedAudioTrackCount: 0,
    };
    const requestedSampleRate =
      typeof fixtureOptions?.sampleRate === "number" &&
      Number.isFinite(fixtureOptions.sampleRate) &&
      fixtureOptions.sampleRate > 0
        ? fixtureOptions.sampleRate
        : null;
    const originalLog = console.log.bind(console);
    console.log = (...args) => {
      try {
        if (args[0] === "[LiveTrace]" && typeof args[1] === "string") {
          traceBuffer.push({
            at: Date.now(),
            event: args[1],
            metadata:
              args[2] && typeof args[2] === "object"
                ? args[2]
                : { value: args[2] ?? null },
          });
          if (traceBuffer.length > traceLimit) {
            traceBuffer.splice(0, traceBuffer.length - traceLimit);
          }
        }
      } catch {
        // Preserve original logging behavior even if trace capture fails.
      }
      originalLog(...args);
    };

    let audioContext;
    let destination;
    let activeCleanup = [];

    const ensureAudioGraph = async () => {
      if (!audioContext) {
        const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
        try {
          audioContext = requestedSampleRate
            ? new AudioContextCtor({ sampleRate: requestedSampleRate })
            : new AudioContextCtor();
        } catch {
          audioContext = new AudioContextCtor();
        }
        destination = audioContext.createMediaStreamDestination();
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
    };

    const stopActiveFixture = () => {
      activeCleanup.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // Ignore already-stopped nodes.
        }
      });
      activeCleanup = [];
    };

    const scheduleVoiceEnvelope = (gainNode, startTime, durationMs, peakGain) => {
      const totalSeconds = durationMs / 1000;
      const burstDuration = 0.11;
      const gapDuration = 0.05;
      let cursor = startTime;
      gainNode.gain.cancelScheduledValues(startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      while (cursor < startTime + totalSeconds) {
        const burstPeak = peakGain * (0.72 + Math.random() * 0.22);
        gainNode.gain.linearRampToValueAtTime(
          burstPeak,
          cursor + 0.018,
        );
        gainNode.gain.linearRampToValueAtTime(
          peakGain * 0.32,
          cursor + burstDuration * 0.52,
        );
        gainNode.gain.linearRampToValueAtTime(
          0,
          cursor + burstDuration,
        );
        cursor += burstDuration + gapDuration;
      }
    };

    const createNoiseBuffer = (durationMs) => {
      const frameCount = Math.max(
        1,
        Math.floor(audioContext.sampleRate * (durationMs / 1000)),
      );
      const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = (Math.random() * 2 - 1) * 0.6;
      }
      return buffer;
    };

    const playNoiseFixture = (fixture) => {
      const source = audioContext.createBufferSource();
      source.buffer = createNoiseBuffer(fixture.durationMs);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = fixture.gain;
      source.connect(gainNode);
      gainNode.connect(destination);
      source.start();
      source.stop(audioContext.currentTime + fixture.durationMs / 1000 + 0.02);
      activeCleanup.push(() => {
        source.stop();
        source.disconnect();
        gainNode.disconnect();
      });
    };

    const playVoiceLikeFixture = (fixture) => {
      const startTime = audioContext.currentTime + 0.01;
      const totalSeconds = fixture.durationMs / 1000;

      const oscillator = audioContext.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = fixture.carrierHz ?? 190;
      oscillator.frequency.setValueAtTime(fixture.carrierHz ?? 190, startTime);
      oscillator.frequency.linearRampToValueAtTime(
        (fixture.carrierHz ?? 190) + 20,
        startTime + totalSeconds * 0.5,
      );
      oscillator.frequency.linearRampToValueAtTime(
        (fixture.carrierHz ?? 190) - 12,
        startTime + totalSeconds,
      );

      const filter = audioContext.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1400;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;

      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(destination);
      scheduleVoiceEnvelope(gainNode, startTime, fixture.durationMs, fixture.gain);

      let noiseSource = null;
      let noiseGain = null;
      if (fixture.backgroundNoiseGain && fixture.backgroundNoiseGain > 0) {
        noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = createNoiseBuffer(fixture.durationMs);
        noiseGain = audioContext.createGain();
        noiseGain.gain.value = fixture.backgroundNoiseGain;
        noiseSource.connect(noiseGain);
        noiseGain.connect(destination);
        noiseSource.start(startTime);
        noiseSource.stop(startTime + totalSeconds + 0.02);
      }

      oscillator.start(startTime);
      oscillator.stop(startTime + totalSeconds + 0.02);

      activeCleanup.push(() => {
        oscillator.stop();
        oscillator.disconnect();
        filter.disconnect();
        gainNode.disconnect();
        if (noiseSource) {
          noiseSource.stop();
          noiseSource.disconnect();
        }
        if (noiseGain) {
          noiseGain.disconnect();
        }
      });
    };

    const playFixture = async (fixtureId) => {
      await ensureAudioGraph();
      stopActiveFixture();
      const fixture = fixtures.find((entry) => entry.id === fixtureId);
      if (!fixture) {
        throw new Error(`Unknown voice fixture: ${fixtureId}`);
      }
      diagnostics.fixturePlayCount += 1;
      diagnostics.lastFixtureId = fixture.id;
      if (fixture.kind === "noise") {
        playNoiseFixture(fixture);
        return;
      }
      playVoiceLikeFixture(fixture);
    };

    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );
    const originalEnumerateDevices =
      navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const wantsAudio =
          typeof constraints === "object" &&
          constraints !== null &&
          "audio" in constraints &&
          constraints.audio !== false;
        const wantsVideo =
          typeof constraints === "object" &&
          constraints !== null &&
          "video" in constraints &&
          constraints.video !== false;
        if (wantsAudio && !wantsVideo) {
          await ensureAudioGraph();
          diagnostics.getUserMediaInterceptCount += 1;
          diagnostics.lastRequestedConstraints =
            typeof constraints === "object" && constraints !== null
              ? JSON.parse(JSON.stringify(constraints))
              : constraints ?? null;
          diagnostics.lastReturnedAudioTrackCount =
            destination.stream.getAudioTracks().length;
          return destination.stream;
        }
        if (!originalGetUserMedia) {
          throw new Error("Original getUserMedia is unavailable");
        }
        return originalGetUserMedia(constraints);
      };
    }

    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices = async () => {
        const devices = originalEnumerateDevices
          ? await originalEnumerateDevices()
          : [];
        return [
          ...devices.filter((device) => device.kind !== "audioinput"),
          {
            deviceId: "playwright-live-mic",
            groupId: "playwright-live-group",
            kind: "audioinput",
            label: "Playwright Synthetic Mic",
            toJSON() {
              return this;
            },
          },
        ];
      };
    }

    if (navigator.permissions?.query) {
      const originalPermissionsQuery = navigator.permissions.query.bind(
        navigator.permissions,
      );
      navigator.permissions.query = async (descriptor) => {
        if (descriptor.name === "microphone") {
          return {
            name: "microphone",
            onchange: null,
            state: "granted",
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return true;
            },
          };
        }
        return originalPermissionsQuery(descriptor);
      };
    }

    window.__pwLiveAudio = {
      clearTraces: () => {
        traceBuffer.splice(0, traceBuffer.length);
      },
      getDiagnostics: () => ({ ...diagnostics }),
      getTraces: () => traceBuffer.slice(),
      playFixture,
      stop: stopActiveFixture,
    };
  };
})();
