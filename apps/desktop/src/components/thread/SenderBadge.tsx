import { useTranslation } from "react-i18next";
import { Bot, UserRound } from "lucide-react";
import { copyReference, sessionReference } from "@/lib/agentReference";
import type { MessageSender } from "@/lib/messageSenders";
import { useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";

/**
 * Who sent something that was not the owner's — an agent of another
 * conversation, or a web account — on a message or a terminal. A badge,
 * because a conversation's title is long: hovering shows it whole (and
 * `detail`, when given), and clicking an agent's badge copies that
 * conversation's reference — the lines right-click copies — so it can be
 * handed straight to another agent ("reply to whoever asked").
 */
export function SenderBadge({ sender, detail, className }: { sender: MessageSender; detail?: string; className?: string }) {
  const { t } = useTranslation("session");
  const cls = cn(
    "flex max-w-[60%] items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-muted",
    className,
  );
  const withDetail = (text: string) => (detail ? `${text}\n\n${detail}` : text);
  if (sender.viaId) {
    const id = sender.viaId;
    const title = sender.viaSession ?? id;
    return (
      <button
        type="button"
        className={cn(cls, "hover:bg-surface-2 hover:text-text")}
        title={withDetail(t("message.sentByAgentFull", { session: title, id }))}
        onClick={() => {
          const s = useRuntimeStore.getState().sessions.find((x) => x.id === id);
          void copyReference(
            sessionReference({ id, title: s?.title ?? title, directory: s?.directory }),
            t("reference.copied"),
          );
        }}
      >
        <Bot size={11} className="shrink-0" />
        <span className="truncate">{sender.account ? `${sender.account} · ${title}` : title}</span>
      </button>
    );
  }
  return (
    <span className={cls} title={withDetail(t("message.sentByAccount", { account: sender.account }))}>
      <UserRound size={11} className="shrink-0" />
      <span className="truncate">{sender.account}</span>
    </span>
  );
}
