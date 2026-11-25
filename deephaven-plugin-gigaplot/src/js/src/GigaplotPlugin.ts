import { type ElementPlugin, PluginType } from '@deephaven/plugin';
import GigaplotView from './GigaplotView';

export const GigaplotPlugin: ElementPlugin = {
  name: 'deephaven-plugin-gigaplot',
  type: PluginType.ELEMENT_PLUGIN,
  // Keys must match the element names used in gigaplot.py
  mapping: {
    'deephaven_plugin_gigaplot.gigaplot': GigaplotView,
  },
};

export default GigaplotPlugin;
