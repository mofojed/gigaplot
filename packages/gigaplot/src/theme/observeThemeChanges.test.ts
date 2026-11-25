import { observeThemeChanges } from './observeThemeChanges';

/** MutationObserver callbacks run as a microtask after the change. */
function flush(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

let listener: jest.Mock;
let unsubscribe: () => void;

beforeEach(() => {
  listener = jest.fn();
  unsubscribe = observeThemeChanges(listener);
});

afterEach(() => {
  unsubscribe();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.className = '';
  document.body.className = '';
});

it('notifies when a style element is added, edited, or removed', async () => {
  const style = document.createElement('style');
  style.textContent = ':root { --dh-color-chart-bg: red; }';
  document.body.appendChild(style);
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);

  style.textContent = ':root { --dh-color-chart-bg: blue; }';
  await flush();
  expect(listener).toHaveBeenCalledTimes(2);

  (style.firstChild as Text).data = ':root { --dh-color-chart-bg: green; }';
  await flush();
  expect(listener).toHaveBeenCalledTimes(3);

  style.remove();
  await flush();
  expect(listener).toHaveBeenCalledTimes(4);
});

it('notifies when a stylesheet link is added', async () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'theme.css';
  document.head.appendChild(link);
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('notifies when a theme attribute changes on html or body', async () => {
  document.documentElement.classList.add('theme-light');
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);

  document.body.setAttribute('data-theme', 'light');
  await flush();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('ignores unrelated changes', async () => {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.textContent = 'hello';
  div.className = 'theme-light';
  document.body.setAttribute('aria-busy', 'true');
  await flush();
  expect(listener).not.toHaveBeenCalled();
});

it('notifies once for a batch of changes', async () => {
  const oldStyle = document.createElement('style');
  document.body.appendChild(oldStyle);
  await flush();
  listener.mockClear();

  oldStyle.remove();
  document.body.appendChild(document.createElement('style'));
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('stops notifying after unsubscribing', async () => {
  const other = jest.fn();
  const unsubscribeOther = observeThemeChanges(other);
  unsubscribe();

  document.body.appendChild(document.createElement('style'));
  await flush();
  expect(listener).not.toHaveBeenCalled();
  expect(other).toHaveBeenCalledTimes(1);

  unsubscribeOther();
  document.body.appendChild(document.createElement('style'));
  await flush();
  expect(other).toHaveBeenCalledTimes(1);
});
