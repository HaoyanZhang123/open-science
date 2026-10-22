// Where a layout goes besides this browser's own storage.
//
// - The desktop window and every web client signed in with the TOKEN share one
//   set of Screens, live: the window publishes its layout, a token client
//   mirrors it (polling for a newer revision) and writes its own changes back,
//   and the gateway tells the window about those at once. Last write wins.
// - A web client signed in with an ACCOUNT keeps its own Screens on the
//   desktop: browser storage is per address, and an account is the same person
//   at 127.0.0.1, at the LAN IP, and at whatever IP the router hands out next.
//   It can still copy the window's Screens ("Open the desktop's Screens").
import type { LayoutGroup } from "./layout";
import { isTauri, publishDesktopLayout } from "./tauri";
import { gatewayOrigin, gatewayToken, isGatewayWeb, signedInAccount } from "./webMode";

type Mode = "desktop" | "mirror" | "account" | null;

/** How often a token client asks whether the shared Screens changed. */
const POLL_MS = 1000;

let mode: Mode = isTauri ? "desktop" : null;
let timer: ReturnType<typeof setTimeout> | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
/** The shared layout's revision this client last saw or wrote. */
let rev = 0;
/** The layout last taken from elsewhere, exactly as `persist` will serialize
 *  it: adopting it fires a local change, and that one must not be sent back. */
let lastApplied: string | null = null;

const auth = (): Record<string, string> => {
  const token = gatewayToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Every local layout change (from `persist`). */
export function layoutChanged(json: string): void {
  if (!mode || json === lastApplied) return;
  clearTimeout(timer);
  // The window and a mirror share one layout: keep the other side close behind.
  timer = setTimeout(() => void push(json), mode === "account" ? 800 : 300);
}

async function push(json: string): Promise<void> {
  try {
    if (mode === "desktop") {
      await publishDesktopLayout(json);
    } else if (mode === "mirror") {
      const res = await fetch(`${gatewayOrigin()}/v1/layout/desktop`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: json,
      });
      if (res.ok) rev = ((await res.json()) as { rev: number }).rev;
    } else if (mode === "account") {
      await fetch(`${gatewayOrigin()}/v1/me/layout`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: json,
      });
    }
  } catch {
    // The next change writes again; a missed one costs one change.
  }
}

/** Show a layout that came from elsewhere. False when it is not one. */
async function apply(value: unknown): Promise<boolean> {
  const { parseLayout, useLayoutStore } = await import("./layout");
  const layout = parseLayout(value);
  if (!layout) return false;
  // What arrived supersedes a local change not yet sent.
  clearTimeout(timer);
  lastApplied = JSON.stringify({ groups: layout.groups, activeGroupId: layout.activeGroupId });
  useLayoutStore.getState().adoptLayout(layout);
  return true;
}

async function current(): Promise<string> {
  const { useLayoutStore } = await import("./layout");
  const { groups, activeGroupId } = useLayoutStore.getState();
  return JSON.stringify({ groups, activeGroupId });
}

// The window hears about a token client's change from the gateway directly.
if (isTauri) {
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<string>("gateway:desktop-layout", (e) => void apply(JSON.parse(e.payload))))
    .catch(() => {});
}

/** A token client: take the window's Screens, then keep following them. */
export async function mirrorDesktopLayout(): Promise<void> {
  if (!isGatewayWeb || signedInAccount() || mode === "mirror") return;
  let first: { rev: number; layout: unknown } | null = null;
  try {
    const res = await fetch(`${gatewayOrigin()}/v1/layout/desktop`, { headers: auth() });
    if (!res.ok) return; // stay on this browser's own layout rather than guess
    first = (await res.json()) as { rev: number; layout: unknown };
  } catch {
    return;
  }
  mode = "mirror";
  rev = first.rev;
  // A window that has published nothing yet gets this browser's Screens.
  if (!(await apply(first.layout))) void push(await current());
  poller = setInterval(() => void poll(), POLL_MS);
}

async function poll(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const res = await fetch(`${gatewayOrigin()}/v1/layout/desktop?since=${rev}`, { headers: auth() });
    if (res.status !== 200) return; // 204: nothing newer
    const next = (await res.json()) as { rev: number; layout: unknown };
    rev = next.rev;
    await apply(next.layout);
  } catch {
    // The next poll is a second away.
  }
}

/** An account: show its Screens, or — the first time — make this browser's
 *  the account's. Until they are read nothing is written: the fresh page's
 *  default layout would overwrite the one being fetched. */
export async function adoptAccountLayout(): Promise<void> {
  if (!isGatewayWeb || mode === "account") return;
  let saved: unknown = null;
  try {
    const res = await fetch(`${gatewayOrigin()}/v1/me/layout`, { headers: auth() });
    if (!res.ok) return; // not readable now; stay local rather than overwrite
    saved = await res.json();
  } catch {
    return;
  }
  mode = "account";
  if (!(saved && (await apply(saved)))) void push(await current());
}

/** The desktop window's Screens, or [] when it has published none. */
export async function fetchDesktopScreens(): Promise<LayoutGroup[]> {
  const res = await fetch(`${gatewayOrigin()}/v1/layout/desktop`, { headers: auth() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { parseLayout } = await import("./layout");
  const { layout } = (await res.json()) as { layout: unknown };
  return parseLayout(layout)?.groups ?? [];
}

/** For the tests. */
export function resetLayoutSync(): void {
  clearTimeout(timer);
  clearInterval(poller);
  mode = isTauri ? "desktop" : null;
  rev = 0;
  lastApplied = null;
}
