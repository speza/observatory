import { Moon, Sun } from "lucide-react";

interface ThemeToggleProps {
  readonly theme: "light" | "dark";
  readonly onToggle: () => void;
}

export const ThemeToggle = ({ theme, onToggle }: ThemeToggleProps): React.JSX.Element => {
  const nextTheme = theme === "light" ? "dark" : "light";

  return (
    <button
      aria-label={`Switch to ${nextTheme} theme`}
      className="theme-toggle"
      onClick={onToggle}
      title={`Switch to ${nextTheme} theme`}
      type="button"
    >
      {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </button>
  );
};
