import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "opportunity-lab-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const nextDark = event.newValue !== "light";
      document.documentElement.classList.toggle("dark", nextDark);
      setDark(nextDark);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function toggle() {
    const nextDark = !dark;
    document.documentElement.classList.toggle("dark", nextDark);
    setDark(nextDark);
    try {
      localStorage.setItem(STORAGE_KEY, nextDark ? "dark" : "light");
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <span className="hidden sm:inline">{dark ? "Light" : "Dark"} mode</span>
    </Button>
  );
}
