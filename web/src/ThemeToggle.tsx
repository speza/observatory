interface ThemeToggleProps {
  readonly theme: "light" | "dark";
  readonly onToggle: () => void;
}

const MoonIcon = (): React.JSX.Element => (
  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
    <path
      d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
);

const SunIcon = (): React.JSX.Element => (
  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
);

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
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
};
