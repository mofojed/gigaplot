import doomUrl from "./doom.wasm?url";
import { FULL_SCREEN_BLOCKS, setDoomDefault } from "./doomDefaults";
import { patchDemoVersions } from "./doomDemos";
import { DOOM_HEIGHT, DOOM_WIDTH, type DoomFrame } from "./doomFrame";

/** Size of the RGBA frame the port hands to `js_draw_screen`. */
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 400;

/** Pages of 64 KiB the port expects its memory to start with. */
const INITIAL_MEMORY_PAGES = 108;

interface DoomExports {
  main: () => void;
  exit: () => void;
  doom_loop_step: () => void;
  add_browser_event: (event: number, keyCode: number) => void;
  malloc: (size: number) => number;
  /** Copies the 8 bit, palette indexed screen into `pointer`. */
  I_ReadScreen: (pointer: number) => void;
}

let modulePromise: Promise<WebAssembly.Module> | undefined;

/**
 * Compiles the port once per page. React's strict mode starts and stops the
 * game twice, and recompiling 7 MB of wasm each time is noticeable.
 */
function compileDoom(): Promise<WebAssembly.Module> {
  if (modulePromise == null) {
    // Not compileStreaming, which rejects hosts that serve the wrong MIME type
    modulePromise = fetch(doomUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load Doom: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((bytes) => WebAssembly.compile(bytes));
    modulePromise.catch(() => {
      modulePromise = undefined;
    });
  }
  return modulePromise;
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
 * The shareware episode of Doom, compiled to wasm, as used by
 * https://github.com/mofojed/deephaven-doom.
 *
 * Alongside the RGBA frame the port draws, each frame reads back the palette
 * indexed screen Doom actually renders, so a plot can split it by palette
 * color without matching colors.
 */
export class Doom {
  private readonly onFrame: (frame: DoomFrame) => void;

  private memory: WebAssembly.Memory | undefined;

  private exports: DoomExports | undefined;

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
    const module = await compileDoom();
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
    const bytes = new Uint8Array(memory.buffer);
    patchDemoVersions(bytes);
    setDoomDefault(bytes, "screenblocks", FULL_SCREEN_BLOCKS);
    exports.main();
    this.animationFrame = requestAnimationFrame(this.handleAnimationFrame);
  }

  stop(): void {
    this.isStopped = true;
    if (this.animationFrame != null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
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
    this.exports.add_browser_event(type, getDoomKeyCode(event));
    event.preventDefault();
    event.stopPropagation();
  }

  private handleAnimationFrame(): void {
    this.exports?.doom_loop_step();
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
