import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ErrorBoundary from './ErrorBoundary';

// Rendered with react-dom directly rather than a testing library — the
// boundary's contract is small enough that the extra dependency isn't worth it.

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message);
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(ui: React.ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    // React logs caught errors to console.error; silence for readable output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = render(
      <ErrorBoundary>
        <p>initiative tracker</p>
      </ErrorBoundary>,
    );
    expect(el.textContent).toContain('initiative tracker');
    spy.mockRestore();
  });

  it('catches a render throw and shows the fallback instead of a blank screen', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(el.textContent).toContain('Something broke');
    expect(el.textContent).not.toContain('initiative tracker');
    spy.mockRestore();
  });

  it('surfaces the error message so a bug report can name the failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = render(
      <ErrorBoundary>
        <Boom message="cannot read hp of undefined" />
      </ErrorBoundary>,
    );
    expect(el.textContent).toContain('cannot read hp of undefined');
    spy.mockRestore();
  });

  it('offers a recovery action rather than dead-ending', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Try again');
    expect(labels).toContain('Reload page');
    spy.mockRestore();
  });
});
