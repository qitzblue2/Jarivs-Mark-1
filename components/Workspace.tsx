"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatPane from "./ChatPane";
import CodeCanvas from "./CodeCanvas";
import SettingsDialog, { DEFAULT_SETTINGS, type Settings } from "./SettingsDialog";
import VoiceMode from "./VoiceMode";
import type { PendingApproval } from "./ApprovalCard";
import { kokoroEngine } from "@/lib/voice/tts";
import type { ProviderState } from "./ModelPicker";
import { consumeJarvisStream } from "@/lib/stream";
import { artifactsFromMessage, artifactsFromMessages } from "@/lib/codeblocks";
import { newId, type Attachment, type Chat, type ChatMeta, type Message, type ToolRound } from "@/lib/types";
import { lighten } from "@/lib/attachments";

const SETTINGS_KEY = "jarvis.settings.v1";
const SELECTION_KEY = "jarvis.selection.v1";
const CANVAS_WIDTH_KEY = "jarvis.canvasWidth.v1";

/** Derive a chat title from the first thing the user said. */
function deriveTitle(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? "New chat";
  const clean = line.replace(/^[#>\-*\s]+/, "").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "New chat";
}

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

  // Open the most recent chat on first load.
  useEffect(() => {
    void (async () => {
      const list = await refreshChats();
      if (list.length > 0) void selectChat(list[0].id);
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
    setChat(null);
    setInput("");
    setActiveArtifactId(null);
    setSidebarOpen(false);
  }

  async function deleteChat(id: string) {
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    const list = await refreshChats();
    if (chat?.id === id) {
      if (list.length > 0) void selectChat(list[0].id);
      else setChat(null);
    }
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
    ): Promise<string> => {
      const assistantId = newId();
      const assistant: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        provider,
        model,
      };

      setChat({ ...target, messages: [...history, assistant] });
      setStreaming(true);
      setStreamingId(assistantId);

      const controller = new AbortController();
      abortRef.current = controller;

      let acc = "";
      let usedProvider = provider;
      let usedModel = model;
      let fellBackFrom: string | undefined;
      let errorMessage: string | undefined;
      let toolRounds: ToolRound[] = [];

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
            provider,
            model,
            temperature: settings.temperature,
            persona: settings.persona,
            useTools: settings.useTools,
            keys: settings.keys,
            endpoints: settings.endpoints ?? {},
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
            acc += event.value;
            onProgress?.(acc);
            paint();
          } else if (event.type === "tool_start") {
            // Show the call immediately; results fill in when the round ends.
            toolRounds = [...toolRounds, { round: event.round, calls: event.calls, results: [] }];
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

      // Returned so voice mode can speak the answer it just produced.
      return errorMessage ? `Sorry — ${errorMessage}` : acc;
    },
    [provider, model, settings, persist],
  );

  async function send() {
    const text = input.trim();
    if ((!text && pending.length === 0) || streaming) return;

    let target = chat;
    if (!target) {
      target = await createChat();
      if (!target) return;
    }

    const userMessage: Message = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      attachments: pending.length > 0 ? pending : undefined,
    };

    const history = [...target.messages, userMessage];
    const titled: Chat =
      target.title === "New chat" || target.messages.length === 0
        ? { ...target, title: deriveTitle(text || pending[0]?.name || "Attachment") }
        : target;

    setInput("");
    setPending([]);
    await runTurn(titled, history);
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

      return runTurn(titled, history, onToken);
    },
    [chat, createChat, runTurn],
  );

  /** Drop the last assistant turn and ask again. */
  async function regenerate(messageId: string) {
    if (!chat || streaming) return;
    const index = chat.messages.findIndex((m) => m.id === messageId);
    if (index < 1) return;
    await runTurn(chat, chat.messages.slice(0, index));
  }

  /** Rewrite a user turn and discard everything that followed it. */
  async function editMessage(messageId: string, content: string) {
    if (!chat || streaming) return;
    const index = chat.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const history = [
      ...chat.messages.slice(0, index),
      { ...chat.messages[index], content },
    ];
    await runTurn(chat, history);
  }

  function openInCanvas(messageId: string, blockIndex: number) {
    setActiveArtifactId(`${messageId}-${blockIndex}`);
    setCanvasOpen(true);
  }

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newChat();
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

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar: fixed column on desktop, overlay drawer on small screens. */}
      <div className="hidden w-[260px] shrink-0 lg:block">
        <Sidebar
          chats={chats}
          activeId={chat?.id ?? null}
          onSelect={selectChat}
          onNew={newChat}
          onDelete={deleteChat}
          onRename={renameChat}
          onOpenSettings={() => setSettingsOpen(true)}
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
              onOpenSettings={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
              storageDriver={storage}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1">
        <div
          className="min-w-0 flex-1"
          style={showCanvas ? { width: `${100 - canvasWidth}%` } : undefined}
        >
          <ChatPane
            chat={chat}
            streaming={streaming}
            streamingMessageId={streamingId}
            input={input}
            onInputChange={setInput}
            onSend={send}
            onStop={stop}
            onRegenerate={regenerate}
            onEditMessage={editMessage}
            onOpenInCanvas={openInCanvas}
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
          />
        </div>

        {showCanvas && (
          <>
            <div
              onMouseDown={() => {
                draggingRef.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              className="hidden w-1 shrink-0 cursor-col-resize bg-line transition hover:bg-arc-dim md:block"
              title="Drag to resize"
            />
            {/* One instance only — a second copy would run a second preview
                iframe of the same code. Full-screen on phones, a sized panel
                from md up. */}
            <div
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
