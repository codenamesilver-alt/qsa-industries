"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchKB, type KBEntry } from "../lib/chatbot-kb";

type Msg = { role: "user" | "bot"; text: string; entry?: KBEntry };

export function ChatbotWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "Hi! I'm your ERP assistant. Ask me how to do something (e.g. 'how to add a product' or 'where to record an expense') and I'll guide you." },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  function send(q: string) {
    const query = q.trim();
    if (!query) return;
    const entry = searchKB(query);
    const userMsg: Msg = { role: "user", text: query };
    const botMsg: Msg = entry
      ? { role: "bot", text: entry.answer, entry }
      : { role: "bot", text: "I'm not sure about that. Try asking about products, dealers, orders, invoices, expenses, production, stock, or type 'help' for a list of topics." };
    setMsgs((m) => [...m, userMsg, botMsg]);
    setInput("");
  }

  function go(entry: KBEntry) {
    if (entry.route) {
      const url = entry.open ? `${entry.route}?open=${entry.open}` : entry.route;
      router.push(url);
      setOpen(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        aria-label="Open ERP assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#baff48] text-[#25311f] shadow-[6px_6px_16px_#d9dcd5,-4px_-4px_12px_#ffffff] transition hover:scale-105"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <svg height="24" viewBox="0 0 24 24" width="24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open ? (
        <div className="fixed bottom-24 right-6 z-50 flex h-[460px] w-[360px] flex-col overflow-hidden rounded-[1.5rem] border border-[#dfe6dc] bg-white shadow-[12px_12px_32px_#d9dcd5,-8px_-8px_20px_#ffffff]">
          <div className="flex items-center justify-between bg-[#baff48] px-4 py-3">
            <span className="text-sm font-bold text-[#25311f]">ERP Assistant</span>
            <button className="text-[#25311f]" onClick={() => setOpen(false)} type="button">✕</button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4" ref={scrollRef}>
            {msgs.map((m, i) => (
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} key={i}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-[#baff48] text-[#25311f]" : "bg-[#f5f7f2] text-[#27312d]"}`}>
                  <p>{m.text}</p>
                  {m.entry?.route ? (
                    <button
                      className="mt-2 rounded-full bg-[#15221b] px-3 py-1 text-xs font-bold text-[#d8f35b]"
                      onClick={() => go(m.entry!)}
                      type="button"
                    >
                      Go to {m.entry.title} →
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <form className="flex gap-2 border-t border-[#eef2ec] p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input
              className="flex-1 rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask how to do something…"
              value={input}
            />
            <button className="rounded-xl bg-[#15221b] px-3 py-2 text-xs font-bold text-[#d8f35b]" type="submit">Send</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
