import * as React from "react";
import { afterAll, expect, it, vi } from "vitest";
import { Workflow, LayoutDashboard } from "lucide-react";
import { MobileNavigation } from "./OperationsShell";

const portal = vi.hoisted(() => vi.fn((element: React.ReactElement, _container: unknown) => element));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(), createPortal: portal }));
vi.stubGlobal("React", React);
vi.stubGlobal("document", { body: {} });
afterAll(() => vi.unstubAllGlobals());

it("anchors navigation to the body and marks nested workflow pages as active", () => {
  const items = [{ label: "Início", path: "/", icon: LayoutDashboard }, { label: "Workflows", path: "/workflows", icon: Workflow }];
  const tree = MobileNavigation({ items, currentPath: "/workflows/123" }) as unknown as React.ReactElement<any>;
  expect(portal.mock.calls[0][1]).toBe(document.body);
  expect(tree.props.style.position).toBe("fixed");
  expect(tree.props.children.props.modal).toBe(false);
  const links: any[] = [];
  const walk = (node: React.ReactNode) => React.Children.forEach(node, child => {
    if (!React.isValidElement<any>(child)) return;
    if (child.props.href) links.push(child.props);
    walk(child.props.children);
  });
  walk(tree);
  expect(links.map(link => link.href)).toEqual(["/", "/workflows"]);
  expect(links[0]["aria-current"]).toBeUndefined();
  expect(links[1]["aria-current"]).toBe("page");
});

it("keeps four primary destinations and puts remaining allowed routes in More", () => {
  const paths = ["/", "/workflows", "/executions", "/errors", "/analytics", "/monitoring"];
  const items = paths.map(path => ({ label: path, path, icon: Workflow }));
  const tree = MobileNavigation({ items, currentPath: "/" }) as unknown as React.ReactElement<any>;
  const nav = tree.props.children.props.children[1].props.children;
  const primary = nav.props.children[0];
  expect(nav.props.children[1].props.modal).toBe(false);
  const more = nav.props.children[1].props.children;
  expect(primary.map((item: any) => item.props.children.props.href)).toEqual(paths.slice(0, 4));
  expect(more[0].props.children.props["aria-label"]).toBe("Mais áreas");
  expect(more[1].props.children.map((item: any) => item.props.children.props.children.props.href)).toEqual(paths.slice(4));
});
