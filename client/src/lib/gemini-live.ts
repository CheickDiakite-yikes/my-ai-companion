import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

type TranscriptSender = "user" | "assistant";

export interface LiveTranscriptEvent {
  sender: TranscriptSender;
  text: string;
}

export interface GeminiLiveVoiceSessionCallbacks {
  onTranscript?: (event: LiveTranscriptEvent) => void;
  onError?: (error: Error) => void;
  onDebug?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface GeminiLiveVoiceSessionStartParams {
  ephemeralToken: string;
  model: string;
}

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 4096;

function normalizeText(input: string | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
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

export class GeminiLiveVoiceSession {
  private readonly callbacks: GeminiLiveVoiceSessionCallbacks;

  private session: Session | null = null;
  private outputContext: AudioContext | null = null;
  private inputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaSourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mutedGainNode: GainNode | null = null;

  private scheduledPlaybackTime = 0;
  private activePlaybackNodes = new Set<AudioBufferSourceNode>();
  private lastTranscriptBySender: Record<TranscriptSender, string> = {
    user: "",
    assistant: "",
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

    this.outputContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    await this.outputContext.resume();
    this.scheduledPlaybackTime = this.outputContext.currentTime;

    this.session = await ai.live.connect({
      model: params.model,
      config: {
        responseModalities: [Modality.AUDIO],
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
        },
      },
    });

    await this.startMicrophoneStream();
  }

  async stop(): Promise<void> {
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
    this.clearPlaybackQueue();

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

  private async startMicrophoneStream(): Promise<void> {
    if (!this.session) {
      throw new Error("Cannot start microphone stream without a live session");
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      this.emitError(new Error("Microphone permission was denied or unavailable"));
      throw error;
    }

    this.inputContext = new AudioContext();
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
      const pcmBase64 = pcm16ToBase64(
        event.inputBuffer.getChannelData(0),
        this.inputContext.sampleRate,
      );
      this.session.sendRealtimeInput({
        audio: {
          data: pcmBase64,
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      });
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

    const inputTranscript = serverContent.inputTranscription;
    if (inputTranscript?.finished) {
      this.emitTranscript("user", inputTranscript.text);
    }

    const outputTranscript = serverContent.outputTranscription;
    if (outputTranscript?.finished) {
      this.emitTranscript("assistant", outputTranscript.text);
    }
  }

  private enqueueAudio(base64Audio: string): void {
    if (!this.outputContext) return;

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

  private emitTranscript(sender: TranscriptSender, rawText: string | undefined): void {
    const text = normalizeText(rawText);
    if (!text) return;

    if (this.lastTranscriptBySender[sender] === text) return;
    this.lastTranscriptBySender[sender] = text;

    this.callbacks.onTranscript?.({ sender, text });
  }

  private emitError(error: Error): void {
    this.callbacks.onError?.(error);
  }

  private debug(message: string, metadata?: Record<string, unknown>): void {
    this.callbacks.onDebug?.(message, metadata);
  }
}
