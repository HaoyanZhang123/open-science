import { beforeEach, describe, expect, it, vi } from "vitest";

(window as unknown as { __OS_WEB__?: boolean }).__OS_WEB__ = true;
Object.defineProperty(window, "location", {
  value: { ...window.location, origin: "http://gw" },
  writable: true,
});

const fetchMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => { throw new Error("browser must not use Tauri IPC"); },
}));

const { listProvenance, readEnvLockfile, recordProvenance } = await import("./provenance");

describe("provenance in the gateway web client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("os_gateway_token", "tok");
  });

  it("reads one artifact's history through the authenticated gateway", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [{ path: "fig/plot.svg", runId: "run_1" }],
    });
    expect(await listProvenance("fig/plot.svg")).toEqual([{ path: "fig/plot.svg", runId: "run_1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gw/v1/provenance?path=fig%2Fplot.svg");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("reads a captured environment lockfile as text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "numpy==2.0\n",
    });
    expect(await readEnvLockfile("ab12")).toBe("numpy==2.0\n");
    expect(fetchMock.mock.calls[0][0]).toBe("http://gw/v1/provenance/lockfile?hash=ab12");
  });

  it("scopes history to the viewed session's folder", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [],
    });
    await listProvenance("fig/plot.svg", "/ws/projects/p1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://gw/v1/provenance?path=fig%2Fplot.svg&dir=%2Fws%2Fprojects%2Fp1");
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "",
    });
    await readEnvLockfile("ab12", "/ws/projects/p1");
    expect(fetchMock.mock.calls[1][0]).toBe("http://gw/v1/provenance/lockfile?hash=ab12&dir=%2Fws%2Fprojects%2Fp1");
  });

  it("records the agent's write through the gateway, keyed by its tool call", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: 1 }) });
    await recordProvenance(
      { path: "fig/plot.py", tool: "write", content: "print(1)", log: "write → plot.py" },
      "ses_1",
      "m/x",
      "call_7",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gw/v1/provenance");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      path: "fig/plot.py",
      tool: "write",
      content: "print(1)",
      log: "write → plot.py",
      sessionId: "ses_1",
      model: "m/x",
      callId: "call_7",
    });
  });

  it("does not record a write it cannot place in a session", async () => {
    await recordProvenance({ path: "a.py", tool: "write", log: "w" }, undefined, null, "call_8");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
