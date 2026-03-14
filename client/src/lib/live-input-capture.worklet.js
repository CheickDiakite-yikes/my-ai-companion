function downsampleFloat32Buffer(input, inputSampleRate, targetSampleRate, outputLength) {
  if (outputLength <= 0) {
    return new Float32Array(0);
  }

  if (targetSampleRate >= inputSampleRate) {
    if (input.length === outputLength) {
      return input;
    }
    const output = new Float32Array(outputLength);
    if (input.length === 0) {
      return output;
    }
    const scale = input.length / outputLength;
    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = Math.min(
        input.length - 1,
        Math.max(0, Math.round(i * scale)),
      );
      output[i] = input[sourceIndex];
    }
    return output;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const output = new Float32Array(outputLength);
  const halfKernel = Math.ceil(ratio);

  for (let i = 0; i < outputLength; i += 1) {
    const center = i * ratio;
    const lo = Math.max(0, Math.ceil(center - halfKernel));
    const hi = Math.min(input.length - 1, Math.floor(center + halfKernel));
    let sum = 0;
    let weightSum = 0;
    for (let j = lo; j <= hi; j += 1) {
      const weight = 1 - Math.abs(j - center) / halfKernel;
      sum += input[j] * weight;
      weightSum += weight;
    }
    output[i] = weightSum > 0 ? sum / weightSum : 0;
  }

  return output;
}

function float32ToInt16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

class LiveInputCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.targetSampleRate = Number.isFinite(processorOptions.targetSampleRate)
      ? processorOptions.targetSampleRate
      : 16000;
    this.outputChunkSamples =
      Number.isFinite(processorOptions.outputChunkSamples) &&
      processorOptions.outputChunkSamples > 0
        ? Math.floor(processorOptions.outputChunkSamples)
        : 512;
    this.inputChunkSamplesExact =
      (this.outputChunkSamples * sampleRate) / this.targetSampleRate;
    this.sourceBlocks = [];
    this.sourceBlockOffset = 0;
    this.totalSourceSamples = 0;
    this.chunkIndex = 0;

    this.port.onmessage = (event) => {
      if (event?.data?.type === "flush") {
        this.flushPendingAudio();
        this.port.postMessage({ type: "flush_complete" });
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (output) {
      output.fill(0);
    }

    if (!input || input.length === 0) {
      return true;
    }

    let sumSquares = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index];
      sumSquares += sample * sample;
    }
    this.port.postMessage({
      type: "rms",
      rms: Math.sqrt(sumSquares / input.length),
      sampleCount: input.length,
    });

    const copy = new Float32Array(input.length);
    copy.set(input);
    this.sourceBlocks.push(copy);
    this.totalSourceSamples += copy.length;
    this.emitReadyAudioChunks();
    return true;
  }

  emitReadyAudioChunks() {
    let inputSamplesForNextChunk = this.getInputSamplesForChunk(this.chunkIndex);
    while (this.totalSourceSamples >= inputSamplesForNextChunk) {
      const sourceChunk = this.drainSourceSamples(inputSamplesForNextChunk);
      const downsampledChunk = downsampleFloat32Buffer(
        sourceChunk,
        sampleRate,
        this.targetSampleRate,
        this.outputChunkSamples,
      );
      const pcm16 = float32ToInt16(downsampledChunk);
      this.port.postMessage(
        {
          type: "audio",
          pcm16: pcm16.buffer,
          sampleCount: pcm16.length,
        },
        [pcm16.buffer],
      );
      this.chunkIndex += 1;
      inputSamplesForNextChunk = this.getInputSamplesForChunk(this.chunkIndex);
    }
  }

  flushPendingAudio() {
    if (this.totalSourceSamples <= 0) {
      return;
    }
    const sourceChunk = this.drainSourceSamples(this.totalSourceSamples);
    const outputLength =
      sampleRate === this.targetSampleRate
        ? sourceChunk.length
        : Math.max(1, Math.round((sourceChunk.length * this.targetSampleRate) / sampleRate));
    const downsampledChunk = downsampleFloat32Buffer(
      sourceChunk,
      sampleRate,
      this.targetSampleRate,
      outputLength,
    );
    const pcm16 = float32ToInt16(downsampledChunk);
    this.port.postMessage(
      {
        type: "audio",
        pcm16: pcm16.buffer,
        sampleCount: pcm16.length,
      },
      [pcm16.buffer],
    );
  }

  getInputSamplesForChunk(chunkIndex) {
    const current = Math.floor(this.inputChunkSamplesExact * chunkIndex);
    const next = Math.floor(this.inputChunkSamplesExact * (chunkIndex + 1));
    return Math.max(1, next - current);
  }

  drainSourceSamples(requestedSamples) {
    const output = new Float32Array(requestedSamples);
    let writeOffset = 0;

    while (writeOffset < requestedSamples && this.sourceBlocks.length > 0) {
      const block = this.sourceBlocks[0];
      const available = block.length - this.sourceBlockOffset;
      const take = Math.min(requestedSamples - writeOffset, available);
      output.set(
        block.subarray(this.sourceBlockOffset, this.sourceBlockOffset + take),
        writeOffset,
      );
      writeOffset += take;
      this.sourceBlockOffset += take;
      if (this.sourceBlockOffset >= block.length) {
        this.sourceBlocks.shift();
        this.sourceBlockOffset = 0;
      }
    }

    this.totalSourceSamples = Math.max(0, this.totalSourceSamples - requestedSamples);
    return output;
  }
}

registerProcessor("live-input-capture", LiveInputCaptureProcessor);
