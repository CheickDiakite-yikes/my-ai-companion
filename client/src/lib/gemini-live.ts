import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

type TranscriptSender = "user" | "assistant";
type CameraFacingMode = "user" | "environment";
type LiveTranscriptionPayload = {
  text?: string;
  finished?: boolean;
};

export interface LiveTranscriptEvent {
  sender: TranscriptSender;
  text: string;
}

export interface GeminiLiveVoiceSessionCallbacks {
  onTranscript?: (event: LiveTranscriptEvent) => void;
  onError?: (error: Error) => void;
  onClosed?: (reason?: string) => void;
  onDebug?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface GeminiLiveVoiceSessionStartParams {
  ephemeralToken: string;
  model: string;
}

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 2048;
const VIDEO_FRAME_INTERVAL_MS = 1000;
const VIDEO_MAX_EDGE = 640;
const VIDEO_PERMISSION_TIMEOUT_MS = 12000;
const MICROPHONE_PERMISSION_TIMEOUT_MS = 12000;
const TRANSCRIPT_DUPLICATE_WINDOW_MS = 1500;
const TRANSCRIPT_FLUSH_DEBOUNCE_MS = 900;
const TRANSCRIPT_OVERLAP_MIN_CHARS = 6;

function normalizeText(input: string | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function findTranscriptOverlap(prefix: string, suffix: string): number {
  const maxOverlap = Math.min(prefix.length, suffix.length);
  for (let overlap = maxOverlap; overlap >= TRANSCRIPT_OVERLAP_MIN_CHARS; overlap -= 1) {
    if (
      prefix.slice(-overlap).toLowerCase() ===
      suffix.slice(0, overlap).toLowerCase()
    ) {
      return overlap;
    }
  }
  return 0;
}

function mergeTranscriptText(previous: string, incoming: string): string {
  const existing = normalizeText(previous);
  const next = normalizeText(incoming);

  if (!existing) return next;
  if (!next) return existing;

  if (existing === next) return existing;
  if (next.startsWith(existing)) return next;
  if (existing.startsWith(next)) return existing;
  if (existing.endsWith(next)) return existing;

  const overlap = findTranscriptOverlap(existing, next);
  const merged =
    overlap > 0
      ? `${existing} ${next.slice(overlap).trimStart()}`
      : `${existing} ${next}`;

  return normalizeText(merged);
}

function downsampleFloat32Buffer(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate >= inputSampleRate) return input;

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.round(input.length / sampleRateRatio);
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputOffset = 0;

  while (outputIndex < outputLength) {
    const nextInputOffset = Math.round((outputIndex + 1) * sampleRateRatio);
    let accumulator = 0;
    let count = 0;

    for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
      accumulator += input[i];
      count += 1;
    }

    output[outputIndex] = count > 0 ? accumulator / count : 0;
    outputIndex += 1;
    inputOffset = nextInputOffset;
  }

  return output;
}

function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] / 0x8000;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pcm16ToBase64(input: Float32Array, inputSampleRate: number): string {
  const mono16k = downsampleFloat32Buffer(input, inputSampleRate, INPUT_SAMPLE_RATE);
  const int16 = float32ToInt16(mono16k);
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  return bytesToBase64(bytes);
}

function base64ToPcm16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function getAudioContextConstructor(): typeof AudioContext {
  const win = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    win.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not supported in this browser");
  }
  return AudioContextCtor;
}

function createAudioContext(options?: AudioContextOptions): AudioContext {
  const AudioContextCtor = getAudioContextConstructor();
  return new AudioContextCtor(options);
}

function chooseVideoSize(video: HTMLVideoElement): { width: number; height: number } {
  const srcWidth = video.videoWidth || 640;
  const srcHeight = video.videoHeight || 360;
  const maxEdge = Math.max(srcWidth, srcHeight);
  if (maxEdge <= VIDEO_MAX_EDGE) {
    return { width: srcWidth, height: srcHeight };
  }

  const scale = VIDEO_MAX_EDGE / maxEdge;
  return {
    width: Math.max(2, Math.round(srcWidth * scale)),
    height: Math.max(2, Math.round(srcHeight * scale)),
  };
}

async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs = VIDEO_PERMISSION_TIMEOUT_MS,
): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error("Live voice requires a secure HTTPS connection");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Media capture API is not available in this browser");
  }

  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia(constraints),
      new Promise<MediaStream>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("Camera permission request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function getMicrophoneStreamWithFallback(): Promise<MediaStream> {
  const attemptConstraints: MediaStreamConstraints[] = [
    {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    },
    {
      audio: {
        channelCount: 1,
      },
      video: false,
    },
    {
      audio: true,
      video: false,
    },
  ];

  let lastError: unknown = null;
  for (let index = 0; index < attemptConstraints.length; index += 1) {
    try {
      return await getUserMediaWithTimeout(
        attemptConstraints[index],
        MICROPHONE_PERMISSION_TIMEOUT_MS,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Microphone permission was denied or unavailable");
}

export class GeminiLiveVoiceSession {
  private readonly callbacks: GeminiLiveVoiceSessionCallbacks;

  private session: Session | null = null;
  private outputContext: AudioContext | null = null;
  private inputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaSourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mutedGainNode: GainNode | null = null;

  private videoStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoCaptureInterval: number | null = null;
  private videoFrameInFlight = false;
  private preferredFacingMode: CameraFacingMode = "environment";

  private scheduledPlaybackTime = 0;
  private activePlaybackNodes = new Set<AudioBufferSourceNode>();
  private audioContextKeepAliveInterval: number | null = null;
  private pendingTranscriptBySender: Record<TranscriptSender, string> = {
    user: "",
    assistant: "",
  };
  private transcriptFlushTimeoutBySender: Record<TranscriptSender, number | null> = {
    user: null,
    assistant: null,
  };
  private lastTranscriptBySender: Record<
    TranscriptSender,
    { text: string; at: number } | null
  > = {
    user: null,
    assistant: null,
  };
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.ensureAudioContextsRunning();
    }
  };
  private readonly handleWindowFocus = () => {
    this.ensureAudioContextsRunning();
  };

  constructor(callbacks: GeminiLiveVoiceSessionCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start(params: GeminiLiveVoiceSessionStartParams): Promise<void> {
    if (this.session) {
      throw new Error("Live voice session is already running");
    }

    const ai = new GoogleGenAI({
      apiKey: params.ephemeralToken,
      apiVersion: "v1alpha",
    });

    this.outputContext = createAudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    await this.outputContext.resume();
    this.scheduledPlaybackTime = this.outputContext.currentTime;

    this.startAudioContextKeepAlive();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleWindowFocus);

    this.pendingTranscriptBySender = {
      user: "",
      assistant: "",
    };
    this.clearTranscriptFlushTimeout("user");
    this.clearTranscriptFlushTimeout("assistant");
    this.lastTranscriptBySender = {
      user: null,
      assistant: null,
    };

    this.session = await ai.live.connect({
      model: params.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          this.debug("live.session.open", { model: params.model });
        },
        onmessage: (message) => this.handleServerMessage(message),
        onerror: (event) => {
          const error = new Error(event.message || "Gemini Live session error");
          this.emitError(error);
        },
        onclose: (event) => {
          this.debug("live.session.closed", { reason: event.reason || "unknown" });
          this.callbacks.onClosed?.(event.reason || undefined);
        },
      },
    });

    await this.startMicrophoneStream();
  }

  async stop(): Promise<void> {
    this.flushPendingTranscript("user", "turn_complete");
    this.flushPendingTranscript("assistant", "turn_complete");

    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      // Ignore cleanup error.
    }

    try {
      this.session?.close();
    } catch {
      // Ignore cleanup error.
    }

    this.session = null;
    this.pendingTranscriptBySender = {
      user: "",
      assistant: "",
    };
    this.clearTranscriptFlushTimeout("user");
    this.clearTranscriptFlushTimeout("assistant");
    this.lastTranscriptBySender = {
      user: null,
      assistant: null,
    };
    this.clearPlaybackQueue();
    this.stopAudioContextKeepAlive();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("focus", this.handleWindowFocus);
    await this.stopVideo();

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.mediaSourceNode) {
      this.mediaSourceNode.disconnect();
      this.mediaSourceNode = null;
    }
    if (this.mutedGainNode) {
      this.mutedGainNode.disconnect();
      this.mutedGainNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.inputContext) {
      await this.inputContext.close().catch(() => {});
      this.inputContext = null;
    }

    if (this.outputContext) {
      await this.outputContext.close().catch(() => {});
      this.outputContext = null;
    }
  }

  async startVideo(params: { facingMode?: CameraFacingMode } = {}): Promise<MediaStream> {
    if (!this.session) {
      throw new Error("Cannot start camera stream without an active live session");
    }

    const facingMode = params.facingMode ?? this.preferredFacingMode;
    this.preferredFacingMode = facingMode;

    await this.stopVideo();

    const oppositeFacingMode: CameraFacingMode =
      facingMode === "user" ? "environment" : "user";
    const attemptConstraints: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: oppositeFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
    ];

    let lastError: unknown = null;
    try {
      for (let index = 0; index < attemptConstraints.length; index += 1) {
        try {
          this.videoStream = await getUserMediaWithTimeout(attemptConstraints[index]);
          break;
        } catch (attemptError) {
          lastError = attemptError;
          this.debug("live.video.camera_attempt_failed", {
            attempt: index + 1,
            message:
              attemptError instanceof Error
                ? attemptError.message
                : String(attemptError),
          });
        }
      }
    } catch (error) {
      lastError = error;
    }

    if (!this.videoStream) {
      this.emitError(new Error("Camera permission was denied or unavailable"));
      throw (lastError ?? new Error("Camera permission was denied or unavailable"));
    }

    this.videoElement = document.createElement("video");
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.autoplay = true;
    this.videoElement.srcObject = this.videoStream;
    await this.videoElement.play();

    this.videoCanvas = document.createElement("canvas");
    this.startVideoCaptureLoop();

    const resolvedFacingMode = this.videoStream
      .getVideoTracks()
      .at(0)
      ?.getSettings()
      .facingMode;
    if (resolvedFacingMode === "user" || resolvedFacingMode === "environment") {
      this.preferredFacingMode = resolvedFacingMode;
    }

    this.debug("live.video.started", {
      facingMode: this.preferredFacingMode,
      requestedFacingMode: facingMode,
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
    });

    return this.videoStream;
  }

  async stopVideo(): Promise<void> {
    if (this.videoCaptureInterval !== null) {
      window.clearInterval(this.videoCaptureInterval);
      this.videoCaptureInterval = null;
    }

    this.videoFrameInFlight = false;

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }

    this.videoCanvas = null;
    this.debug("live.video.stopped");
  }

  async flipCamera(): Promise<CameraFacingMode> {
    this.preferredFacingMode =
      this.preferredFacingMode === "user" ? "environment" : "user";

    if (this.videoStream) {
      await this.startVideo({ facingMode: this.preferredFacingMode });
    }

    this.debug("live.video.flipped", {
      facingMode: this.preferredFacingMode,
    });

    return this.preferredFacingMode;
  }

  getVideoStream(): MediaStream | null {
    return this.videoStream;
  }

  isVideoEnabled(): boolean {
    return Boolean(this.videoStream && this.videoCaptureInterval !== null);
  }

  getFacingMode(): CameraFacingMode {
    return this.preferredFacingMode;
  }

  private startVideoCaptureLoop(): void {
    if (!this.videoElement || !this.videoCanvas) {
      return;
    }

    const renderFrame = () => {
      if (
        !this.session ||
        !this.videoElement ||
        !this.videoCanvas ||
        this.videoFrameInFlight
      ) {
        return;
      }

      if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const { width, height } = chooseVideoSize(this.videoElement);
      this.videoCanvas.width = width;
      this.videoCanvas.height = height;

      const ctx = this.videoCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(this.videoElement, 0, 0, width, height);

      this.videoFrameInFlight = true;
      try {
        if (!this.session) {
          this.debug("live.video.frame_dropped", {
            reason: "session_missing",
          });
          return;
        }

        const dataUrl = this.videoCanvas.toDataURL("image/jpeg", 0.72);
        const base64 = dataUrl.split(",")[1];
        if (!base64) {
          this.debug("live.video.frame_dropped", {
            reason: "encode_failed",
          });
          return;
        }

        this.session.sendRealtimeInput({
          video: {
            data: base64,
            mimeType: "image/jpeg",
          },
        });
        this.debug("live.video.frame_sent", {
          bytes: Math.floor((base64.length * 3) / 4),
          mimeType: "image/jpeg",
          width,
          height,
        });
      } finally {
        this.videoFrameInFlight = false;
      }
    };

    renderFrame();
    this.videoCaptureInterval = window.setInterval(renderFrame, VIDEO_FRAME_INTERVAL_MS);
  }

  private startAudioContextKeepAlive(): void {
    this.stopAudioContextKeepAlive();
    this.audioContextKeepAliveInterval = window.setInterval(() => {
      this.ensureAudioContextsRunning();
    }, 2000);
  }

  private stopAudioContextKeepAlive(): void {
    if (this.audioContextKeepAliveInterval !== null) {
      clearInterval(this.audioContextKeepAliveInterval);
      this.audioContextKeepAliveInterval = null;
    }
  }

  private ensureAudioContextsRunning(): void {
    if (this.outputContext && this.outputContext.state === "suspended") {
      this.debug("live.audio.output_context_resuming");
      this.outputContext.resume().catch(() => {});
    }
    if (this.inputContext && this.inputContext.state === "suspended") {
      this.debug("live.audio.input_context_resuming");
      this.inputContext.resume().catch(() => {});
    }
  }

  private async startMicrophoneStream(): Promise<void> {
    if (!this.session) {
      throw new Error("Cannot start microphone stream without a live session");
    }

    try {
      this.mediaStream = await getMicrophoneStreamWithFallback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Microphone permission was denied or unavailable";
      this.emitError(new Error(message));
      throw error;
    }

    this.inputContext = createAudioContext();
    await this.inputContext.resume();

    this.mediaSourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.inputContext.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      1,
      1,
    );
    this.mutedGainNode = this.inputContext.createGain();
    this.mutedGainNode.gain.value = 0;

    this.mediaSourceNode.connect(this.processorNode);
    this.processorNode.connect(this.mutedGainNode);
    this.mutedGainNode.connect(this.inputContext.destination);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.session || !this.inputContext) return;
      if (this.inputContext.state === "suspended") {
        this.inputContext.resume().catch(() => {});
        return;
      }
      const pcmBase64 = pcm16ToBase64(
        event.inputBuffer.getChannelData(0),
        this.inputContext.sampleRate,
      );
      try {
        this.session.sendRealtimeInput({
          audio: {
            data: pcmBase64,
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });
      } catch (error) {
        this.debug("live.audio.send_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }

  private handleServerMessage(message: LiveServerMessage): void {
    const serverContent = message.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      this.debug("live.server.interrupted");
      this.clearPlaybackQueue();
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
      const audioData = part.inlineData?.data;
      if (audioData) {
        this.enqueueAudio(audioData);
      }
    }

    this.captureTranscript("user", serverContent.inputTranscription);
    this.captureTranscript("assistant", serverContent.outputTranscription);

    if (serverContent.turnComplete) {
      this.flushPendingTranscript("user", "turn_complete");
      this.flushPendingTranscript("assistant", "turn_complete");
    }
  }

  private enqueueAudio(base64Audio: string): void {
    if (!this.outputContext) return;

    if (this.outputContext.state === "suspended") {
      this.outputContext.resume().catch(() => {});
    }

    const int16 = base64ToPcm16(base64Audio);
    if (int16.length === 0) return;

    const float32 = int16ToFloat32(int16);
    const audioBuffer = this.outputContext.createBuffer(
      1,
      float32.length,
      OUTPUT_SAMPLE_RATE,
    );
    audioBuffer.copyToChannel(float32, 0);

    const source = this.outputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputContext.destination);

    const now = this.outputContext.currentTime;
    if (this.scheduledPlaybackTime < now) {
      this.scheduledPlaybackTime = now + 0.02;
    }

    source.start(this.scheduledPlaybackTime);
    this.scheduledPlaybackTime += audioBuffer.duration;
    this.activePlaybackNodes.add(source);

    source.onended = () => {
      this.activePlaybackNodes.delete(source);
    };
  }

  private clearPlaybackQueue(): void {
    this.activePlaybackNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Ignore already-ended nodes.
      }
      node.disconnect();
    });
    this.activePlaybackNodes.clear();
    if (this.outputContext) {
      this.scheduledPlaybackTime = this.outputContext.currentTime + 0.02;
    }
  }

  private captureTranscript(
    sender: TranscriptSender,
    transcript: LiveTranscriptionPayload | undefined,
  ): void {
    if (!transcript) return;

    const text = normalizeText(transcript.text);
    if (!text) return;

    const mergedText = mergeTranscriptText(
      this.pendingTranscriptBySender[sender],
      text,
    );
    this.pendingTranscriptBySender[sender] = mergedText;
    this.debug("live.transcript.received", {
      sender,
      textLength: text.length,
      mergedTextLength: mergedText.length,
      finished: Boolean(transcript.finished),
    });

    if (transcript.finished) {
      this.scheduleTranscriptFlush(sender);
    }
  }

  private flushPendingTranscript(
    sender: TranscriptSender,
    reason: "finished" | "turn_complete" | "idle_timeout",
  ): void {
    this.clearTranscriptFlushTimeout(sender);
    const pendingText = this.pendingTranscriptBySender[sender];
    if (!pendingText) return;
    this.pendingTranscriptBySender[sender] = "";
    this.emitTranscript(sender, pendingText, reason);
  }

  private scheduleTranscriptFlush(sender: TranscriptSender): void {
    this.clearTranscriptFlushTimeout(sender);
    this.transcriptFlushTimeoutBySender[sender] = window.setTimeout(() => {
      this.transcriptFlushTimeoutBySender[sender] = null;
      this.flushPendingTranscript(sender, "finished");
    }, TRANSCRIPT_FLUSH_DEBOUNCE_MS);
  }

  private clearTranscriptFlushTimeout(sender: TranscriptSender): void {
    const timeout = this.transcriptFlushTimeoutBySender[sender];
    if (timeout !== null) {
      window.clearTimeout(timeout);
      this.transcriptFlushTimeoutBySender[sender] = null;
    }
  }

  private emitTranscript(
    sender: TranscriptSender,
    rawText: string | undefined,
    reason: "finished" | "turn_complete" | "idle_timeout",
  ): void {
    const text = normalizeText(rawText);
    if (!text) return;

    const now = Date.now();
    const last = this.lastTranscriptBySender[sender];
    if (last && last.text === text && now - last.at < TRANSCRIPT_DUPLICATE_WINDOW_MS) {
      this.debug("live.transcript.duplicate_skipped", {
        sender,
        textLength: text.length,
        reason,
      });
      return;
    }
    this.lastTranscriptBySender[sender] = { text, at: now };

    this.callbacks.onTranscript?.({ sender, text });
  }

  private emitError(error: Error): void {
    this.callbacks.onError?.(error);
  }

  private debug(message: string, metadata?: Record<string, unknown>): void {
    this.callbacks.onDebug?.(message, metadata);
  }
}
