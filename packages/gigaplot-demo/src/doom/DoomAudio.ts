/** Frames Doom mixes per call, about 21 ms at 48 kHz. */
export const AUDIO_CHUNK_FRAMES = 1024;

/** How far ahead of playback the chunks are scheduled. */
export const AUDIO_LEAD_SECONDS = 0.1;

/** Where the first chunk goes after a stall, so it doesn't start in the past. */
const AUDIO_RESTART_SECONDS = 0.02;

export interface DoomAudioExports {
  malloc: (size: number) => number;
  /** Mixes `frames` interleaved stereo 16 bit samples at `rate` Hz. */
  doom_audio_mix: (pointer: number, frames: number, rate: number) => void;
}

/**
 * Plays the music and sound effects Doom mixes, through Web Audio.
 *
 * Browsers keep an AudioContext suspended until the page gets a click or key
 * press. Until then the audio is still mixed, at the pace it would play, and
 * dropped, so the music is in the right place and sounds haven't piled up by
 * the time it starts.
 */
export class DoomAudio {
  private readonly context: AudioContext;

  private readonly memory: WebAssembly.Memory;

  private readonly exports: DoomAudioExports;

  private readonly pointer: number;

  /** Context time the next chunk starts at, while playing. */
  private nextTime = 0;

  /** Time in ms that audio has been mixed up to, while suspended. */
  private mutedUntil: number;

  private isMuted = false;

  constructor(
    context: AudioContext,
    memory: WebAssembly.Memory,
    exports: DoomAudioExports,
    now = performance.now(),
  ) {
    this.context = context;
    this.memory = memory;
    this.exports = exports;
    this.pointer = exports.malloc(AUDIO_CHUNK_FRAMES * 4);
    this.mutedUntil = now;
  }

  /** Call from a click or key press, so the browser lets the audio start. */
  resume(): void {
    if (!this.isMuted && this.context.state === "suspended") {
      this.context.resume().catch(() => undefined);
    }
  }

  /**
   * Muting suspends the context, so the audio is mixed and dropped as it is
   * before the first click, and the music is still in time when unmuted.
   */
  setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
    if (isMuted) {
      if (this.context.state === "running") {
        this.context.suspend().catch(() => undefined);
      }
    } else {
      this.resume();
    }
  }

  /** Mixes the audio due since the last call. Call after each game step. */
  pump(now = performance.now()): void {
    const { context } = this;
    if (context.state !== "running") {
      this.drop(now);
      return;
    }
    this.mutedUntil = now;
    if (this.nextTime <= context.currentTime) {
      this.nextTime = context.currentTime + AUDIO_RESTART_SECONDS;
    }
    while (this.nextTime < context.currentTime + AUDIO_LEAD_SECONDS) {
      const samples = this.mix();
      const buffer = context.createBuffer(
        2,
        AUDIO_CHUNK_FRAMES,
        context.sampleRate,
      );
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let i = 0; i < AUDIO_CHUNK_FRAMES; i += 1) {
        left[i] = samples[i * 2] / 32768;
        right[i] = samples[i * 2 + 1] / 32768;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(this.nextTime);
      this.nextTime += AUDIO_CHUNK_FRAMES / context.sampleRate;
    }
  }

  close(): void {
    if (this.context.state !== "closed") {
      this.context.close().catch(() => undefined);
    }
  }

  private drop(now: number): void {
    const chunkMs = (AUDIO_CHUNK_FRAMES / this.context.sampleRate) * 1000;
    // Animation frames stop in background tabs, so don't catch up on all that
    if (now - this.mutedUntil > 1000) {
      this.mutedUntil = now - chunkMs;
    }
    while (now - this.mutedUntil >= chunkMs) {
      this.mix();
      this.mutedUntil += chunkMs;
    }
  }

  private mix(): Int16Array {
    const { exports, pointer } = this;
    exports.doom_audio_mix(
      pointer,
      AUDIO_CHUNK_FRAMES,
      this.context.sampleRate,
    );
    // After mixing, as memory growth detaches the old buffer
    return new Int16Array(this.memory.buffer, pointer, AUDIO_CHUNK_FRAMES * 2);
  }
}

export default DoomAudio;
