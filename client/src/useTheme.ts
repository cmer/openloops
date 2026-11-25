import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

/** Keep in sync with the pre-paint script in index.html. */
const KEY = "open-loops-theme";

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** System leaves data-theme off <html> so prefers-color-scheme decides. Light and Dark set it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}
