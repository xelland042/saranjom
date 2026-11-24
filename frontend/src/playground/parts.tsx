// Icons and the background scene for the glass prototype. Everything is drawn here, no image files.

const PATHS: Record<string, string> = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  truck: 'M2 6h12v10H2zM14 9h4l3 3v4h-7M6.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3z',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  clip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  arrow: 'M7 17 17 7M8 7h9v9',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M5 12l5 5 9-10',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  chev: 'M9 6l6 6-6 6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  close: 'M6 6l12 12M18 6 6 18',
  chevDown: 'M6 9l6 6 6-6',
  updown: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  warehouse: 'M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 17h10',
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

// A dusk view through a big window: sky, hills, window frame and a dim floor.
// It sits behind the glass so backdrop-filter has something to blur.
export function Scene() {
  return (
    <svg className="sp-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sp-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3a4250" />
          <stop offset="0.45" stopColor="#8d8e95" />
          <stop offset="0.72" stopColor="#d9b48d" />
          <stop offset="1" stopColor="#c58a5c" />
        </linearGradient>
        <radialGradient id="sp-sun" cx="0.62" cy="0.62" r="0.35">
          <stop offset="0" stopColor="#ffd9a3" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd9a3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sp-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#4a3b30" />
          <stop offset="1" stopColor="#17110d" />
        </linearGradient>
        <filter id="sp-soft">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="1600" height="900" fill="url(#sp-sky)" />
      <rect width="1600" height="900" fill="url(#sp-sun)" />
      <path d="M0 560 C200 500 330 520 470 470 S760 430 900 480 1200 450 1350 500 1520 470 1600 490 V720 H0z" fill="#7d7a80" opacity="0.75" />
      <path d="M0 610 C180 570 300 600 460 560 S760 540 920 590 1180 560 1350 600 1530 580 1600 600 V720 H0z" fill="#5b5458" />
      <path d="M0 660 C220 640 420 655 640 640 S1040 630 1240 650 1500 640 1600 650 V720 H0z" fill="#3f3739" />
      {/* Window frame */}
      <g fill="#1b1714">
        <rect x="0" y="0" width="1600" height="46" />
        <rect x="0" y="232" width="1600" height="16" />
        {[150, 500, 860, 1220].map((x) => (
          <rect key={x} x={x} y="0" width="22" height="720" />
        ))}
      </g>
      <rect y="700" width="1600" height="200" fill="url(#sp-floor)" />
      {/* Furniture, blurred so it reads as out of focus */}
      <g filter="url(#sp-soft)" opacity="0.85">
        <rect x="-40" y="690" width="320" height="110" rx="40" fill="#6b5a4c" />
        <rect x="1250" y="660" width="420" height="140" rx="50" fill="#8a7d72" />
        <ellipse cx="760" cy="790" rx="190" ry="34" fill="#2c211a" />
        <path d="M1440 470 q30 -80 70 -10 q40 -90 60 10 q40 -40 30 60 v170 h-160z" fill="#2f4030" />
      </g>
    </svg>
  )
}
