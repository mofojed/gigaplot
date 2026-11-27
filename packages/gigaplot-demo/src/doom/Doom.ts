import doomUrl from "./doom.wasm?url";
import wadUrl from "./doom1.wad?url";
import { DoomAudio, type DoomAudioExports } from "./DoomAudio";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";

/** Size of the RGBA frame the port hands to `js_draw_screen`. */
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 400;

/** Pages of 64 KiB the port expects its memory to start with. */
const INITIAL_MEMORY_PAGES = 108;

interface DoomExports extends DoomAudioExports {
  main: () => void;
  exit: () => void;
  doom_loop_step: () => void;
  add_browser_event: (event: number, keyCode: number) => void;
  /** Copies the 8 bit, palette indexed screen into `pointer`. */
  I_ReadScreen: (pointer: number) => void;
  /** Allocates `length` bytes for the IWAD, which must be filled before `main`. */
  doom_iwad_buffer: (length: number) => number;
}

interface DoomFiles {
  module: WebAssembly.Module;
  wad: Uint8Array;
}

let filesPromise: Promise<DoomFiles> | undefined;

async function fetchBytes(url: string, name: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${name}: ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * Loads the port and the shareware IWAD once per page. React's strict mode
 * starts and stops the game twice, and reloading 5 MB each time is noticeable.
 */
function loadDoom(): Promise<DoomFiles> {
  if (filesPromise == null) {
    filesPromise = Promise.all([
      // Not compileStreaming, which rejects hosts that serve the wrong MIME type
      fetchBytes(doomUrl, "Doom").then((bytes) => WebAssembly.compile(bytes)),
      fetchBytes(wadUrl, "doom1.wad").then((bytes) => new Uint8Array(bytes)),
    ]).then(([module, wad]) => ({ module, wad }));
    filesPromise.catch(() => {
      filesPromise = undefined;
    });
  }
  return filesPromise;
}

/** Doom mostly uses browser key codes, apart from these. */
function getDoomKeyCode(event: KeyboardEvent): number {
  const { keyCode } = event;
  switch (keyCode) {
    case 8:
      return 127; // KEY_BACKSPACE
    case 17:
      return 0x80 + 0x1d; // KEY_RCTRL
    case 18:
      return 0x80 + 0x38; // KEY_RALT
    case 37:
      return 0xac; // KEY_LEFTARROW
    case 38:
      return 0xad; // KEY_UPARROW
    case 39:
      return 0xae; // KEY_RIGHTARROW
    case 40:
      return 0xaf; // KEY_DOWNARROW
    default:
      if (keyCode >= 65 && keyCode <= 90) {
        // ASCII upper case to lower case
        return keyCode + 32;
      }
      if (keyCode >= 112 && keyCode <= 123) {
        return keyCode + 75; // KEY_F1 onwards
      }
      return keyCode;
  }
}

/**
 * The shareware episode of Doom, compiled to wasm from
 * https://github.com/mofojed/wasm-fizzbuzz, with sound.
 *
 * Alongside the RGBA frame the port draws, each frame reads back the palette
 * indexed screen Doom actually renders, so a plot can split it by palette
 * color without matching colors.
 */
export class Doom {
  private readonly onFrame: (frame: DoomFrame) => void;

  private memory: WebAssembly.Memory | undefined;

  private exports: DoomExports | undefined;

  private audio: DoomAudio | undefined;

  private isMuted = false;

  private screenPointer = 0;

  private animationFrame: number | undefined;

  private isStopped = false;

  constructor(onFrame: (frame: DoomFrame) => void) {
    this.onFrame = onFrame;
    this.handleDrawScreen = this.handleDrawScreen.bind(this);
    this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
    this.keyDown = this.keyDown.bind(this);
    this.keyUp = this.keyUp.bind(this);
  }

  /** Loads the game and starts running it once per animation frame. */
  async start(): Promise<void> {
    const { module, wad } = await loadDoom();
    if (this.isStopped) {
      return;
    }
    const memory = new WebAssembly.Memory({ initial: INITIAL_MEMORY_PAGES });
    const instance = await WebAssembly.instantiate(module, {
      env: { memory },
      js: {
        js_console_log: (offset: number, length: number) =>
          // eslint-disable-next-line no-console
          console.log(this.readString(offset, length)),
        js_stdout: (offset: number, length: number) =>
          // eslint-disable-next-line no-console
          console.log(this.readString(offset, length)),
        js_stderr: (offset: number, length: number) =>
          // eslint-disable-next-line no-console
          console.error(this.readString(offset, length)),
        js_milliseconds_since_start: () => performance.now(),
        js_draw_screen: this.handleDrawScreen,
      },
    });
    if (this.isStopped) {
      return;
    }
    this.memory = memory;
    const exports = instance.exports as unknown as DoomExports;
    this.exports = exports;
    this.screenPointer = exports.malloc(DOOM_WIDTH * DOOM_HEIGHT);
    const wadPointer = exports.doom_iwad_buffer(wad.length);
    // After allocating, as memory growth detaches the old buffer
    new Uint8Array(memory.buffer, wadPointer, wad.length).set(wad);
    exports.main();
    if (typeof AudioContext !== "undefined") {
      this.audio = new DoomAudio(new AudioContext(), memory, exports);
      this.audio.setMuted(this.isMuted);
    }
    this.animationFrame = requestAnimationFrame(this.handleAnimationFrame);
  }

  stop(): void {
    this.isStopped = true;
    if (this.animationFrame != null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    this.audio?.close();
    this.audio = undefined;
  }

  /** Call from a click, so the browser lets the sound start. */
  resumeAudio(): void {
    this.audio?.resume();
  }

  setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
    this.audio?.setMuted(isMuted);
  }

  keyDown(event: KeyboardEvent): void {
    this.sendKey(0, event);
  }

  keyUp(event: KeyboardEvent): void {
    this.sendKey(1, event);
  }

  private sendKey(type: number, event: KeyboardEvent): void {
    if (this.exports == null) {
      return;
    }
    this.audio?.resume();
    this.exports.add_browser_event(type, getDoomKeyCode(event));
    event.preventDefault();
    event.stopPropagation();
  }

  private handleAnimationFrame(): void {
    this.exports?.doom_loop_step();
    this.audio?.pump();
    if (!this.isStopped) {
      this.animationFrame = requestAnimationFrame(this.handleAnimationFrame);
    }
  }

  private readString(offset: number, length: number): string {
    if (this.memory == null) {
      return "";
    }
    return new TextDecoder("utf8").decode(
      new Uint8Array(this.memory.buffer, offset, length),
    );
  }

  private handleDrawScreen(pointer: number): void {
    const { memory, exports } = this;
    if (memory == null || exports == null) {
      return;
    }
    exports.I_ReadScreen(this.screenPointer);
    // Views are made per frame because memory growth detaches the old buffer
    this.onFrame({
      indexes: new Uint8Array(
        memory.buffer,
        this.screenPointer,
        DOOM_WIDTH * DOOM_HEIGHT,
      ),
      rgba: new Uint8Array(
        memory.buffer,
        pointer,
        OUTPUT_WIDTH * OUTPUT_HEIGHT * 4,
      ),
      rgbaWidth: OUTPUT_WIDTH,
    });
  }
}

export default Doom;
