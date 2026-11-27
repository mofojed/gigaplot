import { AUDIO_CHUNK_FRAMES, DoomAudio } from "./DoomAudio";

// A power of two, so a chunk lasts exactly 125 ms
const SAMPLE_RATE = AUDIO_CHUNK_FRAMES * 8;

const POINTER = 64;

interface Started {
  time: number;
  left: Float32Array;
  right: Float32Array;
}

function createAudio(state: AudioContextState) {
  const started: Started[] = [];
  const context = {
    state,
    currentTime: 0,
    sampleRate: SAMPLE_RATE,
    destination: {},
    resume: jest.fn(() => Promise.resolve()),
    suspend: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    createBuffer: (channels: number, length: number) => {
      const data = [new Float32Array(length), new Float32Array(length)];
      return { getChannelData: (channel: number) => data[channel] };
    },
    createBufferSource: () => {
      const source = {
        buffer: null as ReturnType<typeof context.createBuffer> | null,
        connect: jest.fn(),
        start: (time: number) =>
          started.push({
            time,
            left: source.buffer!.getChannelData(0),
            right: source.buffer!.getChannelData(1),
          }),
      };
      return source;
    },
  };
  const memory = { buffer: new ArrayBuffer(65536) };
  const exports = {
    malloc: () => POINTER,
    doom_audio_mix: jest.fn((pointer: number, frames: number) => {
      const samples = new Int16Array(memory.buffer, pointer, frames * 2);
      for (let i = 0; i < frames; i += 1) {
        samples[i * 2] = 16384;
        samples[i * 2 + 1] = -16384;
      }
    }),
  };
  const audio = new DoomAudio(
    context as unknown as AudioContext,
    memory as WebAssembly.Memory,
    exports,
    0,
  );
  return { audio, context, exports, started };
}

it("schedules chunks a little ahead while running", () => {
  const { audio, context, started } = createAudio("running");

  audio.pump(0);
  context.currentTime = 0.1;
  audio.pump(100);

  expect(started.map(({ time }) => time)).toEqual([
    expect.closeTo(0.02),
    expect.closeTo(0.145),
  ]);
  expect(started[0].left[0]).toBe(0.5);
  expect(started[0].right[AUDIO_CHUNK_FRAMES - 1]).toBe(-0.5);
});

it("mixes and drops audio at the pace it would play while suspended", () => {
  const { audio, exports, started } = createAudio("suspended");

  audio.pump(250);
  expect(exports.doom_audio_mix).toHaveBeenCalledTimes(2);
  audio.pump(300);
  expect(exports.doom_audio_mix).toHaveBeenCalledTimes(2);
  audio.pump(375);
  expect(exports.doom_audio_mix).toHaveBeenCalledTimes(3);
  expect(started).toEqual([]);
});

it("doesn't catch up on a long stall while suspended", () => {
  const { audio, exports } = createAudio("suspended");

  audio.pump(60_000);

  expect(exports.doom_audio_mix).toHaveBeenCalledTimes(1);
});

it("stays quiet while muted, even after a key press", () => {
  const { audio, context } = createAudio("running");

  audio.setMuted(true);
  expect(context.suspend).toHaveBeenCalledTimes(1);
  context.state = "suspended";
  audio.resume();
  expect(context.resume).not.toHaveBeenCalled();

  audio.setMuted(false);
  expect(context.resume).toHaveBeenCalledTimes(1);
});
