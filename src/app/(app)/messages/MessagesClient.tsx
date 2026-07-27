"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import CreateGroupModal from "./CreateGroupModal";
import NewDirectMessageModal from "./NewDirectMessageModal";

const CONVERSATIONS_POLL_MS = 30000;
const MESSAGES_POLL_MS = 10000;
const MESSAGE_PAGE_SIZE = 50;

type MemberUser = { id: string; name: string; email: string; role: string };

type ConversationSummary = {
  id: string;
  type: "DIRECT" | "GROUP" | "COMPANY";
  name: string | null;
  relatedShipment: { id: string; shipmentCode: string; goodsName: string | null } | null;
  members: { user: MemberUser }[];
  messages: { id: string; content: string | null; createdAt: string; sender: MemberUser }[];
  unreadCount: number;
  updatedAt: string;
};

type Attachment = { id: string; fileUrl: string; fileName: string; fileType: string; fileSize: number };
type PendingAttachment = { fileUrl: string; fileName: string; fileType: string; fileSize: number };
type Message = {
  id: string;
  content: string | null;
  senderId: string;
  sender: MemberUser;
  attachments: Attachment[];
  mentions: { mentionedUser: MemberUser }[];
  createdAt: string;
};

function conversationDisplayName(conversation: ConversationSummary, currentUserId: string): string {
  if (conversation.type !== "DIRECT") return conversation.name || "Cuộc trò chuyện";
  const other = conversation.members.find((m) => m.user.id !== currentUserId)?.user;
  return other?.name || "Cuộc trò chuyện";
}

function renderContentWithMentions(content: string, mentions: { mentionedUser: MemberUser }[]) {
  if (mentions.length === 0) return content;
  const names = mentions.map((m) => m.mentionedUser.name).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  const parts = content.split(pattern);
  return parts.map((part, i) =>
    names.some((n) => part === `@${n}`) ? (
      <span key={i} className="rounded bg-blue-100 px-1 font-medium text-blue-700">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const timeDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDifference || a.id.localeCompare(b.id);
  });
}

export default function MessagesClient({ currentUserId }: { currentUserId: string }) {
  const searchParams = useSearchParams();
  const initialConversationId = searchParams.get("conversationId");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showNewDirectModal, setShowNewDirectModal] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasLoadedOlderRef = useRef(false);
  const shouldScrollToBottomRef = useRef(false);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    function loadConversations() {
      fetch("/api/conversations")
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setConversations(json.data);
        })
        .catch(() => {});
    }
    loadConversations();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadConversations();
    };
    const interval = setInterval(refreshWhenVisible, CONVERSATIONS_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;

    let cancelled = false;
    hasLoadedOlderRef.current = false;

    function loadMessages(isFirstLoad: boolean) {
      if (isFirstLoad) setIsLoadingMessages(true);
      fetch(`/api/conversations/${activeId}/messages?limit=${MESSAGE_PAGE_SIZE}`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelled || !json.success) return;
          shouldScrollToBottomRef.current = isFirstLoad || !hasLoadedOlderRef.current;
          if (isFirstLoad) {
            setMessages(json.data.items);
            setNextCursor(json.data.nextCursor);
          } else {
            setMessages((current) => mergeMessages(current, json.data.items));
            if (!hasLoadedOlderRef.current) setNextCursor(json.data.nextCursor);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isFirstLoad && !cancelled) setIsLoadingMessages(false);
        });
    }

    loadMessages(true);
    fetch(`/api/conversations/${activeId}/read`, { method: "POST" }).catch(() => {});

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadMessages(false);
    };
    const interval = setInterval(refreshWhenVisible, MESSAGES_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeId]);

  useEffect(() => {
    if (!shouldScrollToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    shouldScrollToBottomRef.current = false;
  }, [messages]);

  const mentionQuery = useMemo(() => {
    const match = messageText.match(/@(\S*)$/);
    return match ? match[1] : null;
  }, [messageText]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null || !activeConversation) return [];
    const query = mentionQuery.toLowerCase();
    return activeConversation.members
      .map((m) => m.user)
      .filter((u) => u.id !== currentUserId && u.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mentionQuery, activeConversation, currentUserId]);

  function selectConversation(id: string) {
    setActiveId(id);
    setMessages([]);
    setNextCursor(null);
    hasLoadedOlderRef.current = false;
    setMessageText("");
    setPendingAttachments([]);
    setMentionedUserIds([]);
  }

  async function loadOlderMessages() {
    if (!activeId || !nextCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const params = new URLSearchParams({
        limit: String(MESSAGE_PAGE_SIZE),
        before: nextCursor,
      });
      const response = await fetch(`/api/conversations/${activeId}/messages?${params}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải tin nhắn cũ.");
      hasLoadedOlderRef.current = true;
      shouldScrollToBottomRef.current = false;
      setMessages((current) => mergeMessages(json.data.items, current));
      setNextCursor(json.data.nextCursor);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Không thể tải tin nhắn cũ.");
    } finally {
      setIsLoadingOlder(false);
    }
  }

  function handleSelectMention(u: MemberUser) {
    setMessageText((prev) => prev.replace(/@(\S*)$/, `@${u.name} `));
    setMentionedUserIds((prev) => [...new Set([...prev, u.id])]);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Tải file thất bại.");
      setPendingAttachments((prev) => [
        ...prev,
        { fileUrl: json.data.url, fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size },
      ]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!activeId) return;
    setSendError(null);

    const content = messageText.trim();
    if (!content && pendingAttachments.length === 0) return;

    try {
      const res = await fetch(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, attachments: pendingAttachments, mentionedUserIds }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể gửi tin nhắn.");
      shouldScrollToBottomRef.current = true;
      setMessages((prev) => [...prev, json.data]);
      setMessageText("");
      setPendingAttachments([]);
      setMentionedUserIds([]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex h-screen">
      <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Tin nhắn</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewDirectModal(true)}
              className="rounded-md border border-blue-600 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              + Nhắn riêng
            </button>
            <button
              type="button"
              onClick={() => setShowCreateGroupModal(true)}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              + Tạo nhóm
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sortedConversations.length === 0 && (
            <p className="p-4 text-center text-sm text-gray-400">Chưa có cuộc trò chuyện nào.</p>
          )}
          {sortedConversations.map((c) => {
            const lastMessage = c.messages[0];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectConversation(c.id)}
                className={`block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                  activeId === c.id ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {conversationDisplayName(c, currentUserId)}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                      {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    </span>
                  )}
                </div>
                {c.relatedShipment && (
                  <p className="truncate text-xs text-gray-400">
                    Lô hàng: {c.relatedShipment.goodsName || c.relatedShipment.shipmentCode}
                  </p>
                )}
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {lastMessage
                    ? `${lastMessage.sender.id === currentUserId ? "Bạn" : lastMessage.sender.name}: ${
                        lastMessage.content || "[Tệp đính kèm]"
                      }`
                    : "Chưa có tin nhắn nào."}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col bg-gray-50">
        {!activeConversation ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Chọn một cuộc trò chuyện để bắt đầu.
          </div>
        ) : (
          <>
            <div className="border-b border-gray-200 bg-white px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {conversationDisplayName(activeConversation, currentUserId)}
              </h3>
              {activeConversation.type !== "DIRECT" && (
                <p className="text-xs text-gray-400">
                  {activeConversation.members.map((m) => m.user.name).join(", ")}
                </p>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {isLoadingMessages && <p className="text-center text-sm text-gray-400">Đang tải...</p>}
              {!isLoadingMessages && nextCursor && (
                <div className="text-center">
                  <button
                    type="button"
                    disabled={isLoadingOlder}
                    onClick={loadOlderMessages}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isLoadingOlder ? "Đang tải..." : "Tải tin nhắn cũ hơn"}
                  </button>
                </div>
              )}
              {messages.map((m) => {
                const isSelf = m.senderId === currentUserId;
                return (
                  <div key={m.id} className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                        isSelf ? "bg-blue-600 text-white" : "bg-white text-gray-900 shadow-sm"
                      }`}
                    >
                      {!isSelf && <p className="mb-0.5 text-xs font-medium text-gray-500">{m.sender.name}</p>}
                      {m.content && <p>{renderContentWithMentions(m.content, m.mentions)}</p>}
                      {m.attachments.map((att) =>
                        att.fileType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={att.id}
                            src={att.fileUrl}
                            alt={att.fileName}
                            className="mt-1 max-h-48 rounded-md object-contain"
                          />
                        ) : (
                          <a
                            key={att.id}
                            href={att.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={`mt-1 block text-xs underline ${isSelf ? "text-blue-100" : "text-blue-600"}`}
                          >
                            📎 {att.fileName}
                          </a>
                        )
                      )}
                      <p className={`mt-1 text-[10px] ${isSelf ? "text-blue-100" : "text-gray-400"}`}>
                        {new Date(m.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="border-t border-gray-200 bg-white px-5 py-3">
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((att, i) => (
                    <span key={i} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
                      📎 {att.fileName}
                    </span>
                  ))}
                </div>
              )}
              <div className="relative flex items-end gap-2">
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  rows={1}
                  className="input flex-1 resize-none"
                  placeholder="Nhập tin nhắn... (gõ @ để nhắc tên)"
                />
                {mentionSuggestions.length > 0 && (
                  <ul className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-gray-200 bg-white shadow-lg">
                    {mentionSuggestions.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectMention(u)}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          {u.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isUploading ? "..." : "📎"}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Gửi
                </button>
              </div>
              {sendError && <p className="mt-1 text-xs text-red-600">{sendError}</p>}
            </form>
          </>
        )}
      </div>

      {showCreateGroupModal && (
        <CreateGroupModal
          onClose={() => setShowCreateGroupModal(false)}
          onCreated={(conversationId) => {
            setShowCreateGroupModal(false);
            fetch("/api/conversations")
              .then((res) => res.json())
              .then((json) => {
                if (json.success) setConversations(json.data);
                selectConversation(conversationId);
              })
              .catch(() => {});
          }}
        />
      )}

      {showNewDirectModal && (
        <NewDirectMessageModal
          currentUserId={currentUserId}
          onClose={() => setShowNewDirectModal(false)}
          onCreated={(conversationId) => {
            setShowNewDirectModal(false);
            fetch("/api/conversations")
              .then((res) => res.json())
              .then((json) => {
                if (json.success) setConversations(json.data);
                selectConversation(conversationId);
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
