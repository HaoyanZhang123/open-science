// Where a layout goes besides this browser's own storage.
//
// - The desktop window publishes its Screens to the gateway, so a web client
//   can copy them ("Open the desktop's Screens").
// - A web client signed in with an ACCOUNT keeps its Screens on the desktop:
//   browser storage is per address, and an account is the same person at
//   127.0.0.1, at the LAN IP, and at whatever IP the router hands out next.
//   A client signed in with the bare token has no account, and keeps its
//   Screens in this browser as before.
import type { LayoutGroup } from "./layout";
import { isTauri, publishDesktopLayout } from "./tauri";
import { gatewayOrigin, gatewayToken, isGatewayWeb } from "./webMode";

/** Typing-speed layout changes (a divider drag) become one write. */
const DELAY_MS = 800;

let timer: ReturnType<typeof setTimeout> | undefined;
/** The account's own layout has been read. Until then nothing is written:
 *  the fresh page's default layout would overwrite the one being fetched. */
let accountReady = false;

const auth = (): Record<string, string> => {
  const token = gatewayToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function layoutChanged(json: string): void {
  if (!isTauri && !(isGatewayWeb && accountReady)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void push(json), DELAY_MS);
}

async function push(json: string): Promise<void> {
  try {
    if (isTauri) await publishDesktopLayout(json);
    else
      await fetch(`${gatewayOrigin()}/v1/me/layout`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: json,
      });
  } catch {
    // The next change writes again; a missed one costs one change.
  }
}

/** Once a web client knows it is signed in as an account: show the account's
 *  Screens, or — the first time — make this browser's the account's. */
export async function adoptAccountLayout(): Promise<void> {
  if (accountReady || !isGatewayWeb) return;
  const { parseLayout, useLayoutStore } = await import("./layout");
  let saved: unknown = null;
  try {
    const res = await fetch(`${gatewayOrigin()}/v1/me/layout`, { headers: auth() });
    if (!res.ok) return; // not readable now; stay local rather than overwrite
    saved = await res.json();
  } catch {
    return;
  }
  const layout = saved ? parseLayout(saved) : null;
  accountReady = true;
  if (layout) {
    useLayoutStore.getState().adoptLayout(layout);
  } else {
    const { groups, activeGroupId } = useLayoutStore.getState();
    void push(JSON.stringify({ groups, activeGroupId }));
  }
}

/** The desktop window's Screens, or [] when it has published none. */
export async function fetchDesktopScreens(): Promise<LayoutGroup[]> {
  const res = await fetch(`${gatewayOrigin()}/v1/layout/desktop`, { headers: auth() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { parseLayout } = await import("./layout");
  return parseLayout(await res.json())?.groups ?? [];
}

/** For the tests. */
export function resetLayoutSync(): void {
  clearTimeout(timer);
  accountReady = false;
}
