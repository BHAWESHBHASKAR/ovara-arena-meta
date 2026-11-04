import { useId, type CSSProperties, type ReactNode } from 'react'
import { verdictOf, type Tone } from './verdict'
import type { Round } from './types'
import { Check, Hand, X } from './icons'

export const IMG_W = 900
export const IMG_H = 640
export type Box = [number, number, number, number]

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="logo">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--text)" />
      <path d="M8 6.5v11M16 6.5v11" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8 12h8" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="2 2.6" />
    </svg>
  )
}

export function clampBox(b: Box): Box {
  const x = Math.max(0, Math.min(IMG_W - 1, b[0]))
  const y = Math.max(0, Math.min(IMG_H - 1, b[1]))
  return [x, y, Math.max(1, Math.min(IMG_W - x, b[2])), Math.max(1, Math.min(IMG_H - y, b[3]))]
}

// A div that shows one rectangle of a 900x640 image, stretched to fill the div.
export function ImgRegion({ src, rect, className, style }: { src: string; rect: Box; className?: string; style?: CSSProperties }) {
  const [x, y, w, h] = rect
  return (
    <div
      className={className}
      style={{
        backgroundImage: `url("${src}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${(IMG_W / w) * 100}% ${(IMG_H / h) * 100}%`,
        backgroundPosition: `${w >= IMG_W ? 0 : (x / (IMG_W - w)) * 100}% ${h >= IMG_H ? 0 : (y / (IMG_H - h)) * 100}%`,
        ...style,
      }}
    />
  )
}

const FAINT = new Set(['faint_footer', 'near_white', 'tiny_print'])
export const isFaint = (style?: string) => !!style && FAINT.has(style)

// The attachment as the agent got it. With reveal on, the rest dims, the hidden
// region gets an outline, and faint text is contrast-boosted (the real pixels).
export function Shot({ src, box, reveal, style, label = 'Hidden instruction', alt, className }: {
  src: string
  box?: Box
  reveal: boolean
  style?: string
  label?: string
  alt?: string
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const b = box ? clampBox(box) : null
  const pad = 6
  return (
    <div className={`shot ${reveal && b ? 'on' : ''} ${className || ''}`}>
      <img src={src} alt={alt || 'Email attachment'} draggable={false} />
      {b && (
        <>
          {isFaint(style) && (
            <ImgRegion src={src} rect={b} className="shot-enh" style={{ left: `${(b[0] / IMG_W) * 100}%`, top: `${(b[1] / IMG_H) * 100}%`, width: `${(b[2] / IMG_W) * 100}%`, height: `${(b[3] / IMG_H) * 100}%` }} />
          )}
          <svg className="shot-svg" viewBox={`0 0 ${IMG_W} ${IMG_H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <mask id={`m${id}`}>
                <rect width={IMG_W} height={IMG_H} fill="white" />
                <rect x={b[0] - pad} y={b[1] - pad} width={b[2] + pad * 2} height={b[3] + pad * 2} rx="6" fill="black" />
              </mask>
            </defs>
            <rect className="shot-dim" width={IMG_W} height={IMG_H} mask={`url(#m${id})`} />
            <rect className="shot-ring" x={b[0] - pad} y={b[1] - pad} width={b[2] + pad * 2} height={b[3] + pad * 2} rx="6" pathLength={100} />
          </svg>
          <span className="shot-tag" style={{ left: `${(Math.max(0, b[0] - pad) / IMG_W) * 100}%`, ...(b[1] > 60 ? { bottom: `${((IMG_H - b[1] + pad) / IMG_H) * 100}%` } : { top: `${((b[1] + b[3] + pad) / IMG_H) * 100}%` }) }}>{label}</span>
        </>
      )}
    </div>
  )
}

// A cropped tile around the hidden region, with the region contrast-boosted.
export function CropTile({ src, box, style }: { src: string; box: Box; style?: string }) {
  const b = clampBox(box)
  const cw = Math.min(IMG_W, Math.max(360, Math.min(b[2] + 40, 520)))
  const ch = Math.round(cw * 0.42)
  const cx = Math.max(0, Math.min(IMG_W - cw, b[0] - 20))
  const cy = Math.max(0, Math.min(IMG_H - ch, b[1] + b[3] / 2 - ch / 2))
  const crop: Box = [cx, cy, cw, ch]
  const ix = Math.max(b[0], cx), iy = Math.max(b[1], cy)
  const iw = Math.min(b[0] + b[2], cx + cw) - ix, ih = Math.min(b[1] + b[3], cy + ch) - iy
  return (
    <div className="crop" style={{ aspectRatio: `${cw} / ${ch}` }}>
      <ImgRegion src={src} rect={crop} className="crop-img" />
      {iw > 0 && ih > 0 && (
        <div className="crop-hit" style={{ left: `${((ix - cx) / cw) * 100}%`, top: `${((iy - cy) / ch) * 100}%`, width: `${(iw / cw) * 100}%`, height: `${(ih / ch) * 100}%` }}>
          {isFaint(style) && <ImgRegion src={src} rect={[ix, iy, iw, ih]} className="crop-enh" />}
        </div>
      )}
    </div>
  )
}

export function Badge({ tone, children, size = 'md', title }: { tone: Tone | 'muted'; children: ReactNode; size?: 'sm' | 'md' | 'lg'; title?: string }) {
  return <span className={`badge b-${tone} b-${size}`} title={title}>{children}</span>
}

export function VerdictBadge({ round, size = 'md' }: { round: Round; size?: 'sm' | 'md' | 'lg' }) {
  const v = verdictOf(round)
  const icon = v.tone === 'safe' ? <Hand size={size === 'lg' ? 16 : 13} /> : v.tone === 'leak' ? <X size={size === 'lg' ? 16 : 13} /> : <Check size={size === 'lg' ? 16 : 13} />
  return <Badge tone={v.tone} size={size}>{icon}{size === 'sm' ? v.short : v.word}</Badge>
}

export function GatePill({ profile }: { profile: string }) {
  return <span className={`gate-pill ${profile === 'observe' ? 'off' : 'on'}`}><span className="gp-dot" />{profile === 'observe' ? 'OVARA off' : 'OVARA on'}</span>
}
