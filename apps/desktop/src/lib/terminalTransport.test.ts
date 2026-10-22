import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({ isTauri: false }));
vi.mock("./webMode", () => ({
  isGatewayWeb: true,
  gatewayOrigin: () => "http://gw",
  gatewayToken: () => "tok",
  gatewayPost: vi.fn(async () => ({ ok: true })),
}));

const { readEvents, terminalTransport } = await import("./terminalTransport");
const { gatewayPost } = await import("./webMode");

/** A response body that delivers `parts` as separate reads, as a network does. */
function body(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("readEvents", () => {
  it("joins frames split across reads, skips keepalives, and stops on exit", async () => {
    const data: string[] = [];
    const onExit = vi.fn();
    const exited = await readEvents(
      body(['data: "$ ls\\r', '\\n"\n\n: keepalive\n\n', 'data: "─┐"\n\nevent: exit\ndata: null\n\n']),
      { onData: (c) => data.push(c), onExit },
    );
    expect(data).toEqual(["$ ls\r\n", "─┐"]);
    expect(exited).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("tells a dropped connection from an exited shell", async () => {
    expect(await readEvents(body(['data: "x"\n\n']), { onData() {}, onExit() {} })).toBe(false);
  });
});

describe("the web transport", () => {
  it("talks to /v1/terminals with the bearer token, never a token in the URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await terminalTransport.open("leaf-1", "/work", 80, 24);
    await terminalTransport.write("leaf-1", "ls\n");
    await terminalTransport.close("leaf-1");
    expect(gatewayPost).toHaveBeenCalledWith("/v1/terminals/leaf-1", { cwd: "/work", cols: 80, rows: 24 });
    expect(gatewayPost).toHaveBeenCalledWith("/v1/terminals/leaf-1/input", { data: "ls\n" });
    expect(fetchMock).toHaveBeenCalledWith("http://gw/v1/terminals/leaf-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("re-reads a dropped stream, clearing the screen before the replay", async () => {
    const responses = [
      new Response(body(['data: "first"\n\n'])), // drops without an exit
      new Response(body(['data: "replayed"\n\nevent: exit\ndata: null\n\n'])),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    vi.useFakeTimers();
    const events: string[] = [];
    await terminalTransport.subscribe("leaf-1", {
      onData: (c) => events.push(c),
      onReset: () => events.push("<reset>"),
      onExit: () => events.push("<exit>"),
    });
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(events).toEqual(["first", "<reset>", "replayed", "<exit>"]);
  });

  it("ends, rather than retrying forever, when the terminal is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const onExit = vi.fn();
    await terminalTransport.subscribe("leaf-1", { onData() {}, onReset() {}, onExit });
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
  });
});
