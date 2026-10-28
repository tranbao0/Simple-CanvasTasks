/** Renders a surface runtime into an extension page. */
import { render, type VNode } from 'preact';
import type { SurfaceState } from '../model/types';
import type { SurfaceRuntime } from './runtime';

/** Renders the runtime state on every change and starts the runtime. */
export function mountRuntime(
  root: HTMLElement,
  runtime: SurfaceRuntime,
  view: (state: SurfaceState) => VNode,
): () => void {
  const draw = (): void => render(view(runtime.state()), root);
  runtime.subscribe(draw);
  draw();
  runtime.start();
  return draw;
}
