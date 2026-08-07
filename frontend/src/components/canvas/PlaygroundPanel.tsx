"use client";
import { useState, useRef, useEffect } from "react";
import { useFlowStore } from "@/stores/flowStore";
import { streamRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface PlaygroundPanelProps {
  onClose: () => void;
}

export function PlaygroundPanel({ onClose }: PlaygroundPanelProps) {
  const { persistFlow } = useFlowStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || running) return;

    await persistFlow();
    const currentId = useFlowStore.getState().flowId;

    if (!currentId) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Flow not saved yet. Please try again." },
      ]);
      return;
    }

    const userMsg = input.trim();
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: userMsg },
      { role: "assistant", content: "", streaming: true },
    ]);
    setRunning(true);

    stopRef.current = streamRun(
      currentId,
      userMsg,
      (token) => {
        setMessages((m) => {
          const last = m[m.length - 1];
          if (!last || last.role !== "assistant") return m;
          return [...m.slice(0, -1), { ...last, content: last.content + token }];
        });
      },
      () => {
        setMessages((m) => {
          const last = m[m.length - 1];
          if (!last) return m;
          return [...m.slice(0, -1), { ...last, streaming: false }];
        });
        setRunning(false);
        stopRef.current = null;
      },
      (err) => {
        setMessages((m) => {
          const last = m[m.length - 1];
          if (!last) return m;
          return [
            ...m.slice(0, -1),
            { ...last, content: `Error: ${err}`, streaming: false },
          ];
        });
        setRunning(false);
        stopRef.current = null;
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col w-96 border-l border-zinc-200 bg-white h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
        <span className="font-semibold text-sm text-zinc-800">Playground</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <p className="text-xs text-zinc-400 text-center mt-8">
            Send a message to run the flow.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
              msg.role === "user"
                ? "ml-auto bg-blue-500 text-white"
                : "bg-zinc-100 text-zinc-800"
            )}
          >
            {msg.content}
            {msg.streaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-zinc-400 animate-pulse rounded-sm" />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-zinc-100 shrink-0 space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something... (Enter to send)"
          className="text-sm resize-none min-h-[72px]"
          disabled={running}
        />
        <div className="flex justify-between items-center">
          {running && (
            <button
              onClick={() => { stopRef.current?.(); setRunning(false); }}
              className="text-xs text-red-500 hover:underline"
            >
              Stop
            </button>
          )}
          <Button
            onClick={send}
            disabled={running || !input.trim()}
            size="sm"
            className="ml-auto gap-1.5"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {running ? "Running…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
