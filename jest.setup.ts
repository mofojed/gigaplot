import "jest-canvas-mock";

// jsdom does not implement ResizeObserver
class MockResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

// jsdom does not implement DOMRect
Object.defineProperty(window, "DOMRect", {
  writable: true,
  value: function MockDOMRect(x = 0, y = 0, width = 0, height = 0) {
    return {
      x,
      y,
      width,
      height,
      top: y,
      bottom: y + height,
      left: x,
      right: x + width,
      toJSON: () => ({}),
    };
  },
});
