import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutGroup, PaneNode } from "./layout";

vi.mock("./tauri", () => ({ isTauri: false, publishDesktopLayout: vi.fn() }));
vi.mock("./webMode", () => ({
  isGatewayWeb: true,
  gatewayOrigin: () => "http://gw",
  gatewayToken: () => "s".repeat(64),
}));

const { useLayoutStore, leaves } = await import("./layout");
const { adoptAccountLayout, fetchDesktopScreens, layoutChanged, resetLayoutSync } = await import("./layoutSync");

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** The desktop's Screens as it would publish them: a conversation beside a
 *  terminal running an agent, and an untouched draft. */
const desktop: LayoutGroup[] = [
  {
    id: "g1",
    name: "Analysis",
    projectId: "proj-a",
    focusedLeafId: "p2",
    zoomedLeafId: null,
    tree: {
      kind: "split",
      id: "p1",
      dir: "row",
      sizes: [0.6, 0.4],
      children: [
        { kind: "leaf", id: "p2", sessionId: "ses_1" },
        {
          kind: "leaf",
          id: "p3",
          sessionId: null,
          content: {
            kind: "terminal",
            cwd: "/work",
            name: "build",
            command: "make",
            agent: { kind: "claude", sessionId: "abc", running: true },
          },
        },
      ],
    },
  },
  { id: "g2", name: "", focusedLeafId: "p4", zoomedLeafId: null, tree: { kind: "leaf", id: "p4", sessionId: null } },
];

beforeEach(() => {
  resetLayoutSync();
  useLayoutStore.getState().reset(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("opening the desktop's Screens in a browser", () => {
  it("copies Screens with something in them under fresh ids, terminals as new shells", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ groups: desktop, activeGroupId: "g1" })));
    const screens = await fetchDesktopScreens();
    const before = useLayoutStore.getState().groups.length;

    expect(useLayoutStore.getState().importScreens(screens)).toBe(1);
    const s = useLayoutStore.getState();
    expect(s.groups).toHaveLength(before + 1);
    const copy = s.groups.find((g) => g.id === s.activeGroupId)!;
    expect(copy.name).toBe("Analysis");
    expect(copy.projectId).toBe("proj-a");
    const ids = [copy.tree!.id, ...leaves(copy.tree!).map((l) => l.id)];
    expect(ids.some((id) => ["p1", "p2", "p3"].includes(id))).toBe(false);
    const [chat, term] = leaves(copy.tree as PaneNode);
    expect(chat.sessionId).toBe("ses_1");
    // Same folder and name; never the original's command or agent resume.
    expect(term.content).toEqual({ kind: "terminal", cwd: "/work", name: "build" });
  });
});

describe("an account's Screens", () => {
  it("are adopted from the desktop when it has them", async () => {
    const fetchMock = vi.fn(async () => json({ groups: desktop.slice(0, 1), activeGroupId: "g1" }));
    vi.stubGlobal("fetch", fetchMock);
    await adoptAccountLayout();
    const s = useLayoutStore.getState();
    expect(s.groups.map((g) => g.name)).toEqual(["Analysis"]);
    expect(fetchMock).toHaveBeenCalledWith("http://gw/v1/me/layout", expect.anything());
  });

  it("start as this browser's on first sign-in, and are written back as they change", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({ ok: true }) : json(null),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    // Before the account's layout is read nothing is written over it.
    layoutChanged('{"groups":[]}');
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();

    await adoptAccountLayout();
    const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts()).toHaveLength(1); // this browser's layout became the account's

    layoutChanged('{"a":1}');
    layoutChanged('{"a":2}');
    await vi.runAllTimersAsync();
    expect(puts()).toHaveLength(2);
    expect(puts()[1][1]?.body).toBe('{"a":2}'); // one write for a burst of changes
  });
});
