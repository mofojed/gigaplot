import { canvas3DRendererFactory } from './canvas/Canvas3DRenderer';
import type { Plot3DRendererFactory } from './Plot3DRenderer';
import { RendererRegistry } from './RendererRegistry';
import { webGpu3DRendererFactory } from './webgpu/WebGpu3DRenderer';

/**
 * The registry 3D plots use when not given one. Its renderers share their
 * names with the 2D ones, `webgpu` then `canvas`, so one preference list
 * works for both kinds of plot.
 */
export const defaultRenderer3DRegistry =
  new RendererRegistry<Plot3DRendererFactory>();
defaultRenderer3DRegistry.register(webGpu3DRendererFactory);
defaultRenderer3DRegistry.register(canvas3DRendererFactory);

export default defaultRenderer3DRegistry;
