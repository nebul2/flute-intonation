/* Capture worklet: accumulates the 128-sample render quanta into hop-sized
 * blocks and posts them to the main thread. Runs on the audio thread; keep it
 * allocation-free per quantum apart from the posted copy. */
"use strict";

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = 512;
    this.buffer = new Float32Array(this.hop);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const take = Math.min(this.hop - this.filled, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === this.hop) {
        this.port.postMessage(this.buffer.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
