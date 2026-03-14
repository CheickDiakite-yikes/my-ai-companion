import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

type PostedMessage = {
  payload: Record<string, unknown>;
  transfers: unknown[];
};

type RegisteredProcessorConstructor = new (options?: {
  processorOptions?: Record<string, unknown>;
}) => {
  port: {
    postMessage: (payload: Record<string, unknown>, transfers?: unknown[]) => void;
    onmessage: ((event: { data?: Record<string, unknown> }) => void) | null;
  };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

async function main(): Promise<void> {
  await verifyChunkingBehavior(48_000);
  await verifyChunkingBehavior(44_100);
  await verifyChunkingBehavior(32_000);
  await verifyFlushBehavior(48_000);
  await verifyFlushBehavior(44_100);
  await verifyFlushBehavior(32_000);

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: [
          "48k_to_16k_chunking",
          "44.1k_to_16k_chunking",
          "32k_to_16k_chunking",
          "rms_emission",
          "partial_flush_tail_delivery",
        ],
      },
      null,
      2,
    ),
  );
}

async function loadCaptureWorkletProcessor(params: {
  sampleRate: number;
}): Promise<RegisteredProcessorConstructor> {
  const sourcePath = resolve(
    "client/src/lib/live-input-capture.worklet.js",
  );
  const source = await readFile(sourcePath, "utf8");

  const messages: PostedMessage[] = [];
  let registeredProcessor: RegisteredProcessorConstructor | null = null;

  class AudioWorkletProcessorMock {
    port = {
      postMessage: (payload: Record<string, unknown>, transfers: unknown[] = []) => {
        messages.push({ payload, transfers });
      },
      onmessage: null as ((event: { data?: Record<string, unknown> }) => void) | null,
    };
  }

  const context = vm.createContext({
    sampleRate: params.sampleRate,
    Float32Array,
    Int16Array,
    Math,
    AudioWorkletProcessor: AudioWorkletProcessorMock,
    registerProcessor: (_name: string, ctor: RegisteredProcessorConstructor) => {
      registeredProcessor = ctor;
    },
  });

  new vm.Script(source, { filename: sourcePath }).runInContext(context);
  assert.ok(registeredProcessor, "capture worklet should register a processor");

  return class ProcessorProxy {
    port;
    process;

    constructor(options?: { processorOptions?: Record<string, unknown> }) {
      const instance = new registeredProcessor!(options);
      this.port = instance.port;
      this.process = instance.process.bind(instance);
      Object.defineProperty(this.port, "__messages", {
        configurable: false,
        enumerable: false,
        value: messages,
        writable: false,
      });
    }
  } as unknown as RegisteredProcessorConstructor;
}

async function verifyChunkingBehavior(sampleRate: number): Promise<void> {
  const ProcessorCtor = await loadCaptureWorkletProcessor({
    sampleRate,
  });
  const instance = new ProcessorCtor({
    processorOptions: {
      targetSampleRate: 16_000,
      outputChunkSamples: 512,
    },
  });
  const messages = readProcessorMessages(instance);
  const requiredSourceSamples = Math.floor((512 * sampleRate) / 16_000);
  const processBlockSize = 128;
  const processCallsBeforeEmit = Math.floor((requiredSourceSamples - 1) / processBlockSize);

  for (let blockIndex = 0; blockIndex < processCallsBeforeEmit; blockIndex += 1) {
    const input = makeSineWaveBlock(
      processBlockSize,
      sampleRate,
      220,
      blockIndex * processBlockSize,
    );
    const keepAlive = instance.process([[input]], [[]]);
    assert.equal(keepAlive, true);
  }

  assert.equal(
    messages.filter((entry) => entry.payload.type === "audio").length,
    0,
    `${sampleRate}Hz capture should not emit a 16k audio chunk before enough source samples are accumulated`,
  );

  const finalBlock = makeSineWaveBlock(
    processBlockSize,
    sampleRate,
    220,
    processCallsBeforeEmit * processBlockSize,
  );
  instance.process([[finalBlock]], [[]]);

  const rmsMessages = messages.filter((entry) => entry.payload.type === "rms");
  const audioMessages = messages.filter((entry) => entry.payload.type === "audio");
  assert.equal(
    rmsMessages.length,
    processCallsBeforeEmit + 1,
    `${sampleRate}Hz worklet should emit RMS for every process call`,
  );
  assert.equal(
    audioMessages.length,
    1,
    `${sampleRate}Hz capture should emit exactly one 512-sample 16k chunk after enough source audio arrives`,
  );

  const pcmMessage = audioMessages[0];
  const pcmBuffer = pcmMessage.payload.pcm16;
  assert.ok(pcmBuffer instanceof ArrayBuffer, "audio message should transfer an ArrayBuffer");
  const pcmSamples = new Int16Array(pcmBuffer);
  assert.equal(pcmSamples.length, 512, "downsampled PCM chunk should contain 512 samples");
  assert.equal(
    pcmSamples.some((sample) => sample !== 0),
    true,
    `${sampleRate}Hz downsampled PCM chunk should contain non-zero speech samples`,
  );
}

async function verifyFlushBehavior(sampleRate: number): Promise<void> {
  const ProcessorCtor = await loadCaptureWorkletProcessor({
    sampleRate,
  });
  const instance = new ProcessorCtor({
    processorOptions: {
      targetSampleRate: 16_000,
      outputChunkSamples: 512,
    },
  });
  const messages = readProcessorMessages(instance);

  const shortInput = makeSineWaveBlock(128, sampleRate, 330, 0);
  instance.process([[shortInput]], [[]]);
  assert.equal(
    messages.filter((entry) => entry.payload.type === "audio").length,
    0,
    `${sampleRate}Hz partial input should remain buffered before flush`,
  );

  instance.port.onmessage?.({ data: { type: "flush" } });
  const flushAudioMessages = messages.filter((entry) => entry.payload.type === "audio");
  const flushDoneMessages = messages.filter(
    (entry) => entry.payload.type === "flush_complete",
  );
  assert.equal(flushDoneMessages.length, 1, "flush should acknowledge completion");
  assert.equal(flushAudioMessages.length, 1, "flush should emit the pending tail chunk");

  const tailBuffer = flushAudioMessages[0].payload.pcm16;
  assert.ok(tailBuffer instanceof ArrayBuffer, "tail flush should transfer PCM bytes");
  const tailSamples = new Int16Array(tailBuffer);
  assert.equal(
    tailSamples.length > 0 && tailSamples.length < 512,
    true,
    `${sampleRate}Hz tail flush should emit a partial chunk smaller than the normal 512-sample frame`,
  );
}

function readProcessorMessages(instance: {
  port: {
    __messages?: PostedMessage[];
  };
}): PostedMessage[] {
  const messages = instance.port.__messages;
  assert.ok(Array.isArray(messages), "processor test harness should expose posted messages");
  messages.length = 0;
  return messages;
}

function makeSineWaveBlock(
  length: number,
  sampleRate: number,
  frequencyHz: number,
  startOffset: number,
): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const phase = ((startOffset + index) / sampleRate) * Math.PI * 2 * frequencyHz;
    output[index] = Math.sin(phase) * 0.35;
  }
  return output;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
