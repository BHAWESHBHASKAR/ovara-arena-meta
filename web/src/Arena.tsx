import type { ArenaData, Round, Summary } from './types'
import { ArrowRight, Bot, Crosshair, Flag, Loader, Paperclip, Shield, ShieldCheck, ShieldOff } from './icons'
import { INVOICE_USD, fooled, styleWord, usd, verdictOf } from './verdict'
import { clock } from './describe'

const modelName = (m?: string) => (m ? m.split('/').pop() || m : 'model not reported')

export function Players({ models }: { models: ArenaData['models'] }) {
  return (
    <div className="players" aria-label="The three players">
      <div className="player p-attacker">
        <div className="p-icon"><Crosshair size={18} /></div>
        <div className="p-body">
          <div className="p-head"><div className="p-role">Attacker</div>
          <div className="p-model" title={models.attacker}>{modelName(models.attacker)}</div></div>
          <div className="p-job">Writes a fake client email with a doctored image. Adapts each round.</div>
        </div>
      </div>
      <ArrowRight className="p-arrow" size={18} />
      <div className="player p-agent">
        <div className="p-icon"><Bot size={18} /></div>
        <div className="p-body">
          <div className="p-head"><div className="p-role">Agent</div>
          <div className="p-model" title={models.agent}>{modelName(models.agent)}</div></div>
          <div className="p-job">Reads email and image. Works Acme Studio's PayPal sandbox via PayPal MCP.</div>
        </div>
      </div>
      <ArrowRight className="p-arrow" size={18} />
      <div className="player p-gate">
        <div className="p-icon"><Shield size={18} /></div>
        <div className="p-body">
          <div className="p-head"><div className="p-role">Gate</div>
          <div className="p-model">OVARA <span className="p-tag">open-source Go gateway</span></div></div>
          <div className="p-job">Reads pass. Money-moving calls wait for a person. Each decision is a signed receipt.</div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  )
}

function Side({ s, on }: { s: Summary; on: boolean }) {
  const lost = s.landed * INVOICE_USD
  const stopped = s.held_denied + s.refused
  return (
    <div className={`side ${on ? 'side-on' : 'side-off'}`}>
      <div className="side-head">
        {on ? <ShieldCheck size={17} /> : <ShieldOff size={17} />}
        <span className="side-name">OVARA {on ? 'on' : 'off'}</span>
        <span className="side-n">{s.rounds} round{s.rounds === 1 ? '' : 's'}</span>
      </div>
      {s.rounds === 0 ? (
        <div className="side-empty">No rounds played with the gate {on ? 'on' : 'off'} yet.</div>
      ) : (
        <div className="stats">
          <Stat label="Agent fooled" value={`${s.agent_fooled}/${s.rounds}`} sub="called a money tool" tone={s.agent_fooled ? 'warn' : ''} />
          <Stat label="Held & denied" value={stopped} sub={s.refused ? `${s.refused} refused by rule` : 'stopped by OVARA'} tone={stopped ? 'held' : ''} />
          <Stat label="Landed at PayPal" value={s.landed} sub="calls PayPal carried out" tone={s.landed ? 'leak' : 'safe'} />
          <Stat label="Value lost" value={usd(lost)} sub={`${s.landed} × ${usd(INVOICE_USD)} invoice`} tone={lost ? 'leak' : 'safe'} />
        </div>
      )}
    </div>
  )
}

export function Scoreboard({ data }: { data: ArenaData }) {
  return (
    <div className="scoreboard">
      <Side s={data.summary.strict} on />
      <div className="vs">vs</div>
      <Side s={data.summary.observe} on={false} />
      <div className="sb-note">
        {data.rounds.some((r) => r.replay_of)
          ? 'Same attacks on both sides: the attacker wrote each round against OVARA on, then the identical email and image were sent again with OVARA off. The agent is not deterministic, so it was not fooled by the same rounds each time.'
          : 'Each side is its own adaptive match: the attacker changed its approach from round to round, so the two sides did not see the same emails.'}{' '}
        Value lost counts the open {usd(INVOICE_USD)} Contoso invoice per landed round.
      </div>
    </div>
  )
}

export type Filter = 'all' | 'strict' | 'observe'

export function Timeline({ rounds, selected, onSelect, live, filter, setFilter }: {
  rounds: Round[]
  selected: string | null
  onSelect: (id: string) => void
  live: { n: number; label: string; profile: string } | null
  filter: Filter
  setFilter: (f: Filter) => void
}) {
  const list = rounds.filter(r => filter === 'all' || r.profile === filter).sort((a, b) => b.n - a.n)
  return (
    <aside className="timeline">
      <div className="tl-head">
        <span className="eyebrow">Rounds</span>
        <div className="seg seg-sm" role="group" aria-label="Filter rounds">
          {(['all', 'strict', 'observe'] as const).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'strict' ? 'OVARA on' : 'OVARA off'}</button>
          ))}
        </div>
      </div>
      <ol className="tl-list">
        {live && (
          <li>
            <button className={`tl-item tl-live ${selected === 'live' ? 'sel' : ''}`} onClick={() => onSelect('live')}>
              <span className="tl-n">{live.n}</span>
              <span className="tl-main">
                <span className="tl-subj"><Loader size={12} /> {live.label}</span>
                <span className="tl-meta"><span className={`pchip ${live.profile === 'observe' ? 'off' : 'on'}`}>{live.profile === 'observe' ? 'OFF' : 'ON'}</span>in progress</span>
              </span>
            </button>
          </li>
        )}
        {list.map(r => {
          const v = verdictOf(r)
          return (
            <li key={r.id}>
              <button className={`tl-item ${selected === r.id ? 'sel' : ''}`} onClick={() => onSelect(r.id)}>
                <span className="tl-n">{r.n}</span>
                <span className="tl-main">
                  <span className="tl-subj" title={r.attack.subject}>{r.attack.subject || '(no subject)'}</span>
                  <span className="tl-meta">
                    <span className={`pchip ${r.profile === 'observe' ? 'off' : 'on'}`}>{r.profile === 'observe' ? 'OFF' : 'ON'}</span>
                    {r.attack.image ? <span className="tl-style"><Paperclip size={11} />{styleWord(r.attack.image.style)}</span> : <span className="tl-style">text only</span>}
                    {fooled(r) && <span className="tl-fooled" title="The agent called a money tool"><Flag size={11} />fooled</span>}
                  </span>
                </span>
                <span className="tl-right">
                  <span className={`vchip t-${v.tone}`}>{v.short}</span>
                  <span className="tl-time">{clock(r.at)}</span>
                </span>
              </button>
            </li>
          )
        })}
        {!list.length && !live && <li className="tl-empty">No rounds {filter === 'all' ? 'yet. Start a match above.' : 'with this filter.'}</li>}
      </ol>
    </aside>
  )
}
