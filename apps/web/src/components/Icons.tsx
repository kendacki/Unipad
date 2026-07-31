/** Brand + UI SVGs — orange / black / white */

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="4" fill="#0A0A0A" />
      <path
        d="M8 22V10l8 6 8-6v12"
        stroke="#FF6A00"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}

export function IconRocket({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M28.5 8.5c4.8-1.2 9.2 3.2 8 8L29 33.5 14.5 19l14-10.5Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 19 9 29.5l5.5-1.2L16 34l10.5-5.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="27.5" cy="16.5" r="2.4" fill="currentColor" />
      <path d="M11 35c-2.5 1-5 3.5-5 5.5 2 0 4.5-2.5 5.5-5Z" fill="currentColor" />
    </svg>
  );
}

export function IconCube({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 6 40 14v20L24 42 8 34V14L24 6Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M24 6v36M8 14l16 8 16-8" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect
        x="6"
        y="12"
        width="36"
        height="26"
        rx="3"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M6 18h36" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="34" cy="27" r="2.5" fill="currentColor" />
      <path d="M14 12V9.5A3.5 3.5 0 0 1 17.5 6H30" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function IconSpark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M5 19l2.5-2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

/** Floating 3D-style isometric pad SVG for hero accent */
export function HeroPadSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 320" fill="none" aria-hidden>
      <defs>
        <linearGradient id="padFace" x1="40" y1="40" x2="280" y2="280" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF6A00" />
          <stop offset="1" stopColor="#FF9A4D" />
        </linearGradient>
        <linearGradient id="padSide" x1="160" y1="80" x2="160" y2="280" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0A0A0A" />
          <stop offset="1" stopColor="#333" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="268" rx="90" ry="18" fill="#000" opacity="0.35" />
      <path d="M160 48 268 108v104L160 272 52 212V108L160 48Z" fill="url(#padSide)" />
      <path d="M160 48 268 108 160 168 52 108 160 48Z" fill="url(#padFace)" />
      <path d="M160 168 268 108v104L160 272V168Z" fill="#1A1A1A" />
      <path d="M160 168 52 108v104L160 272V168Z" fill="#0A0A0A" />
      <circle cx="160" cy="118" r="18" fill="#FFF" />
      <circle cx="160" cy="118" r="8" fill="#FF6A00" />
      <path
        d="M118 148h84M132 162h56"
        stroke="#FFF"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
