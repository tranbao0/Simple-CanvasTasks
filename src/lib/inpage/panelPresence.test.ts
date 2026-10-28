import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { watchPanelOpen } from './panelPresence';

let sendMessage: ReturnType<typeof vi.fn>;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function push(open: boolean): void {
  void fakeBrowser.runtime.onMessage.trigger(
    { type: 'weekrow:panel-open', open },
    {},
    () => undefined,
  );
}

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => ({ open: true }));
  Object.assign(fakeBrowser.runtime, { sendMessage });
});

describe('watchPanelOpen', () => {
  it('asks the background for the state of its window at start', async () => {
    const onChange = vi.fn();
    const stop = watchPanelOpen(onChange);
    await settle();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'weekrow:panel-state' });
    expect(onChange.mock.calls).toEqual([[true]]);
    stop();
  });

  it('follows the open and close messages from the background', async () => {
    sendMessage.mockResolvedValue({ open: false });
    const onChange = vi.fn();
    const stop = watchPanelOpen(onChange);
    await settle();

    push(true);
    push(false);
    void fakeBrowser.runtime.onMessage.trigger({ type: 'other' }, {}, () => undefined);

    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);
    stop();
  });

  it('ignores a reply that arrives after a newer pushed change', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const onChange = vi.fn();
    const stop = watchPanelOpen(onChange);

    push(false);
    answer({ open: true });
    await settle();

    expect(onChange.mock.calls).toEqual([[false]]);
    stop();
  });

  it('stays quiet when the background does not answer', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    const onChange = vi.fn();
    const stop = watchPanelOpen(onChange);
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('stops listening when stopped', async () => {
    const onChange = vi.fn();
    const stop = watchPanelOpen(onChange);
    stop();
    push(true);
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(false);
  });
});
