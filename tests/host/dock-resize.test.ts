import { describe, expect, it, vi } from 'vitest';
import { bindDockResize } from '../../src/host/dock.ts';

class FakeWindow extends EventTarget {
  private nextFrame = 1;
  private frames = new Map<number, FrameRequestCallback>();
  requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  };
  cancelAnimationFrame = (id: number): void => { this.frames.delete(id); };
  flushFrames(): void {
    const frames = [...this.frames.values()];
    this.frames.clear();
    frames.forEach(callback => callback(0));
  }
}

class FakeDocument extends EventTarget {
  constructor(readonly defaultView: FakeWindow) { super(); }
}

class FakeResizer extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly ownerDocument: FakeDocument;
  readonly parentElement = { nodeType: 1 };
  readonly tagName = 'DIV';
  isContentEditable = false;
  capturedPointer: number | null = null;
  constructor(doc: FakeDocument) { super(); this.ownerDocument = doc; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  closest(): null { return null; }
  setPointerCapture(pointerId: number): void { this.capturedPointer = pointerId; }
  releasePointerCapture(pointerId: number): void {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }
}

function pointerEvent(type: string, pointerId: number, clientX: number, options: { button?: number; isPrimary?: boolean } = {}): PointerEvent {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId, clientX, button: options.button ?? 0, isPrimary: options.isPrimary ?? true });
  return event as PointerEvent;
}

function setup() {
  const view = new FakeWindow();
  const doc = new FakeDocument(view);
  const resizer = new FakeResizer(doc);
  let width = 360;
  const setWidth = vi.fn((next: number) => { width = next; });
  const unbind = bindDockResize(resizer as unknown as HTMLElement, {
    currentWidth: () => width,
    setWidth,
    measureAvailableWidth: () => 1200,
  });
  return { view, doc, resizer, setWidth, unbind };
}

describe('dock resizing', () => {
  it('tracks the primary pointer and flushes the final dragged width once', () => {
    const { view, doc, resizer, setWidth, unbind } = setup();

    resizer.dispatchEvent(pointerEvent('pointerdown', 4, 100));
    doc.dispatchEvent(pointerEvent('pointermove', 99, 10)); // Another pointer cannot move this drag.
    doc.dispatchEvent(pointerEvent('pointermove', 4, 60));
    doc.dispatchEvent(pointerEvent('pointermove', 4, 40));
    view.flushFrames();

    expect(setWidth).toHaveBeenCalledTimes(1);
    expect(setWidth).toHaveBeenLastCalledWith(420);
    expect(resizer.attributes.get('aria-valuenow')).toBe('420');

    doc.dispatchEvent(pointerEvent('pointerup', 4, 40));
    expect(setWidth).toHaveBeenCalledTimes(1);
    expect(resizer.capturedPointer).toBeNull();
    unbind();
  });

  it('settles and releases the active pointer when the browser cancels a drag', () => {
    const { view, doc, resizer, setWidth, unbind } = setup();

    resizer.dispatchEvent(pointerEvent('pointerdown', 7, 200));
    doc.dispatchEvent(pointerEvent('pointermove', 7, 170));
    doc.dispatchEvent(pointerEvent('pointercancel', 7, 170));
    doc.dispatchEvent(pointerEvent('pointermove', 7, 100));
    view.flushFrames();

    expect(setWidth).toHaveBeenCalledTimes(1);
    expect(setWidth).toHaveBeenCalledWith(390);
    expect(resizer.capturedPointer).toBeNull();
    unbind();
  });

  it('ignores non-primary and non-left pointer presses', () => {
    const { resizer, doc, setWidth, unbind } = setup();
    resizer.dispatchEvent(pointerEvent('pointerdown', 1, 100, { button: 2 }));
    resizer.dispatchEvent(pointerEvent('pointerdown', 2, 100, { isPrimary: false }));
    doc.dispatchEvent(pointerEvent('pointermove', 1, 80));
    doc.dispatchEvent(pointerEvent('pointerup', 1, 80));

    expect(setWidth).not.toHaveBeenCalled();
    unbind();
  });
});
