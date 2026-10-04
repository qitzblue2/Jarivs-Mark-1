"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, ShieldAlert } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatPane from "./ChatPane";
import CodeCanvas from "./CodeCanvas";
import SettingsDialog, { DEFAULT_SETTINGS, type Settings } from "./SettingsDialog";
import VoiceMode from "./VoiceMode";
import Gallery from "./Gallery";
import UsagePanel from "./UsagePanel";
import SandboxPanel from "./SandboxPanel";
import TrashPanel from "./TrashPanel";
import SavedPanel from "./SavedPanel";
import ChatInstructions from "./ChatInstructions";
import InboxPanel from "./InboxPanel";
import InitiativeHost from "./InitiativeHost";
import type { PendingApproval } from "./ApprovalCard";
import { kokoroEngine, getTts } from "@/lib/voice/tts";
import { forSpeech } from "@/lib/voice/tts/types";
import { Speaker } from "@/lib/voice/tts/speaker";
import { parseSlash, type SlashMatch } from "@/lib/slash";
import { draftKey, loadDraft, saveDraft } from "@/lib/drafts";
import SidebarResizer from "./SidebarResizer";
import ShortcutsDialog from "./ShortcutsDialog";
import ConnectionBanner from "./ConnectionBanner";
import { isHelpKey, isTypingTarget } from "@/lib/shortcuts";
import { getAppearance, setAppearance } from "@/lib/appearance-store";
import { THEMES } from "@/lib/appearance";
import { contextCeiling, measureContext } from "@/lib/context-meter";
import { favoriteKey, toggleFavorite } from "@/lib/favorites";
import { ModelsContext, type ModelsContextValue } from "./models-context";
import type { QuickActionId } from "./Welcome";
import { recentChats } from "@/lib/welcome";
import { estimateReplyTokens } from "@/lib/format";
import type { ProviderState } from "./ModelPicker";
import { consumeJarvisStream } from "@/lib/stream";
import { artifactsFromMessage, artifactsFromMessages } from "@/lib/codeblocks";
import { normalizeTag, normalizeTags } from "@/lib/chat-ops";
import { newId, type Attachment, type Chat, type ChatMeta, type Message, type ToolRound } from "@/lib/types";
import { lighten } from "@/lib/attachments";
import { getInitiative, moodEvent, noteTone, offerNow } from "@/lib/initiative/store";
import { readTone, type Tone } from "@/lib/initiative/tone";
import { appendQuote, quoteText } from "@/lib/reading";
import { applyTagCommand, findModel, fillVariables, promptVariables, undoLastExchange } from "@/lib/composing";
import PromptVariables from "./PromptVariables";
import { CHATS_CHANGED } from "./DataSettings";
import { detectFact } from "@/lib/initiative/suggest";
import { rememberNudge, type Nudge, type NudgeAction } from "@/lib/initiative/rules";
import { RULE_INFO, type RuleId } from "@/lib/initiative/config";

const SETTINGS_KEY = "jarvis.settings.v1";
const SELECTION_KEY = "jarvis.selection.v1";
const CANVAS_WIDTH_KEY = "jarvis.canvasWidth.v1";

/** Derive a chat title from the first thing the user said. */
function deriveTitle(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? "New chat";
  const clean = line.replace(/^[#>\-*\s]+/, "").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "New chat";
}

/** The chat last talked in. The sidebar's order leads with pinned ones, so it can't be used. */
function mostRecent(list: ChatMeta[]): ChatMeta | undefined {
  return list.reduce<ChatMeta | undefined>((best, c) => (!best || c.updatedAt > best.updatedAt ? c : best), undefined);
}

/** The tone of the message being answered, if Settings lets it be read; the server only learns a name. */
function toneOf(history: Message[]): Tone | undefined {
  if (!getInitiative().config.adaptTone) return undefined;
  const last = [...history].reverse().find((m) => m.role === "user");
  const tone = last ? readTone(last.content) : "neutral";
  return tone === "neutral" ? undefined : tone;
}

/**
 * What a message you've just sent changes beyond being answered: its tone moves
 * the mood (and after a hard one, keeps cards away), and a lasting fact in it may
 * be offered to memory once the reply is in.
 */
function noticeUserMessage(text: string) {
  const { config } = getInitiative();
  if (config.adaptTone) noteTone(readTone(text));
  const fact = config.rules["remember-offer"] ? detectFact(text) : null;
  // Held until the reply has arrived: asking about memory over the top of an answer is rude.
  if (fact) offerNow(rememberNudge(fact, Date.now()), { streaming: true });
}

const RECAP_PROMPT = "Where did we leave off? Give me a quick recap.";

export default function Workspace() {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);

  const [streaming, setStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [storage, setStorage] = useState("fs");
  const [security, setSecurity] = useState<{
    computerAccess: boolean;
    exposedWithComputerAccess: boolean;
  } | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /** The chat whose own instructions are being edited, loaded in full. */
  const [instructionsFor, setInstructionsFor] = useState<{ id: string; title: string; persona?: string } | null>(null);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  /** A saved prompt with blanks, waiting for them to be filled. */
  const [fillingPrompt, setFillingPrompt] = useState<{ name: string; text: string; args: string } | null>(null);
  const [selfEdit, setSelfEdit] = useState<{ enabled: boolean; isSandbox: boolean; port: number } | null>(null);
  /** What each request carries besides the conversation, for the context meter. */
  const [overhead, setOverhead] = useState({ toolTokens: 0, noteTokens: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(44);
  const draggingRef = useRef(false);

  const artifacts = useMemo(
    () => (chat ? artifactsFromMessages(chat.messages) : []),
    [chat],
  );

  // Settings live in this browser; keys never go to disk on the server.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const stored = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        setSettings(stored);
        kokoroEngine.setQuality(stored.ttsQuality);
      }
      const width = localStorage.getItem(CANVAS_WIDTH_KEY);
      if (width) setCanvasWidth(Number(width));
    } catch {
      /* first run, private mode, or corrupt value — defaults are fine */
    }
  }, []);

  const saveSettings = useCallback((next: Settings) => {
    setSettings(next);
    // Applied before anything speaks, so a changed build is picked up on the
    // next utterance rather than after a reload.
    kokoroEngine.setQuality(next.ttsQuality);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked */
    }
  }, []);

  /** Ask the server which providers are usable and what models they serve. */
  const loadProviders = useCallback(async (
    keys: Record<string, string>,
    endpoints: Record<string, string>,
  ) => {
    try {
      const res = await fetch("/api/models", {
        headers: {
          "x-jarvis-keys": JSON.stringify(keys),
          "x-jarvis-endpoints": JSON.stringify(endpoints),
        },
      });
      const data = await res.json();
      const list: ProviderState[] = data.providers ?? [];
      setProviders(list);
      setStorage(data.storage ?? "fs");
      setSecurity(data.security ?? null);
      setSelfEdit(data.selfEdit ?? null);
      setOverhead({ toolTokens: data.overhead?.toolTokens ?? 0, noteTokens: data.overhead?.noteTokens ?? 0 });

      // Restore the last selection when it's still valid, else pick the first
      // usable provider with a model. "Usable" rather than "has a key": a
      // local server needs none and would otherwise never be auto-selected.
      setProvider((currentProvider) => {
        setModel((currentModel) => {
          const current = list.find((p) => p.id === currentProvider);
          if (current?.ready && current.models.includes(currentModel)) return currentModel;

          let saved: { provider?: string; model?: string } = {};
          try {
            saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}");
          } catch {
            /* ignore */
          }

          const savedProvider = list.find((p) => p.id === saved.provider);
          if (savedProvider?.ready && saved.model && savedProvider.models.includes(saved.model)) {
            queueMicrotask(() => setProvider(savedProvider.id));
            return saved.model;
          }

          const usable =
            list.find((p) => p.id === data.defaultProvider && p.ready && p.models.length) ??
            list.find((p) => p.ready && p.models.length);

          if (usable) {
            queueMicrotask(() => setProvider(usable.id));
            return usable.models[0];
          }
          return currentModel;
        });
        return currentProvider;
      });
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void loadProviders(settings.keys, settings.endpoints ?? {});
  }, [loadProviders, settings.keys, settings.endpoints]);

  const refreshChats = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      const data = await res.json();
      setChats(data.chats ?? []);
      return (data.chats ?? []) as ChatMeta[];
    } catch {
      return [];
    }
  }, []);

  // Open the most recent chat on first load — by activity, not list order,
  // which puts pinned chats first.
  useEffect(() => {
    void (async () => {
      const list = await refreshChats();
      const latest = mostRecent(list.filter((c) => !c.archived));
      if (latest) void selectChat(latest.id);
    })();
    // Runs once — selectChat is stable enough for a mount-time restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setChat(data.chat);
      setActiveArtifactId(null);
      setSidebarOpen(false);
      if (data.chat?.provider) setProvider(data.chat.provider);
      if (data.chat?.model) setModel(data.chat.model);
    } catch {
      /* network hiccup — leave the current chat in place */
    }
  }, []);

  /** Write the settled conversation to the store. */
  const persist = useCallback(
    async (target: Chat) => {
      try {
        await fetch(`/api/chats/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: target.title,
            messages: target.messages,
            provider: target.provider,
            model: target.model,
          }),
        });
        await refreshChats();
      } catch {
        /* the chat stays in memory; the next turn will retry the write */
      }
    },
    [refreshChats],
  );

  const createChat = useCallback(async (): Promise<Chat | null> => {
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const data = await res.json();
      await refreshChats();
      return data.chat ?? null;
    } catch {
      return null;
    }
  }, [provider, model, refreshChats]);

  function newChat() {
    moodEvent("new-chat");
    setChat(null);
    setActiveArtifactId(null);
    setSidebarOpen(false);
  }

  /** Moves to the trash, where it stays recoverable for 30 days. */
  async function deleteChat(id: string) {
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    const list = await refreshChats();
    setNotice("Moved to the trash. Open Trash at the bottom of the chat list to get it back.");
    if (chat?.id === id) {
      const latest = mostRecent(list.filter((c) => !c.archived));
      if (latest) void selectChat(latest.id);
      else setChat(null);
    }
  }

  /** Tidy-up changes: shown at once, then confirmed by the server. */
  async function patchChat(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setNotice((await res.json().catch(() => ({})))?.error ?? "That change didn't save.");
    await refreshChats();
  }

  // A chat was added from outside the list — imported from a file.
  useEffect(() => {
    const onChanged = () => void refreshChats();
    window.addEventListener(CHATS_CHANGED, onChanged);
    return () => window.removeEventListener(CHATS_CHANGED, onChanged);
  }, [refreshChats]);

  /** Archive, tag or trash several chats at once, one request each. */
  async function bulkChats(ids: string[], action: { type: "archive" } | { type: "trash" } | { type: "tag"; tag: string }) {
    let done = 0;
    for (const id of ids) {
      try {
        if (action.type === "trash") {
          await fetch(`/api/chats/${id}`, { method: "DELETE" });
        } else if (action.type === "archive") {
          await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true, quiet: true }) });
        } else {
          const tags = normalizeTags([...(chats.find((c) => c.id === id)?.tags ?? []), action.tag]);
          await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags }) });
        }
        done++;
      } catch {
        /* the rest still go; the count at the end says how many did */
      }
    }
    const list = await refreshChats();
    const noun = `${done} chat${done === 1 ? "" : "s"}`;
    setNotice(
      action.type === "trash"
        ? `Moved ${noun} to the trash. Open Trash at the bottom of the chat list to get them back.`
        : action.type === "archive"
          ? `Archived ${noun}.`
          : `Tagged ${noun} #${normalizeTag(action.tag)}.`,
    );
    if (chat && ids.includes(chat.id) && action.type !== "tag") {
      const latest = mostRecent(list.filter((c) => !c.archived));
      if (latest) void selectChat(latest.id);
      else setChat(null);
    }
  }

  async function archiveChat(id: string, archived: boolean) {
    setChats((all) => all.map((c) => (c.id === id ? { ...c, archived: archived || undefined } : c)));
    if (chat?.id === id) setChat((c) => (c ? { ...c, archived: archived || undefined } : c));
    await patchChat(id, { archived });
  }

  async function setChatTags(id: string, tags: string[]) {
    setChats((all) => all.map((c) => (c.id === id ? { ...c, tags: tags.length ? tags : undefined } : c)));
    if (chat?.id === id) setChat((c) => (c ? { ...c, tags: tags.length ? tags : undefined } : c));
    await patchChat(id, { tags });
  }

  /** A whole-chat copy (no messageId) or a branch from one message. */
  const copyChat = useCallback(async (id: string, messageId?: string) => {
    try {
      const res = await fetch(`/api/chats/${id}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageId ? { messageId } : {}),
      });
      const data = await res.json();
      if (!res.ok) return setNotice(data.error ?? "Couldn't copy that chat.");
      await refreshChats();
      await selectChat(data.chat.id);
    } catch {
      setNotice("Couldn't reach the server.");
    }
  }, [refreshChats, selectChat]);

  async function editInstructions(id: string) {
    try {
      const res = await fetch(`/api/chats/${id}`);
      const data = await res.json();
      if (data.chat) setInstructionsFor({ id, title: data.chat.title, persona: data.chat.persona });
    } catch {
      setNotice("Couldn't load that chat.");
    }
  }

  async function saveInstructions(text: string | null) {
    if (!instructionsFor) return;
    const { id } = instructionsFor;
    if (chat?.id === id) setChat((c) => (c ? { ...c, persona: text ?? undefined } : c));
    await patchChat(id, { persona: text });
  }

  /** Add what's missing from a backup zip; nothing existing is overwritten. */
  async function restoreBackupFile(file: File) {
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      const data = await res.json();
      setNotice(res.ok ? data.summary : data.error ?? "That backup couldn't be restored.");
      if (res.ok) await refreshChats();
    } catch {
      setNotice("Couldn't reach the server.");
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    // Shown at once; the list re-sorts when the server confirms.
    setChats((all) => all.map((c) => (c.id === id ? { ...c, pinned } : c)));
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    await refreshChats();
  }

  async function renameChat(id: string, title: string) {
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (chat?.id === id) setChat((c) => (c ? { ...c, title } : c));
    await refreshChats();
  }

  /**
   * Stream one assistant turn. `history` is the full message list the model
   * should see, already including the new user turn.
   */
  const runTurn = useCallback(
    async (
      target: Chat,
      history: Message[],
      /** Called with the cumulative reply as it streams, for voice mode. */
      onProgress?: (soFar: string) => void,
      /** Run as a task: more tool rounds, and the goal pinned against trims. */
      task = false,
      /** Answer with this model instead of the selected one — "regenerate with…". */
      via?: { provider: string; model: string },
    ): Promise<string> => {
      const chosenProvider = via?.provider ?? provider;
      const chosenModel = via?.model ?? model;
      const assistantId = newId();
      const assistant: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        provider: chosenProvider,
        model: chosenModel,
      };

      setChat({ ...target, messages: [...history, assistant] });
      setStreaming(true);
      setStreamingId(assistantId);

      const controller = new AbortController();
      abortRef.current = controller;

      let acc = "";
      let usedProvider = chosenProvider;
      let usedModel = chosenModel;
      let fellBackFrom: string | undefined;
      let errorMessage: string | undefined;
      let toolRounds: ToolRound[] = [];
      // Measured here, in the browser, so it includes the network — which is
      // what you actually wait for.
      const startedAt = Date.now();
      let firstTokenAt = 0;

      // Groq streams fast enough that a setState per token is wasted work.
      let lastPaint = 0;
      const paint = (force = false) => {
        const now = Date.now();
        if (!force && now - lastPaint < 40) return;
        lastPaint = now;
        setChat((current) => {
          if (!current) return current;
          return {
            ...current,
            messages: current.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: acc,
                    provider: usedProvider,
                    model: usedModel,
                    fellBackFrom,
                    toolRounds: toolRounds.length ? toolRounds : undefined,
                  }
                : m,
            ),
          };
        });
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
            })),
            provider: chosenProvider,
            model: chosenModel,
            temperature: settings.temperature,
            // A chat's own instructions replace the Settings ones for it alone.
            persona: target.persona?.trim() ? target.persona : settings.persona,
            // How the message being answered read — a name the server turns into
            // one sentence of guidance. Read here, in the browser, and not stored.
            tone: toneOf(history),
            useTools: settings.useTools,
            task,
            keys: settings.keys,
            endpoints: settings.endpoints ?? {},
            budgets: settings.budgets ?? {},
            macs: settings.macs ?? {},
          }),
        });

        if (!res.body) throw new Error("The server returned no response stream.");

        await consumeJarvisStream(res.body, (event) => {
          if (event.type === "meta") {
            usedProvider = event.provider;
            usedModel = event.model;
            fellBackFrom = event.fellBackFrom;
            paint(true);
          } else if (event.type === "token") {
            if (!firstTokenAt) firstTokenAt = Date.now();
            acc += event.value;
            onProgress?.(acc);
            paint();
          } else if (event.type === "tool_start") {
            // Show the call immediately; results fill in when the round ends.
            toolRounds = [
              ...toolRounds,
              { round: event.round, maxRounds: event.maxRounds, calls: event.calls, results: [] },
            ];
            paint(true);
          } else if (event.type === "tool_end") {
            toolRounds = toolRounds.map((r) =>
              r.round === event.round ? { ...r, results: event.results } : r,
            );
            paint(true);
          } else if (event.type === "approval_request") {
            setApprovals((prev) => [
              ...prev,
              { id: event.id, kind: event.kind, summary: event.summary, detail: event.detail, path: event.path },
            ]);
          } else if (event.type === "tools_unsupported") {
            setNotice(`${event.model} does not support tools — answered without them.`);
          } else if (event.type === "error") {
            errorMessage = event.message;
          }
        });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          errorMessage = (err as Error).message || "The request failed.";
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setStreamingId(null);
        // Any card still on screen belongs to a turn that has ended.
        setApprovals([]);
      }

      const finalMessage: Message = {
        ...assistant,
        content: acc,
        provider: usedProvider,
        model: usedModel,
        fellBackFrom,
        error: errorMessage,
        toolRounds: toolRounds.length ? toolRounds : undefined,
        // Nothing to report for a reply that never produced a word.
        stats: firstTokenAt
          ? { totalMs: Date.now() - startedAt, firstTokenMs: firstTokenAt - startedAt, tokens: estimateReplyTokens(acc) }
          : undefined,
      };

      const settled: Chat = {
        ...target,
        messages: [
          ...history.map((m) =>
            m.attachments ? { ...m, attachments: m.attachments.map(lighten) } : m,
          ),
          finalMessage,
        ],
        provider: usedProvider,
        model: usedModel,
        updatedAt: Date.now(),
      };

      setChat(settled);
      void persist(settled);

      // Surface new code without stealing focus mid-answer.
      const produced = artifactsFromMessage(finalMessage);
      if (produced.length > 0) {
        setActiveArtifactId(produced[produced.length - 1].id);
        setCanvasOpen(true);
      }

      // How it went, for the mood: a stopped reply says nothing either way.
      if (errorMessage) moodEvent("reply-failed");
      else if (!controller.signal.aborted) moodEvent("reply-ok");
      if (toolRounds.some((r) => r.results.some((x) => x.isError))) moodEvent("tool-failed");

      // Returned so voice mode can speak the answer it just produced.
      return errorMessage ? `Sorry — ${errorMessage}` : acc;
    },
    [provider, model, settings, persist],
  );

  // --- drafts: unsent text, kept per chat ---------------------------------
  const draftKeyNow = draftKey(chat?.id);
  const draftKeyRef = useRef(draftKeyNow);
  draftKeyRef.current = draftKeyNow;

  /** localStorage can be absent or throw (private windows); drafts are a convenience, never a dependency. */
  const draftStore = () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  /** Every change to the composer text goes through here, so it is saved as it is typed. */
  const updateInput = useCallback((value: string) => {
    setInput(value);
    const store = draftStore();
    if (store) saveDraft(store, draftKeyRef.current, value);
  }, []);

  // Coming to a chat, its draft comes back.
  useEffect(() => {
    const store = draftStore();
    setInput(store ? loadDraft(store, draftKeyNow) : "");
  }, [draftKeyNow]);

  // --- slash commands ------------------------------------------------------
  function runSlash(match: SlashMatch) {
    // Text commands and saved prompts fill the box; you read it, then send it.
    if (match.kind !== "action") {
      const text = match.text ?? "";
      // A prompt with {{blanks}} asks for them first; {{date}} and {{time}} fill themselves.
      if (promptVariables(text).length > 0) {
        updateInput("");
        return setFillingPrompt({ name: match.name, text, args: match.args });
      }
      const filled = fillVariables(text, {});
      updateInput(match.args ? `${filled}\n\n${match.args}` : filled);
      return;
    }
    updateInput("");
    const needsChat = ["pin", "archive", "export", "instructions", "title", "tag", "undo"];
    if (needsChat.includes(match.name) && !chat) return setNotice("Open a chat first.");

    switch (match.name) {
      case "new":
        return newChat();
      case "pin":
        return void togglePin(chat!.id, !chats.find((c) => c.id === chat!.id)?.pinned);
      case "archive":
        return void archiveChat(chat!.id, true);
      case "export": {
        const a = document.createElement("a");
        a.href = `/api/chats/${chat!.id}/export`;
        a.click();
        return;
      }
      case "instructions":
        return void editInstructions(chat!.id);
      case "help":
        return setShortcutsOpen(true);
      case "model": {
        const wanted = match.args.trim();
        const current = providers.find((p) => p.id === provider);
        if (!wanted) return setNotice(`You're using ${model || "no model"}${current ? ` · ${current.label}` : ""}. To switch, type /model and part of a name.`);
        const found = findModel(wanted, providers);
        if (!found) return setNotice(`No ready model matches “${wanted}”. The model picker lists what is available.`);
        changeModel(found.choice.provider, found.choice.model);
        return setNotice(`Switched to ${found.choice.label}.${found.others.length ? ` Also matched: ${found.others.map((o) => o.model).join(", ")}.` : ""}`);
      }
      case "title": {
        const title = match.args.trim().slice(0, 120);
        if (!title) return setNotice("Say what to call it: /title Planning the trip");
        void renameChat(chat!.id, title);
        return setNotice(`Renamed to “${title}”.`);
      }
      case "tag": {
        const existing = chats.find((c) => c.id === chat!.id)?.tags ?? chat!.tags ?? [];
        if (!match.args.trim()) return setNotice(existing.length ? `Tagged ${existing.map((t) => `#${t}`).join(" ")}. Add with /tag name, remove with /tag -name.` : "No tags yet. Add one with /tag name.");
        const result = applyTagCommand(existing, match.args);
        const parts = [
          result.added.length ? `Added ${result.added.map((t) => `#${t}`).join(" ")}` : "",
          result.removed.length ? `removed ${result.removed.map((t) => `#${t}`).join(" ")}` : "",
          result.invalid.length ? `couldn't use ${result.invalid.join(" ")}` : "",
        ].filter(Boolean);
        if (result.added.length || result.removed.length) void setChatTags(chat!.id, result.tags);
        const sentence = parts.length ? parts.join("; ") : "Nothing to change";
        return setNotice(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
      }
      case "undo": {
        if (streaming) return setNotice("Wait for the reply to finish, or stop it first.");
        const undone = undoLastExchange(chat!.messages);
        if (!undone) return setNotice("You haven't sent anything in this chat.");
        const next = { ...chat!, messages: undone.messages, updatedAt: Date.now() };
        setChat(next);
        void persist(next);
        // A slash command is the whole message, so the box held nothing else to keep.
        fillComposer(undone.text);
        return setNotice(
          `Took back your last message${undone.removed > 1 ? ` and ${undone.removed - 1} repl${undone.removed - 1 === 1 ? "y" : "ies"}` : ""}. It is in the message box${undone.hadAttachments ? " — its attachments aren't kept, so add them again" : ""}.`,
        );
      }
      case "theme": {
        const { theme } = getAppearance();
        return setAppearance({ theme: THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] });
      }
    }
  }

  async function send(task = false) {
    const text = input.trim();
    if ((!text && pending.length === 0) || streaming) return;

    // "/new", "/summarize", "/review": a command, not a message. Anything else
    // that starts with a slash — a file path, say — is sent as written.
    const slash = pending.length === 0 ? parseSlash(text, settings.prompts ?? []) : null;
    if (slash) return runSlash(slash);

    // Cleared before anything is awaited: a new chat takes a moment to create,
    // and whatever is typed in that moment is the next message, not this one.
    const attachments = pending;
    updateInput("");
    setPending([]);

    let target = chat;
    if (!target) {
      target = await createChat();
      if (!target) {
        // Nothing was sent, so nothing should be lost.
        updateInput(text);
        setPending(attachments);
        return;
      }
    }

    const userMessage: Message = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const history = [...target.messages, userMessage];
    const titled: Chat =
      target.title === "New chat" || target.messages.length === 0
        ? { ...target, title: deriveTitle(text || attachments[0]?.name || "Attachment") }
        : target;

    noticeUserMessage(text);
    await runTurn(titled, history, undefined, task);
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  /**
   * A spoken question goes through the same runTurn as a typed one, so voice
   * conversations save to the same chats and can use tools.
   */
  const askByVoice = useCallback(
    async (text: string, onToken?: (soFar: string) => void): Promise<string> => {
      let target = chat;
      if (!target) {
        target = await createChat();
        if (!target) return "I could not start a chat.";
      }

      const userMessage: Message = {
        id: newId(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };

      const history = [...target.messages, userMessage];
      const titled: Chat =
        target.title === "New chat" || target.messages.length === 0
          ? { ...target, title: deriveTitle(text) }
          : target;

      noticeUserMessage(text);
      return runTurn(titled, history, onToken);
    },
    [chat, createChat, runTurn],
  );

  /**
   * These three are memoised for rendering cost, not tidiness.
   *
   * Each is handed to every Message in the conversation. As plain function
   * declarations they were new references on every Workspace render, which
   * defeated memoisation the whole way down and re-ran react-markdown —
   * syntax highlighting included — for every message on every keystroke.
   */

  /** Drop the last assistant turn and ask again. */
  const regenerate = useCallback(
    async (messageId: string) => {
      if (!chat || streaming) return;
      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index < 1) return;
      // Asking again says the first answer wasn't it.
      moodEvent("regenerated");
      await runTurn(chat, chat.messages.slice(0, index));
    },
    [chat, streaming, runTurn],
  );

  /**
   * Drop this reply and ask again with a different model. The chosen model
   * becomes the one selected, too — you have just decided to hear from it, and
   * the next message going to a model you moved away from would be a surprise.
   */
  const regenerateWith = useCallback(
    async (messageId: string, nextProvider: string, nextModel: string) => {
      if (!chat || streaming) return;
      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index < 1) return;
      moodEvent("regenerated");
      setProvider(nextProvider);
      setModel(nextModel);
      try {
        localStorage.setItem(SELECTION_KEY, JSON.stringify({ provider: nextProvider, model: nextModel }));
      } catch {
        /* ignore */
      }
      await runTurn(chat, chat.messages.slice(0, index), undefined, false, { provider: nextProvider, model: nextModel });
    },
    [chat, streaming, runTurn],
  );

  const toggleFavoriteModel = useCallback(
    (nextProvider: string, nextModel: string) =>
      saveSettings({
        ...settings,
        favorites: toggleFavorite(settings.favorites ?? [], favoriteKey(nextProvider, nextModel)),
      }),
    [settings, saveSettings],
  );

  /** Kept stable between provider fetches and star changes: every message reads it. */
  const modelsValue = useMemo<ModelsContextValue>(
    () => ({
      providers,
      favorites: settings.favorites ?? [],
      onToggleFavorite: toggleFavoriteModel,
      onRegenerateWith: regenerateWith,
      onOpenSettings: () => setSettingsOpen(true),
    }),
    [providers, settings.favorites, toggleFavoriteModel, regenerateWith],
  );

  /** How full the next request will be — the conversation, what you are typing, and what every request carries. */
  const contextInfo = useMemo(() => {
    const current = providers.find((p) => p.id === provider);
    if (!current || !chat) return null;
    const draft = input.trim() || pending.length > 0 ? [{ content: input, attachments: pending }] : [];
    return measureContext({
      messages: [...chat.messages, ...draft],
      persona: chat.persona?.trim() ? chat.persona : settings.persona,
      limit: contextCeiling(current, settings.budgets?.[current.id]),
      toolTokens: overhead.toolTokens,
      noteTokens: overhead.noteTokens,
      useTools: settings.useTools,
    });
  }, [providers, provider, chat, input, pending, settings.persona, settings.budgets, settings.useTools, overhead]);

  /** Rewrite a user turn and discard everything that followed it. */
  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!chat || streaming) return;
      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index === -1) return;
      const history = [
        ...chat.messages.slice(0, index),
        { ...chat.messages[index], content },
      ];
      noticeUserMessage(content);
      await runTurn(chat, history);
    },
    [chat, streaming, runTurn],
  );

  // Stable references, like the handlers above: each Message is memoised, and a
  // handler that changed on every keystroke would re-render and re-highlight
  // the whole conversation again.
  const branchFrom = useCallback(
    (messageId: string) => {
      if (chat) void copyChat(chat.id, messageId);
    },
    [chat, copyChat],
  );

  /** Save or unsave a message. Quiet: a star isn't activity, so the chat keeps its place in the list. */
  const toggleStar = useCallback(
    async (messageId: string) => {
      if (!chat || streaming) return;
      const messages = chat.messages.map((m) =>
        m.id === messageId ? { ...m, starred: m.starred ? undefined : true } : m,
      );
      setChat({ ...chat, messages });
      await fetch(`/api/chats/${chat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, quiet: true }),
      }).catch(() => setNotice("That didn't save."));
    },
    [chat, streaming],
  );

  /**
   * Rate a reply. Quiet like a star — it isn't conversation, so the chat keeps its
   * place in the list — and it moves the mood only when a rating is given, not
   * when one is taken back.
   */
  const reactTo = useCallback(
    async (messageId: string, reaction: "up" | "down") => {
      if (!chat || streaming) return;
      const current = chat.messages.find((m) => m.id === messageId)?.reaction;
      const next = current === reaction ? undefined : reaction;
      const messages = chat.messages.map((m) => (m.id === messageId ? { ...m, reaction: next } : m));
      setChat({ ...chat, messages });
      if (next) moodEvent(next === "up" ? "thumbs-up" : "thumbs-down");
      await fetch(`/api/chats/${chat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, quiet: true }),
      }).catch(() => setNotice("That didn't save."));
    },
    [chat, streaming],
  );

  /** What is in the box now, for handlers that must not be remade on every keystroke. */
  const inputRef = useRef(input);
  inputRef.current = input;

  /** Start your next message with this one quoted. */
  const quote = useCallback(
    (messageId: string) => {
      const message = chat?.messages.find((m) => m.id === messageId);
      if (!message) return;
      const text = appendQuote(inputRef.current, quoteText(message.content));
      if (!text) return;
      updateInput(text);
      setTimeout(() => {
        const box = document.getElementById("message-input") as HTMLTextAreaElement | null;
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }, 0);
    },
    [chat, updateInput],
  );

  /** A saved message to scroll to once its chat has loaded. */
  const pendingScroll = useRef<string | null>(null);

  const openSaved = useCallback(
    async (chatId: string, messageId: string) => {
      pendingScroll.current = messageId;
      await selectChat(chatId);
    },
    [selectChat],
  );

  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || !chat) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    pendingScroll.current = null;
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1800);
  }, [chat]);

  const speakerRef = useRef<Speaker | null>(null);
  const speakingRef = useRef<string | null>(null);

  const stopSpeaking = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    speakingRef.current = null;
    setSpeakingId(null);
  }, []);

  /** Read a reply aloud with the voice from Settings; pressing it again stops. */
  const speak = useCallback(
    (messageId: string) => {
      const wasSpeaking = speakingRef.current === messageId;
      stopSpeaking();
      if (wasSpeaking) return;

      const message = chat?.messages.find((m) => m.id === messageId);
      const text = message ? forSpeech(message.content) : "";
      if (!text) return setNotice("There's nothing in that reply to read aloud.");

      const speaker = new Speaker(
        getTts(settings.ttsEngine),
        { voice: settings.ttsVoice, rate: settings.ttsSpeed },
        (reason) => setNotice(`Speech failed: ${reason}`),
      );
      speakerRef.current = speaker;
      speakingRef.current = messageId;
      setSpeakingId(messageId);
      speaker.push(text);
      speaker.end();
      void speaker.wait().finally(() => {
        // Only if this is still the current reading — not one that replaced it.
        if (speakerRef.current === speaker) stopSpeaking();
      });
    },
    [chat, settings.ttsEngine, settings.ttsVoice, settings.ttsSpeed, stopSpeaking],
  );

  // Reading a reply aloud belongs to the chat it came from.
  useEffect(() => stopSpeaking, [chat?.id, stopSpeaking]);

  const openInCanvas = useCallback((messageId: string, blockIndex: number) => {
    setActiveArtifactId(`${messageId}-${blockIndex}`);
    setCanvasOpen(true);
  }, []);

  function changeModel(nextProvider: string, nextModel: string) {
    setProvider(nextProvider);
    setModel(nextModel);
    try {
      localStorage.setItem(
        SELECTION_KEY,
        JSON.stringify({ provider: nextProvider, model: nextModel }),
      );
    } catch {
      /* ignore */
    }
  }

  // --- Canvas resize -------------------------------------------------------

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const pct = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
      setCanvasWidth(Math.min(70, Math.max(25, pct)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(CANVAS_WIDTH_KEY, String(canvasWidth));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [canvasWidth]);

  // --- Shortcuts -----------------------------------------------------------

  /**
   * Put the cursor in the chat search. On a narrow screen the list is a drawer,
   * so open it first; the box exists once it has rendered.
   */
  const focusChatSearch = useCallback(() => {
    const visible = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-chat-search]")].find((el) => el.offsetParent);
    const box = visible();
    if (box) box.focus();
    else {
      setSidebarOpen(true);
      setTimeout(() => visible()?.focus(), 0);
    }
  }, []);

  /** The quick actions on the welcome screen — each is also reachable some other way. */
  const quickAction = useCallback(
    (id: QuickActionId) => {
      if (id === "search") return focusChatSearch();
      if (id === "voice") {
        setPushToTalk(false);
        return setVoiceOpen(true);
      }
      if (id === "pictures") return setGalleryOpen(true);
      if (id === "saved") return setSavedOpen(true);
      return setShortcutsOpen(true);
    },
    [focusChatSearch],
  );

  const recent = useMemo(() => recentChats(chats), [chats]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newChat();
      }
      // Cmd/Ctrl+/ searches every chat.
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        focusChatSearch();
      }
      // "?" lists the shortcuts — unless you are typing, where it is a question mark.
      if (isHelpKey(e) && !isTypingTarget(e.target as HTMLElement | null)) {
        e.preventDefault();
        setShortcutsOpen((open) => !open);
      }
      if (e.key === "Escape" && canvasOpen) setCanvasOpen(false);
      // Cmd/Ctrl+J drops straight into voice mode.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPushToTalk(false);
        setVoiceOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canvasOpen]);

  const showCanvas = canvasOpen;

  /** Put text in the message box and put the cursor after it. Nothing is sent. */
  function fillComposer(text: string) {
    updateInput(text);
    setTimeout(() => {
      const box = document.getElementById("message-input") as HTMLTextAreaElement | null;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }, 0);
  }

  /**
   * What a card's button does. Every one is something you could do yourself —
   * fill the message box, move to a chat, pick a model, save a note — and none
   * sends anything on your behalf.
   */
  function runNudgeAction(_nudge: Nudge, action: NudgeAction) {
    if (action.kind !== "open-inbox") setInboxOpen(false);
    switch (action.kind) {
      case "fill":
        return fillComposer(action.text);
      case "new-chat":
        return newChat();
      case "open-chat":
        // Already in it (the last chat opens by itself): a recap is the useful thing to offer.
        return action.chatId === chat?.id ? fillComposer(RECAP_PROMPT) : void selectChat(action.chatId);
      case "switch-model":
        changeModel(action.provider, action.model);
        return setNotice(`Switched to ${action.model}. Your next message goes there.`);
      case "remember":
        return void (async () => {
          try {
            const res = await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: action.text, tags: action.always ? ["always"] : [], dedupe: true }),
            });
            const data = await res.json().catch(() => ({}));
            setNotice(
              !res.ok
                ? (data.error ?? "That didn't save.")
                : data.duplicate
                  ? "Already in memory."
                  : action.always
                    ? "Remembered — and kept in mind in every chat."
                    : "Remembered. Change or remove it under Settings → Memory.",
            );
          } catch {
            setNotice("Couldn't reach the server.");
          }
        })();
      case "show-approval": {
        const card = document.querySelector<HTMLElement>("[data-approval]");
        if (!card) return setNotice("That question has already been answered.");
        card.scrollIntoView({ block: "center" });
        return card.focus();
      }
      case "open-inbox":
        return setInboxOpen(true);
    }
  }

  function onRuleMuted(rule: RuleId, learned: boolean) {
    setNotice(
      learned
        ? `Won't suggest “${RULE_INFO[rule].label}” any more — you waved it away three times. Settings → Initiative turns it back on.`
        : `Won't suggest “${RULE_INFO[rule].label}” any more. Settings → Initiative turns it back on.`,
    );
  }

  const lastChat = useMemo(() => {
    const latest = mostRecent(chats.filter((c) => !c.archived));
    return latest ? { id: latest.id, title: latest.title } : null;
  }, [chats]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden" data-print-flow>
      {/* First stop for Tab: past the chat list and the header, straight to typing. */}
      <a
        href="#message-input"
        data-skip-link
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-arc-solid focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
      >
        Skip to the message box
      </a>
      <ConnectionBanner />
      {selfEdit?.isSandbox && (
        <div
          className="flex items-center gap-2 border-b border-warn/40 bg-warn/15 px-3 py-1.5 text-[11.5px] text-warn"
          data-sandbox-banner
        >
          <FlaskConical size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>Sandbox</strong> — a test copy of JARVIS. Changes here don&apos;t touch the real one, and its
            chats are its own.
          </span>
        </div>
      )}
      {security?.exposedWithComputerAccess && (
        <div className="flex items-center gap-2 border-b border-danger/40 bg-danger/15 px-3 py-1.5 text-[11.5px] text-danger">
          <ShieldAlert size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            This JARVIS is reachable from outside this machine <strong>and</strong> has
            filesystem and shell access enabled. Anyone with the password can run
            commands here.
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden" data-print-flow>
      {/* Sidebar: fixed column on desktop, overlay drawer on small screens. */}
      <div className="hidden shrink-0 lg:block" style={{ width: "var(--sidebar-w, 260px)" }}>
        <Sidebar
          edge={<SidebarResizer />}
          chats={chats}
          activeId={chat?.id ?? null}
          onSelect={selectChat}
          onNew={newChat}
          onDelete={deleteChat}
          onRename={renameChat}
          onTogglePin={togglePin}
          onArchive={archiveChat}
          onTags={setChatTags}
          onBulk={bulkChats}
          onDuplicate={(id) => void copyChat(id)}
          onEditInstructions={editInstructions}
          onOpenTrash={() => setTrashOpen(true)}
          onOpenSaved={() => setSavedOpen(true)}
          onRestoreFile={restoreBackupFile}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGallery={() => setGalleryOpen(true)}
          onOpenUsage={() => setUsageOpen(true)}
          onOpenSandbox={selfEdit?.enabled ? () => setSandboxOpen(true) : undefined}
          storageDriver={storage}
        />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[80vw] max-w-[300px]">
            <Sidebar
              chats={chats}
              activeId={chat?.id ?? null}
              onSelect={selectChat}
              onNew={newChat}
              onDelete={deleteChat}
              onRename={renameChat}
              onTogglePin={togglePin}
              onArchive={archiveChat}
              onTags={setChatTags}
              onBulk={bulkChats}
              onDuplicate={(id) => void copyChat(id)}
              onEditInstructions={editInstructions}
              onOpenTrash={() => {
                setSidebarOpen(false);
                setTrashOpen(true);
              }}
              onOpenSaved={() => {
                setSidebarOpen(false);
                setSavedOpen(true);
              }}
              onRestoreFile={restoreBackupFile}
              onOpenSettings={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
              onOpenGallery={() => {
                setSidebarOpen(false);
                setGalleryOpen(true);
              }}
              onOpenUsage={() => {
                setSidebarOpen(false);
                setUsageOpen(true);
              }}
              onOpenSandbox={
                selfEdit?.enabled
                  ? () => {
                      setSidebarOpen(false);
                      setSandboxOpen(true);
                    }
                  : undefined
              }
              storageDriver={storage}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1" data-print-flow>
        <div
          className="min-w-0 flex-1"
          data-print-flow
          style={showCanvas ? { width: `${100 - canvasWidth}%` } : undefined}
        >
          <ModelsContext.Provider value={modelsValue}>
          <ChatPane
            chat={chat}
            streaming={streaming}
            streamingMessageId={streamingId}
            input={input}
            onInputChange={updateInput}
            onSlash={runSlash}
            onSend={send}
            onStop={stop}
            onRegenerate={regenerate}
            onEditMessage={editMessage}
            onOpenInCanvas={openInCanvas}
            onBranch={branchFrom}
            onStar={toggleStar}
            onSpeak={speak}
            speakingId={speakingId}
            prompts={settings.prompts ?? []}
            onEditInstructions={() => chat && void editInstructions(chat.id)}
            providers={providers}
            provider={provider}
            model={model}
            onModelChange={changeModel}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleCanvas={() => setCanvasOpen((v) => !v)}
            canvasOpen={canvasOpen}
            artifactCount={artifacts.length}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            approvals={approvals}
            onApprovalSettled={(id) => setApprovals((prev) => prev.filter((a) => a.id !== id))}
            attachments={pending}
            onAttach={(added) => setPending((prev) => [...prev, ...added])}
            onRemoveAttachment={(id) => setPending((prev) => prev.filter((a) => a.id !== id))}
            onAttachError={setNotice}
            onStartVoice={(talk) => {
              setPushToTalk(talk);
              setVoiceOpen(true);
            }}
            context={contextInfo}
            favorites={settings.favorites ?? []}
            onToggleFavorite={toggleFavoriteModel}
            recent={recent}
            onOpenChat={selectChat}
            onQuickAction={quickAction}
            onReact={reactTo}
            temperature={settings.temperature}
            onTemperature={(temperature) => saveSettings({ ...settings, temperature })}
            onQuote={quote}
            onOpenInbox={() => setInboxOpen(true)}
          />
          </ModelsContext.Provider>
        </div>

        {showCanvas && (
          <>
            <div
              onMouseDown={() => {
                draggingRef.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              data-no-print
              className="hidden w-1 shrink-0 cursor-col-resize bg-line transition hover:bg-arc-solid md:block"
              title="Drag to resize"
            />
            {/* One instance only — a second copy would run a second preview
                iframe of the same code. Full-screen on phones, a sized panel
                from md up. */}
            <div
              data-no-print
              className="fixed inset-0 z-30 md:relative md:inset-auto md:z-auto md:shrink-0 md:[width:var(--canvas-w)]"
              style={{ "--canvas-w": `${canvasWidth}vw` } as React.CSSProperties}
            >
              <CodeCanvas
                artifacts={artifacts}
                activeId={activeArtifactId}
                onSelect={setActiveArtifactId}
                onClose={() => setCanvasOpen(false)}
              />
            </div>
          </>
        )}
      </main>

      <VoiceMode
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onQuestion={askByVoice}
        greeting={settings.greeting}
        ttsEngine={settings.ttsEngine}
        ttsVoice={settings.ttsVoice}
        ttsSpeed={settings.ttsSpeed}
        threshold={settings.wakeThreshold}
        apiKey={settings.keys.groq}
        pushToTalk={pushToTalk}
        onThresholdChange={(value) => saveSettings({ ...settings, wakeThreshold: value })}
      />

      </div>

      <UsagePanel open={usageOpen} onClose={() => setUsageOpen(false)} />

      <SavedPanel
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        onOpen={(chatId, messageId) => {
          setSavedOpen(false);
          void openSaved(chatId, messageId);
        }}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} onRestored={() => void refreshChats()} />

      <ChatInstructions
        open={instructionsFor !== null}
        title={instructionsFor?.title ?? ""}
        value={instructionsFor?.persona}
        onSave={(text) => void saveInstructions(text)}
        onClose={() => setInstructionsFor(null)}
      />

      <SandboxPanel open={sandboxOpen} onClose={() => setSandboxOpen(false)} />

      <PromptVariables
        prompt={fillingPrompt}
        onClose={() => setFillingPrompt(null)}
        onSubmit={(filled) => {
          const args = fillingPrompt?.args ?? "";
          setFillingPrompt(null);
          fillComposer(args ? `${filled}\n\n${args}` : filled);
        }}
      />

      <InboxPanel
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        onAction={runNudgeAction}
        onOpenSettings={() => {
          setInboxOpen(false);
          setSettingsOpen(true);
        }}
      />

      <InitiativeHost
        chatId={chat?.id ?? null}
        messages={chat?.messages ?? []}
        providers={providers}
        provider={provider}
        model={model}
        favorites={settings.favorites ?? []}
        contextRatio={contextInfo?.ratio ?? null}
        streaming={streaming}
        voiceOpen={voiceOpen}
        approvalCount={approvals.length}
        lastChat={lastChat}
        onAction={runNudgeAction}
        onMuted={onRuleMuted}
      />

      <Gallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onEdit={(url) => {
          setGalleryOpen(false);
          updateInput(`Edit the picture ${url} — `);
          // After the dialog unmounts and the draft renders, so focus isn't
          // stolen back and the cursor lands after the text, not before it.
          setTimeout(() => {
            const box = document.querySelector<HTMLTextAreaElement>("main textarea");
            if (!box) return;
            box.focus();
            box.setSelectionRange(box.value.length, box.value.length);
          }, 0);
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        providers={providers}
        storageDriver={storage}
        onSave={saveSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
