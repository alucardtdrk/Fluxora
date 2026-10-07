import * as React from "react";
import { afterAll, expect, it, vi } from "vitest";
import WorkflowDiagram, { fitDiagram } from "./WorkflowDiagram";

const state = vi.hoisted(() => ({ values: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof React>(),
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useRef: () => ({ current: null }),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

it("drags with the captured pointer, ignores other pointers and cancels safely", () => {
  const render = () => {
    state.index = 0;
    const tree = WorkflowDiagram({ nodes: [], connections: {}, selectedNodeName: null, onSelectNode: vi.fn() });
    return tree.props.children[1].props;
  };
  const capture = vi.fn();
  const event = { isPrimary: true, button: 0, pointerId: 7, clientX: 20, clientY: 30, target: { closest: () => null }, currentTarget: { setPointerCapture: capture }, preventDefault: vi.fn() };
  let props = render();
  props.onPointerDown({ ...event, target: { closest: () => ({}) } });
  expect(capture).not.toHaveBeenCalled();
  props.onPointerDown(event);
  expect(capture).toHaveBeenCalledWith(7);
  props = render();
  props.onPointerMove({ ...event, pointerId: 8, clientX: 100 });
  expect(state.values[2]).toEqual({ x: 0, y: 0 });
  props.onPointerMove({ ...event, clientX: 60, clientY: 80 });
  expect(state.values[2]).toEqual({ x: 40, y: 50 });
  props.onPointerCancel();
  props = render();
  props.onPointerMove({ ...event, clientX: 200 });
  expect(state.values[2]).toEqual({ x: 40, y: 50 });
  expect(state.values[3]).toBeNull();
});

it("fits wide and tall diagrams inside desktop and mobile viewports", () => {
  for (const viewport of [{ width: 960, height: 820 }, { width: 320, height: 480 }]) {
    for (const bounds of [{ width: 180, height: 160 }, { width: 16000, height: 2400 }, { width: 600, height: 18000 }]) {
      const { zoom, pan } = fitDiagram(bounds, viewport);
      const left = pan.x + 140 * zoom;
      const top = pan.y + 100 * zoom;
      expect(zoom).toBeGreaterThan(0);
      expect(zoom).toBeLessThanOrEqual(1);
      expect(left).toBeGreaterThanOrEqual(23.99);
      expect(top).toBeGreaterThanOrEqual(23.99);
      expect(left + bounds.width * zoom).toBeLessThanOrEqual(viewport.width - 23.99);
      expect(top + bounds.height * zoom).toBeLessThanOrEqual(viewport.height - 23.99);
    }
  }
});
