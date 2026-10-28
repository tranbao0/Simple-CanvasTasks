import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { PANEL_PORT_NAME } from './messages';
import { HEARTBEAT_INTERVAL_MS, connectPanelPort, type PanelPortHandle } from './panelPort';
import { closeRemote, fakePort, type FakePort } from './testing/fakes';

const HELLO = { type: 'weekrow:panel-hello', windowId: 7 };
const HEARTBEAT = { type: 'weekrow:panel-heartbeat' };

let ports: FakePort[];
let connect: ReturnType<typeof vi.fn>;
let handle: PanelPortHandle | null;

function lastPort(): FakePort {
  const port = ports.at(-1);
  if (port === undefined) throw new Error('no port');
  return port;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeBrowser.reset();
  ports = [];
  connect = vi.fn((info: { name: string }) => {
    const port = fakePort(info.name);
    ports.push(port);
    return port;
  });
  Object.assign(fakeBrowser.runtime, { connect });
  handle = null;
});

afterEach(() => {
  handle?.stop();
  vi.useRealTimers();
});

describe('connectPanelPort', () => {
  it('connects at once and says hello with the window id', () => {
    handle = connectPanelPort(7);

    expect(connect).toHaveBeenCalledWith({ name: PANEL_PORT_NAME });
    expect(lastPort().postMessage.mock.calls).toEqual([[HELLO]]);
  });

  it('sends a heartbeat every 20 seconds', () => {
    handle = connectPanelPort(7);
    const port = lastPort();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(port.postMessage).toHaveBeenLastCalledWith(HEARTBEAT);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(port.postMessage.mock.calls).toEqual([[HELLO], [HEARTBEAT], [HEARTBEAT], [HEARTBEAT]]);
  });

  it('reconnects at once when the background drops the port', () => {
    handle = connectPanelPort(7);
    closeRemote(lastPort());

    expect(ports).toHaveLength(2);
    expect(lastPort().postMessage.mock.calls).toEqual([[HELLO]]);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(lastPort().postMessage).toHaveBeenLastCalledWith(HEARTBEAT);
    expect(ports[0]?.postMessage).toHaveBeenCalledTimes(1);
  });

  it('reconnects at once again in the next heartbeat period', () => {
    handle = connectPanelPort(7);
    closeRemote(lastPort());
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    closeRemote(lastPort());

    expect(ports).toHaveLength(3);
  });

  it('waits for the next heartbeat when the port drops again in the same period', () => {
    handle = connectPanelPort(7);
    closeRemote(lastPort());
    closeRemote(lastPort());
    expect(ports).toHaveLength(2);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(3);
    expect(lastPort().postMessage.mock.calls).toEqual([[HELLO]]);
  });

  it('retries on the next heartbeat when connecting throws', () => {
    connect.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated.');
    });
    handle = connectPanelPort(7);
    expect(ports).toHaveLength(0);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(1);
    expect(lastPort().postMessage.mock.calls).toEqual([[HELLO]]);
  });

  it('reconnects when a heartbeat cannot be posted', () => {
    handle = connectPanelPort(7);
    lastPort().postMessage.mockImplementationOnce(() => {
      throw new Error('Attempting to use a disconnected port object');
    });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(2);
    expect(lastPort().postMessage.mock.calls).toEqual([[HELLO]]);
  });

  it('ignores a late disconnect of a port it already replaced', () => {
    handle = connectPanelPort(7);
    const first = lastPort();
    closeRemote(first);
    closeRemote(first);

    expect(ports).toHaveLength(2);
  });

  it('stops the heartbeat, closes the port and does not reconnect after stop', () => {
    handle = connectPanelPort(7);
    const port = lastPort();
    handle.stop();

    expect(port.disconnect).toHaveBeenCalledTimes(1);
    closeRemote(port);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(ports).toHaveLength(1);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });
});
