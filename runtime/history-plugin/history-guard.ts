// Keep a damaged conversation sendable (#114), and keep a screenshot-heavy one
// fast (see KEEP_IMAGES).
//
// A session dies permanently with `Invalid prompt: The messages do not match
// the ModelMessage[] schema` when one stored part is missing a field the AI
// SDK's message format requires. The damage is on disk, so every later turn
// resends it and fails identically — the session is bricked, and no retry,
// restart or runtime upgrade recovers it.
//
// OpenCode fires `experimental.chat.messages.transform` on the very array it
// then hands to `toModelMessages` (`session/prompt.ts`: the trigger sits
// immediately above `MessageV2.toModelMessagesEffect(msgs, model)`), so a
// repair applied here reaches the model and nothing else. This restores the
// required fields in place, per request. It never writes to storage: the stored
// history stays exactly as the runtime left it — auditable, exportable, and
// untouched if the real defect is later fixed upstream.
//
// The rules below are derived from `toModelMessagesEffect`, not from shapes we
// have observed, and they deliberately leave alone everything that converter
// already repairs (interrupted tool calls, results cleared by compaction,
// `metadata.interrupted` outputs). The app's `malformedHistory.ts` reports the
// same set to the user; the two must stay in step.
//
// MUST mutate in place. `output.messages` and the array the converter reads are
// the same reference; replacing `output.messages` would repair a copy nobody
// looks at.

const NO_OUTPUT = "[No tool output was recorded]";
const NO_ERROR = "[No error detail was recorded]";

type Part = {
  type?: string;
  text?: unknown;
  callID?: unknown;
  metadata?: unknown;
  state?: {
    status?: string;
    output?: unknown;
    error?: unknown;
    time?: { compacted?: unknown };
    metadata?: { interrupted?: unknown; output?: unknown };
  };
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** `providerMetadata` must be a two-level record: every top-level value is
 *  itself an object. The converter forwards a text/reasoning part's metadata to
 *  the model untouched, so anything shallower is rejected by the schema — which
 *  is exactly what #114 was, from our own `{ source: "…" }`. Only a malformed
 *  one is dropped; a signed Anthropic reasoning block keeps its signature,
 *  which the turn depends on.
 *
 *  Tool parts are deliberately NOT covered: their metadata reaches the model
 *  through `providerMeta`, which already strips the one key the runtime is
 *  known to put there (`providerExecuted`), and nothing in this app writes tool
 *  metadata at all. */
function metadataIsWellFormed(metadata: unknown): boolean {
  if (metadata === undefined || metadata === null) return true;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return Object.values(metadata as Record<string, unknown>).every(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  );
}

function repairPart(part: Part, synthesizeCallID: () => string): void {
  if (part.type === "text" || part.type === "reasoning") {
    // A stream that died between its start and its first delta leaves the part
    // with no text at all. An empty string is what the converter expects of a
    // part that said nothing, and it is what a live empty part already is.
    if (!isString(part.text)) part.text = "";
    if (!metadataIsWellFormed(part.metadata)) delete part.metadata;
    return;
  }
  if (part.type !== "tool") return;
  // One id serves both the call and its result, so a synthetic one stays
  // internally consistent — it only has to be unique within this request.
  if (!isString(part.callID) || !part.callID) part.callID = synthesizeCallID();
  const state = part.state;
  if (!state) return;
  if (state.status === "completed") {
    if (state.time?.compacted) return; // replaced by a placeholder downstream
    if (!isString(state.output)) state.output = NO_OUTPUT;
    return;
  }
  if (state.status === "error") {
    // An interrupted tool reports through metadata.output instead.
    if (state.metadata?.interrupted === true && isString(state.metadata.output)) return;
    if (!isString(state.error)) state.error = NO_ERROR;
  }
  // `pending` and `running` are backfilled by the converter itself.
}

// Only the newest screenshots stay attached. Every turn resends the whole
// history, and a provider re-encodes every image in it each time — prompt
// caching saves the tokens, not the time. Measured on deepseek-v4-flash: one
// image ~3–6 s before the first token, four ~26–30 s cached or not, so an agent
// checking its UI with a dozen screenshots waited ~5 min per step. An older
// image is detached for this request only; its result says where to find it
// again.
const KEEP_IMAGES = 2;

type Attachment = { mime?: unknown };

function isImage(attachment: unknown): boolean {
  const mime = (attachment as Attachment | null)?.mime;
  return typeof mime === "string" && mime.startsWith("image/");
}

function detachOldImages(parts: Part[]): void {
  let kept = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const state = parts[i].state as
      | (Part["state"] & { attachments?: unknown; input?: { filePath?: unknown } })
      | undefined;
    if (parts[i].type !== "tool" || state?.status !== "completed" || state.time?.compacted) continue;
    if (!Array.isArray(state.attachments)) continue;
    const images = state.attachments.filter(isImage).length;
    if (images === 0) continue;
    if (kept + images <= KEEP_IMAGES) {
      kept += images;
      continue;
    }
    kept = KEEP_IMAGES; // once one is dropped, everything older goes too
    state.attachments = state.attachments.filter((a) => !isImage(a));
    const file = state.input?.filePath;
    const where = isString(file) ? `read ${file} again` : "take it again";
    state.output = `${isString(state.output) ? state.output : NO_OUTPUT}\n[Image no longer attached, to keep turns fast — ${where} if you need to see it.]`;
  }
}

// Nothing is exported but the plugin factory: OpenCode's external-plugin loader
// calls every export it finds as a factory, so an exported helper is invoked
// with no arguments at load time and takes the whole module down with it.
export const HistoryGuardPlugin = async () => ({
  "experimental.chat.messages.transform": async (
    _input: unknown,
    output: { messages?: Array<{ parts?: unknown }> },
  ) => {
    // This runs before every turn of every session. A throw here would block
    // sending outright — strictly worse than the defect it guards against — so
    // nothing in it is allowed to escape.
    try {
      const messages = output?.messages;
      if (!Array.isArray(messages)) return;
      let counter = 0;
      const synthesizeCallID = () => `osd-repaired-${counter++}`;
      const all: Part[] = [];
      for (const message of messages) {
        const parts = message?.parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (!part || typeof part !== "object") continue;
          repairPart(part as Part, synthesizeCallID);
          all.push(part as Part);
        }
      }
      detachOldImages(all);
    } catch {
      // Leave the turn to fail the way it would have without us.
    }
  },
});
