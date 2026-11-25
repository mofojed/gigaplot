/**
 * Attributes on `<html>` and `<body>` that commonly select a theme, such as a
 * `class="theme-light"` toggle.
 */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-color-scheme'];

type ThemeChangeListener = () => void;

const listeners = new Set<ThemeChangeListener>();

let structureObserver: MutationObserver | null = null;

let attributeObserver: MutationObserver | null = null;

function isStyleNode(node: Node | null): boolean {
  if (node == null || node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const name = node.nodeName.toUpperCase();
  if (name === 'STYLE') {
    return true;
  }
  return (
    name === 'LINK' &&
    /\bstylesheet\b/i.test((node as Element).getAttribute('rel') ?? '')
  );
}

function containsStyleNode(nodes: NodeList): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    if (isStyleNode(nodes[i])) {
      return true;
    }
  }
  return false;
}

function isStyleMutation(record: MutationRecord): boolean {
  if (record.type === 'characterData') {
    return isStyleNode(record.target.parentNode);
  }
  return (
    isStyleNode(record.target) ||
    containsStyleNode(record.addedNodes) ||
    containsStyleNode(record.removedNodes)
  );
}

function notify(): void {
  // Copied so a listener can unsubscribe while being notified
  Array.from(listeners).forEach(listener => listener());
}

function start(): void {
  const root = document.documentElement;

  // Theme providers such as the one in @deephaven/components swap <style>
  // elements, which could be anywhere in the document
  structureObserver = new MutationObserver(records => {
    if (records.some(isStyleMutation)) {
      notify();
    }
  });
  structureObserver.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Watched without `subtree` so class changes elsewhere in the page are free
  attributeObserver = new MutationObserver(notify);
  const attributeOptions = { attributes: true, attributeFilter: THEME_ATTRIBUTES };
  attributeObserver.observe(root, attributeOptions);
  if (document.body != null) {
    attributeObserver.observe(document.body, attributeOptions);
  }
}

function stop(): void {
  structureObserver?.disconnect();
  attributeObserver?.disconnect();
  structureObserver = null;
  attributeObserver = null;
}

/**
 * Calls `listener` whenever the page's styles may have changed theme: a
 * stylesheet is added, removed, or edited, or a theme attribute changes on
 * `<html>` or `<body>`.
 *
 * Every subscriber shares one set of observers. Mutations are batched by the
 * browser, so a theme switch notifies once.
 *
 * @returns A function that unsubscribes `listener`
 */
export function observeThemeChanges(listener: ThemeChangeListener): () => void {
  if (
    typeof document === 'undefined' ||
    typeof MutationObserver === 'undefined'
  ) {
    return () => undefined;
  }
  listeners.add(listener);
  if (listeners.size === 1) {
    start();
  }
  return () => {
    if (listeners.delete(listener) && listeners.size === 0) {
      stop();
    }
  };
}

export default observeThemeChanges;
