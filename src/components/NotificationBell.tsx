"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  type: string;
  message: string;
  relatedTaskId: string | null;
  relatedShipmentId: string | null;
  relatedConversationId: string | null;
  isRead: boolean;
  createdAt: string;
};

const POLL_INTERVAL_MS = 60000;

export default function NotificationBell() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function load() {
      fetch("/api/notifications")
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) return;
          setNotifications(json.data.notifications);
          setUnreadCount(json.data.unreadCount);
        })
        .catch(() => {});
    }

    load();
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const interval = setInterval(loadWhenVisible, POLL_INTERVAL_MS);
    window.addEventListener("focus", loadWhenVisible);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", loadWhenVisible);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleNotificationClick(notification: Notification) {
    setIsOpen(false);
    if (!notification.isRead) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      fetch(`/api/notifications/${notification.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      }).catch(() => {});
    }

    if (notification.relatedTaskId) {
      router.push(`/tasks/${notification.relatedTaskId}`);
    } else if (notification.relatedConversationId) {
      router.push(`/messages?conversationId=${notification.relatedConversationId}`);
    } else if (notification.relatedShipmentId) {
      router.push(`/shipments/${notification.relatedShipmentId}`);
    }
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/mark-all-read", { method: "POST" }).catch(() => {});
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        aria-label="Thông báo"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 z-20 mt-2 w-80 max-w-[90vw] rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-900">Thông báo</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Đánh dấu tất cả đã đọc
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-gray-400">Không có thông báo nào.</p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleNotificationClick(n)}
                className={`block w-full border-b border-gray-50 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-gray-50 ${
                  n.isRead ? "text-gray-500" : "bg-blue-50/50 font-medium text-gray-900"
                }`}
              >
                <p>{n.message}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {new Date(n.createdAt).toLocaleString("vi-VN")}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
