interface ObservatoryLogoProps {
  readonly className?: string;
}

export const ObservatoryLogo = ({ className = "" }: ObservatoryLogoProps): React.JSX.Element => (
  <svg
    aria-hidden="true"
    className={`observatory-logo ${className}`.trim()}
    fill="none"
    viewBox="0 0 32 32"
  >
    <circle className="observatory-logo__aperture" cx="16" cy="16" r="14" />
    <path className="observatory-logo__datum" d="M.5 24.25 31.5 7.75" />
    <circle className="observatory-logo__signal" cx="23" cy="10" r="3.5" />
  </svg>
);
