/* eslint-disable react/prop-types -- tiny presentational icons */
// Line icons for the map-objects UI (24px grid, currentColor), matching components/Icons.jsx.

const Svg = ({ size = 18, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const PolygonIcon = (p) => (
  <Svg {...p}>
    <path d="M5 8 12 3l7 5-2.5 9h-9z" />
    <circle cx="12" cy="3" r="1.4" fill="currentColor" />
    <circle cx="5" cy="8" r="1.4" fill="currentColor" />
    <circle cx="19" cy="8" r="1.4" fill="currentColor" />
  </Svg>
)
export const ZoneIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9.5 11 4l9 4.5-2 10.5H7z" strokeDasharray="3 2.4" />
    <circle cx="11" cy="4" r="1.5" fill="currentColor" />
    <circle cx="4" cy="9.5" r="1.5" fill="currentColor" />
    <circle cx="20" cy="8.5" r="1.5" fill="currentColor" />
  </Svg>
)
export const RectIcon = (p) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="12" rx="1" />
  </Svg>
)
export const CircleIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12h8" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
  </Svg>
)
export const RulerIcon = (p) => (
  <Svg {...p}>
    <path d="M3 17 17 3l4 4L7 21z" />
    <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
  </Svg>
)
export const PinIcon = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </Svg>
)
export const EyeIcon = ({ off, ...p }) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </Svg>
)
export const TargetIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Svg>
)
export const EditIcon = (p) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </Svg>
)
export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
)
export const BellIcon = ({ on, ...p }) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
    <path d="M10 20a2 2 0 0 0 4 0" />
    {!on && <path d="M3 3l18 18" />}
  </Svg>
)
export const CopyIcon = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
)
