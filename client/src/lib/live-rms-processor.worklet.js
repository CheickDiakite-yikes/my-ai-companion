class LiveRmsAnalyzerProcessor extends AudioWorkletProcessor {
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

    const rms = Math.sqrt(sumSquares / input.length);
    this.port.postMessage({
      rms,
      sampleCount: input.length,
    });
    return true;
  }
}

registerProcessor("live-rms-analyzer", LiveRmsAnalyzerProcessor);
