// Small stroke icons (24px grid, lucide-style geometry), inlined to avoid a dependency.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = ({ size = 16, ...p }: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
})

export const Crosshair = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4" /></svg>
export const Bot = (p: P) => <svg {...base(p)}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 13v1.5M15 13v1.5M2 14h2M20 14h2" /></svg>
export const Shield = (p: P) => <svg {...base(p)}><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" /></svg>
export const ShieldCheck = (p: P) => <svg {...base(p)}><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
export const ShieldOff = (p: P) => <svg {...base(p)}><path d="M19.7 14A10 10 0 0 0 20 12V5l-8-3-3.2 1.2M4.7 4.7 4 5v7c0 6.4 8 10 8 10a20 20 0 0 0 5.4-3.6M2 2l20 20" /></svg>
export const Mail = (p: P) => <svg {...base(p)}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
export const Paperclip = (p: P) => <svg {...base(p)}><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
export const Eye = (p: P) => <svg {...base(p)}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
export const EyeOff = (p: P) => <svg {...base(p)}><path d="M9.9 4.2A9 9 0 0 1 12 4c6.4 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.6 8 10 8a9 9 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 0 1-4.2-4.2" /></svg>
export const Play = (p: P) => <svg {...base(p)}><path d="M7 4v16l13-8Z" /></svg>
export const Square = (p: P) => <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
export const Key = (p: P) => <svg {...base(p)}><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" /></svg>
export const Wrench = (p: P) => <svg {...base(p)}><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8a2.8 2.8 0 0 1-4-4l8-8-1.3-1.3a4 4 0 0 0-5-5L13 4.9Z" /></svg>
export const Brain = (p: P) => <svg {...base(p)}><path d="M12 5a3 3 0 0 0-5.8-1A3 3 0 0 0 4 8a3 3 0 0 0 0 5 3 3 0 0 0 2 4.8A3 3 0 0 0 12 19ZM12 5a3 3 0 0 1 5.8-1A3 3 0 0 1 20 8a3 3 0 0 1 0 5 3 3 0 0 1-2 4.8A3 3 0 0 1 12 19Z" /></svg>
export const Inbox = (p: P) => <svg {...base(p)}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" /></svg>
export const Alert = (p: P) => <svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
export const Check = (p: P) => <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
export const X = (p: P) => <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
export const Hand = (p: P) => <svg {...base(p)}><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" /></svg>
export const Flag = (p: P) => <svg {...base(p)}><path d="M4 22V4s1-1 4-1 5 2 8 2 4-1 4-1v11s-1 1-4 1-5-2-8-2-4 1-4 1" /></svg>
export const Receipt = (p: P) => <svg {...base(p)}><path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2Z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
export const Scale = (p: P) => <svg {...base(p)}><path d="M12 3v18M5 21h14M3 7h18M6 7l-3 7a3 3 0 0 0 6 0ZM18 7l-3 7a3 3 0 0 0 6 0Z" /></svg>
export const Swords = (p: P) => <svg {...base(p)}><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5 14 2h3v3l-4.5 4.5M5 14l4 4M7 17l-3 3M3 19l2 2" /></svg>
export const ArrowRight = (p: P) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
export const Dollar = (p: P) => <svg {...base(p)}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
export const Loader = (p: P) => <svg {...base(p)} className={`spin ${p.className || ''}`}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
