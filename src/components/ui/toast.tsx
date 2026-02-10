"use client";

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { X, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const duration = toast.duration ?? 6000;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? XCircle : Sparkles;
  const iconColor =
    toast.type === "success"
      ? "text-green-500"
      : toast.type === "error"
        ? "text-red-500"
        : "text-purple-500";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-background p-3 shadow-lg",
        "animate-in slide-in-from-right-full fade-in duration-300"
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", iconColor)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
            className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline mt-1"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button onClick={onDismiss} className="p-0.5 rounded hover:bg-muted shrink-0">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}
