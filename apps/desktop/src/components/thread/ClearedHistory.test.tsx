import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeStore } from "@/lib/runtime";
import { ClearedHistory } from "./ClearedHistory";

describe("cleared history", () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      threads: {
        ses_old: { blocks: [{ kind: "user", text: "earlier question" }], index: {}, loaded: true },
      },
    });
  });

  it("keeps the earlier conversation above a divider that says the model cannot see it", async () => {
    const onOpen = vi.fn();
    render(<ClearedHistory sessionId="ses_old" connected handlers={{}} onOpen={onOpen} />);

    expect(screen.getByText("earlier question")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Context cleared" })).toBeInTheDocument();
    expect(screen.getByText(/no longer sees the messages above/)).toBeInTheDocument();
    // Read-only: no edit/revert controls on a session this pane no longer drives.
    expect(screen.queryByRole("button", { name: /edit|revert/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open that session" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("offers no way back to a session that no longer exists", () => {
    render(<ClearedHistory sessionId="ses_old" connected handlers={{}} />);
    expect(screen.queryByRole("button", { name: "Open that session" })).not.toBeInTheDocument();
  });
});
