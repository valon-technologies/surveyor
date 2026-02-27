"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "default" | "vaporwave";

const VAPORWAVE_VARS: Record<string, string> = {
  "--color-background": "#0d0d14",
  "--color-foreground": "#e2d9f3",
  "--color-muted": "#1a1028",
  "--color-muted-foreground": "#9b8bb8",
  "--color-border": "#2d1b69",
  "--color-input": "#2d1b69",
  "--color-ring": "#c084fc",
  "--color-primary": "#c084fc",
  "--color-primary-foreground": "#0d0d14",
  "--color-secondary": "#1a1028",
  "--color-secondary-foreground": "#e2d9f3",
  "--color-accent": "#2d1b4e",
  "--color-accent-foreground": "#f472b6",
  "--color-destructive": "#ff3366",
  "--color-destructive-foreground": "#0d0d14",
  "--color-card": "#13131f",
  "--color-card-foreground": "#e2d9f3",
  "--color-popover": "#13131f",
  "--color-popover-foreground": "#e2d9f3",
  "--color-sidebar": "#0a0a12",
  "--color-sidebar-foreground": "#e2d9f3",
  "--color-sidebar-border": "#2d1b69",
  "--color-sidebar-accent": "#1a1028",
  "--color-sidebar-accent-foreground": "#c084fc",
};

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  if (theme === "vaporwave") {
    el.dataset.theme = "vaporwave";
    for (const [key, val] of Object.entries(VAPORWAVE_VARS)) {
      el.style.setProperty(key, val);
    }
  } else {
    delete el.dataset.theme;
    for (const key of Object.keys(VAPORWAVE_VARS)) {
      el.style.removeProperty(key);
    }
  }
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "default",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("default");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved === "vaporwave") {
      setTheme("vaporwave");
      applyTheme("vaporwave");
    }
  }, []);

  function toggle() {
    const next = theme === "default" ? "vaporwave" : "default";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
