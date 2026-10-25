import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRuntimeStore } from "@/lib/runtime";
import { BlockList, type BlockHandlers } from "./BlockList";

/**
 * What `/clear` left behind: the conversation it cleared, kept on screen above
 * a divider — like a terminal's scrollback after `clear`.
 *
 * The earlier session is its own OpenCode session; the model of the new one
 * never sees it. So it renders faded and read-only (no edit, revert or retry —
 * those would act on a session this pane no longer drives), and the divider
 * says so in words. Opening the earlier session is one click away.
 */
export function ClearedHistory({
  sessionId,
  connected,
  handlers,
  onOpen,
}: {
  /** The session this pane was cleared from. */
  sessionId: string;
  connected: boolean;
  /** The pane's handlers; only opening a file card carries over. */
  handlers: BlockHandlers;
  /** Show the earlier session in this pane. Absent when it no longer exists. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation("session");
  const thread = useRuntimeStore((s) => s.threads[sessionId]);
  const loadHistory = useRuntimeStore((s) => s.loadHistory);
  const loaded = !!thread?.loaded && !thread.historyError;
  useEffect(() => {
    if (connected && !loaded) void loadHistory(sessionId);
  }, [connected, loaded, loadHistory, sessionId]);
  const earlierHandlers = useMemo(
    () => ({ onArtifactOpen: handlers.onArtifactOpen }),
    [handlers.onArtifactOpen],
  );

  return (
    <>
      {loaded && thread.blocks.length > 0 && (
        <div className="opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <BlockList blocks={thread.blocks} handlers={earlierHandlers} />
        </div>
      )}
      <div role="separator" aria-label={t("localCommand.clearedLabel")} className="my-5">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          <span className="shrink-0 font-medium">{t("localCommand.clearedLabel")}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <p className="mt-1 text-center text-xs text-muted">
          {t("localCommand.clearedHint")}
          {onOpen && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onOpen}
                className="underline-offset-2 hover:text-text hover:underline"
              >
                {t("localCommand.openEarlier")}
              </button>
            </>
          )}
        </p>
      </div>
    </>
  );
}
