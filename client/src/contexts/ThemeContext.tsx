import React, { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: (event?: React.MouseEvent<HTMLElement>) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const transitioning = useRef(false);
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      const stored = localStorage.getItem("theme");
      return (stored as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? (event?: React.MouseEvent<HTMLElement>) => {
        if (transitioning.current) return;
        const switchTheme = () => setTheme(prev => (prev === "light" ? "dark" : "light"));
        if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          switchTheme();
          return;
        }
        const bounds = event?.currentTarget.getBoundingClientRect();
        const x = bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2;
        const y = bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2;
        const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        const root = document.documentElement;
        root.style.setProperty("--theme-reveal-x", `${x}px`);
        root.style.setProperty("--theme-reveal-y", `${y}px`);
        root.style.setProperty("--theme-reveal-radius", `${radius}px`);
        root.dataset.themeTransition = "active";
        transitioning.current = true;
        const transition = document.startViewTransition(() => flushSync(switchTheme));
        void transition.finished.catch(() => {}).finally(() => {
          transitioning.current = false;
          delete root.dataset.themeTransition;
          root.style.removeProperty("--theme-reveal-x");
          root.style.removeProperty("--theme-reveal-y");
          root.style.removeProperty("--theme-reveal-radius");
        });
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
