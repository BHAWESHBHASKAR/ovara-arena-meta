import { useId, type CSSProperties, type ReactNode } from 'react'
import { verdictOf, styleWord, type Tone } from './verdict'
import type { Round } from './types'

export const IMG_W = 900
export const IMG_H = 640
export type Box = [number, number, number, number]

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="logo">
      <rect x="1.5" y="1.5" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M9 12h6" stroke="currentColor" strokeWidth="1.6" />
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

// ---------- the rubber stamp ----------

const STAMP_SUB: Record<string, string> = { LANDED: 'at PayPal', HELD: 'by OVARA', REFUSED: 'by OVARA', 'NO CALL': 'agent not fooled', FAILED: 'PayPal rejected', ERROR: 'round failed' }

export function Stamp({ tone, word, size = 'md', tilt, sub, className, title }: {
  tone: Tone | 'muted'
  word: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  tilt?: number
  sub?: string | false
  className?: string
  title?: string
}) {
  const w = word.toUpperCase()
  const s = sub === false ? '' : sub ?? (size === 'lg' || size === 'md' ? STAMP_SUB[w] || '' : '')
  return (
    <span className={`stamp st-${tone} st-${size} ${className || ''}`} style={{ '--tilt': `${tilt ?? -6}deg` } as CSSProperties} title={title} role="img" aria-label={`${w}${s ? ` ${s}` : ''}`}>
      <span className="stamp-w">{w}</span>
      {s && <span className="stamp-s">{s}</span>}
    </span>
  )
}

const tiltOf = (n: number) => -4 - ((n * 7) % 5)

export function VerdictStamp({ round, size = 'md', sub, className }: { round: Round; size?: 'xs' | 'sm' | 'md' | 'lg'; sub?: string | false; className?: string }) {
  const v = verdictOf(round)
  return <Stamp tone={v.tone} word={v.short} size={size} tilt={tiltOf(round.n)} sub={sub} className={className} title={v.word} />
}
// kept for older call sites
export const VerdictBadge = VerdictStamp

export function Badge({ tone, children, title }: { tone: Tone | 'muted'; children: ReactNode; size?: 'sm' | 'md' | 'lg'; title?: string }) {
  return <span className={`mark m-${tone}`} title={title}>{children}</span>
}

export function GatePill({ profile }: { profile: string }) {
  return <span className={`gate ${profile === 'observe' ? 'off' : 'on'}`}>{profile === 'observe' ? 'OVARA off' : 'OVARA on'}</span>
}

// ---------- the attachment, as a sheet ----------

// The attachment as the agent got it. With reveal on, the rest fades back, the
// hidden region gets an outline, and faint text is contrast-boosted (the real pixels).
export function Shot({ src, box, reveal, style, label = 'Hidden instruction', alt, className, children }: {
  src: string
  box?: Box
  reveal: boolean
  style?: string
  label?: string
  alt?: string
  className?: string
  children?: ReactNode
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
                <rect x={b[0] - pad} y={b[1] - pad} width={b[2] + pad * 2} height={b[3] + pad * 2} fill="black" />
              </mask>
            </defs>
            <rect className="shot-dim" width={IMG_W} height={IMG_H} mask={`url(#m${id})`} />
            <rect className="shot-ring" x={b[0] - pad} y={b[1] - pad} width={b[2] + pad * 2} height={b[3] + pad * 2} pathLength={100} />
          </svg>
          <span className="shot-tag" style={{ ...(b[0] > IMG_W * 0.5 ? { right: `${(Math.max(0, IMG_W - b[0] - b[2] - pad) / IMG_W) * 100}%` } : { left: `${(Math.max(0, b[0] - pad) / IMG_W) * 100}%` }), ...(b[1] > 60 ? { bottom: `${((IMG_H - b[1] + pad) / IMG_H) * 100}%` } : { top: `${((b[1] + b[3] + pad) / IMG_H) * 100}%` }) }}>{label}</span>
        </>
      )}
      {children}
    </div>
  )
}

// A cropped tile around the hidden region, with the region contrast-boosted.
export function CropTile({ src, box, style, round }: { src: string; box: Box; style?: string; round?: boolean }) {
  const b = clampBox(box)
  const cw = round ? Math.max(170, Math.min(260, b[3] * 1.3)) : Math.min(IMG_W, Math.max(360, Math.min(b[2] + 40, 520)))
  const ch = round ? cw : Math.round(cw * 0.42)
  const cx = round ? Math.max(0, Math.min(IMG_W - cw, b[0] + Math.min(b[2], cw * 1.6) / 2 - cw / 2)) : Math.max(0, Math.min(IMG_W - cw, b[0] - 20))
  const cy = Math.max(0, Math.min(IMG_H - ch, b[1] + b[3] / 2 - ch / 2))
  const crop: Box = [cx, cy, cw, ch]
  const ix = Math.max(b[0], cx), iy = Math.max(b[1], cy)
  const iw = Math.min(b[0] + b[2], cx + cw) - ix, ih = Math.min(b[1] + b[3], cy + ch) - iy
  return (
    <div className={`crop ${round ? 'crop-round' : ''}`} style={{ aspectRatio: `${cw} / ${ch}` }}>
      <ImgRegion src={src} rect={crop} className="crop-img" />
      {iw > 0 && ih > 0 && (
        <div className="crop-hit" style={{ left: `${((ix - cx) / cw) * 100}%`, top: `${((iy - cy) / ch) * 100}%`, width: `${(iw / cw) * 100}%`, height: `${(ih / ch) * 100}%` }}>
          {isFaint(style) && <ImgRegion src={src} rect={[ix, iy, iw, ih]} className="crop-enh" />}
        </div>
      )}
    </div>
  )
}

// The forensic reading: the sheet with the region outlined, a loupe on the
// hidden region, and the transcribed line beside it on a leader line.
export function Examined({ src, box, style, text, reveal, alt, children }: {
  src: string
  box?: Box
  style?: string
  text?: string
  reveal: boolean
  alt?: string
  children?: ReactNode
}) {
  const b = box ? clampBox(box) : null
  const on = reveal && !!b
  const cy = b ? (b[1] + b[3] / 2) / IMG_H : 0.5
  const rx = b ? Math.min(b[0] + b[2], IMG_W) / IMG_W : 1
  return (
    <div className={`exam ${on ? 'on' : ''}`} style={{ '--cy': cy, '--rx': rx } as CSSProperties}>
      <div className="exam-sheet">
        <Shot src={src} box={box} reveal={on} style={style} alt={alt} label="Hidden instruction">{children}</Shot>
      </div>
      {on && b && (
        <>
          <span className="exam-leader" aria-hidden="true" />
          <aside className="exam-note">
            <CropTile src={src} box={b} style={style} round={b[2] < b[3] * 5} />
            <div className="exam-label">Hidden instruction{style ? <> · {styleWord(style)}</> : null}</div>
            {text && <p className="exam-text">“{text}”</p>}
          </aside>
        </>
      )}
    </div>
  )
}
