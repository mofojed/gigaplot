import { LinearScale } from './LinearScale';
import { formatTick, formatValue, generateTicks, linearTicks } from './ticks';
import { panBounds, zoomBounds } from './viewportUtils';

describe('LinearScale', () => {
  it('maps the domain onto the range', () => {
    const scale = new LinearScale(0, 10, 0, 100);
    expect(scale.scale(0)).toBe(0);
    expect(scale.scale(5)).toBe(50);
    expect(scale.scale(10)).toBe(100);
  });

  it('inverts back to the domain', () => {
    const scale = new LinearScale(-1, 1, 0, 200);
    expect(scale.invert(0)).toBe(-1);
    expect(scale.invert(100)).toBe(0);
    expect(scale.invert(200)).toBe(1);
  });

  it('handles an inverted range, as used for screen y', () => {
    const scale = new LinearScale(0, 1, 100, 0);
    expect(scale.scale(0)).toBe(100);
    expect(scale.scale(1)).toBe(0);
  });

  it('does not divide by zero for a degenerate domain', () => {
    const scale = new LinearScale(5, 5, 0, 100);
    expect(scale.scale(5)).toBe(0);
  });
});

describe('generateTicks', () => {
  it('produces round numbers covering the range', () => {
    expect(generateTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('handles negative ranges', () => {
    expect(generateTicks(-1, 1, 4)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it('produces fewer ticks for a smaller target, so small plots stay readable', () => {
    expect(generateTicks(0, 50000, 2).length).toBeLessThan(
      generateTicks(0, 50000, 8).length
    );
  });

  it('returns nothing for an invalid range', () => {
    expect(generateTicks(1, 1)).toEqual([]);
    expect(generateTicks(NaN, 10)).toEqual([]);
  });
});

describe('formatTick', () => {
  it('formats zero plainly', () => {
    expect(formatTick(0, 1)).toBe('0');
  });

  it('uses precision based on the step', () => {
    expect(formatTick(0.25, 0.25)).toBe('0.25');
    expect(formatTick(12, 1)).toBe('12.0');
  });

  it('falls back to exponential for extreme magnitudes', () => {
    expect(formatTick(1.5e9, 1e8)).toBe('1.50e+9');
  });
});

describe('linearTicks', () => {
  it('labels each generated tick for its step', () => {
    expect(linearTicks(0, 1, 2)).toEqual([
      { value: 0, label: '0' },
      { value: 0.5, label: '0.50' },
      { value: 1, label: '1.00' },
    ]);
  });
});

describe('zoomBounds', () => {
  it('zooms out about the center', () => {
    expect(
      zoomBounds({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, 2, 0.5, 0.5)
    ).toEqual({ xMin: -5, xMax: 15, yMin: -5, yMax: 15 });
  });

  it('keeps the anchor fixed when zooming in on an edge', () => {
    const result = zoomBounds(
      { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
      0.5,
      0,
      0
    );
    expect(result.xMin).toBe(0);
    expect(result.xMax).toBe(5);
  });
});

describe('panBounds', () => {
  it('moves the viewport opposite the drag on x and with it on y', () => {
    const result = panBounds(
      { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
      10,
      10,
      { width: 100, height: 100 }
    );
    expect(result).toEqual({ xMin: -10, xMax: 90, yMin: 10, yMax: 110 });
  });

  it('is a no-op for a zero sized plot area', () => {
    const bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    expect(panBounds(bounds, 10, 10, { width: 0, height: 0 })).toEqual(bounds);
  });
});

describe('formatValue', () => {
  it('shows as many decimals as a pixel resolves', () => {
    expect(formatValue(1.23456, 0.5)).toBe('1.2');
    expect(formatValue(1.23456, 0.01)).toBe('1.23');
    expect(formatValue(1234.5, 3)).toBe('1235');
  });

  it('keeps every digit of large values', () => {
    expect(formatValue(1_700_000_000_123, 1000)).toBe('1700000000123');
  });

  it('does not show negative zero', () => {
    expect(formatValue(-0.0001, 0.1)).toBe('0.0');
  });

  it('uses exponents only for extreme magnitudes', () => {
    expect(formatValue(1.5e-9, 1e-10)).toBe('1.5000e-9');
  });
});
