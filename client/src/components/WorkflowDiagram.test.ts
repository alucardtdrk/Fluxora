import * as React from "react";
import { afterAll, expect, it, vi } from "vitest";
import WorkflowDiagram from "./WorkflowDiagram";

const state = vi.hoisted(() => ({ values: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof React>(),
  useEffect: () => {},
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
