import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "@/lib/tauri";
import { RemoteAccessCard } from "./RemoteAccessCard";

const state = vi.hoisted(() => ({ current: null as GatewayStatus | null }));
const setConfig = vi.hoisted(() => vi.fn(async () => state.current));

vi.mock("@/lib/tauri", () => ({
  isTauri: true,
  getGatewayStatus: async () => state.current,
  setGatewayConfig: (...a: unknown[]) => setConfig(...(a as [])),
  regenerateGatewayToken: async () => state.current,
  acpServerScript: async () => null,
}));

const status = (over: Partial<GatewayStatus> = {}): GatewayStatus => ({
  enabled: true,
  lan: false,
  mode: "full",
  running: true,
  port: 4098,
  configuredPort: null,
  loopbackUrl: "http://127.0.0.1:4098",
  lanUrl: null,
  token: "tok",
  terminal: false,
  ...over,
});

beforeEach(() => {
  setConfig.mockClear();
  state.current = status();
});

describe("Settings → Remote Access, the gateway port", () => {
  it("sends the port the user typed", async () => {
    render(<RemoteAccessCard />);
    await waitFor(() => expect(screen.getByText("Gateway port")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("4098"), "9090");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(setConfig).toHaveBeenCalledWith(true, false, "full", 9090, false);
  });

  it("refuses a port outside 1-65535 without calling the backend", async () => {
    render(<RemoteAccessCard />);
    await waitFor(() => expect(screen.getByText("Gateway port")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("4098"), "70000");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(setConfig).not.toHaveBeenCalled();
  });

  it("carries a pinned port through an unrelated change, instead of clearing it", async () => {
    // Every setter posts the whole config, so a mode flip that forgot to pass
    // the pin would silently unpin the gateway and move it on the next rebind.
    state.current = status({ configuredPort: 9090, port: 9090 });
    render(<RemoteAccessCard />);
    await waitFor(() => expect(screen.getByText("Gateway port")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByDisplayValue("Full access"), "read-only");

    expect(setConfig).toHaveBeenCalledWith(true, false, "read-only", 9090, false);
  });

  it("clears the pin only when the user asks it to", async () => {
    state.current = status({ configuredPort: 9090, port: 9090 });
    render(<RemoteAccessCard />);
    await waitFor(() => expect(screen.getByText("Gateway port")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(setConfig).toHaveBeenCalledWith(true, false, "full", null, false);
  });
});

describe("Settings → Remote Access, terminals", () => {
  it("turns terminals on only after the user confirms what that means", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RemoteAccessCard />);
    const toggle = await screen.findByRole("switch", { name: "Allow terminals" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);
    expect(setConfig).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    expect(setConfig).toHaveBeenCalledWith(true, false, "full", null, true);
    confirm.mockRestore();
  });

  it("offers no terminal to a read-only token", async () => {
    state.current = status({ mode: "read-only", terminal: true });
    render(<RemoteAccessCard />);
    const toggle = await screen.findByRole("switch", { name: "Allow terminals" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("keeps the terminal choice through an unrelated change", async () => {
    state.current = status({ terminal: true });
    render(<RemoteAccessCard />);
    await screen.findByRole("switch", { name: "Allow terminals" });
    await userEvent.selectOptions(screen.getByDisplayValue("Full access"), "read-only");
    expect(setConfig).toHaveBeenCalledWith(true, false, "read-only", null, true);
  });
});
