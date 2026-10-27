// Shared building blocks (DesignSystem.swift / CardViews.swift counterparts).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatViewers, formatDuration } from './logic';
import { openChannel, play, pop, push } from './nav';
import { state, useStore } from './store';
import type { Stream, Vod, Clip, Category } from './twitch';

const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  browse: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  library: 'M4 4h4v16H4zm6 0h4v16h-4zm6.5.6 3.9 1 -3.9 15.4-3.9-1z',
  back: 'M15.5 4.5 8 12l7.5 7.5-1.4 1.4L5.2 12l8.9-8.9z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6 4h4.5v16H6zm7.5 0H18v16h-4.5z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  down: 'M4.9 8.5 12 15.6l7.1-7.1 1.4 1.4L12 18.4 3.5 9.9z',
  gear: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.3 2h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.8v1.8l2 1.8-1.7 2.9-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-2.9 2-1.8v-1.8l-2-1.8 1.7-2.9 2.5.9 1.6-.9z',
  chat: 'M4 4h16v12H8l-4 4z',
  airplay: 'M3 4h18v12h-4l-1.5-2H19V6H5v8h3.5L7 16H3zm9 9 6 7H6z',
  full: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
  pip: 'M3 5h18v14H3zm2 2v10h14V7zm6 5h7v4h-7z',
  heart: 'M12 21 3.5 12.5A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.5z',
  share: 'M12 2l4.5 4.5-1.4 1.4L13 5.8V15h-2V5.8L8.9 7.9 7.5 6.5zM5 10h3v2H6v8h12v-8h-2v-2h3v12H5z',
  more: 'M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  rew: 'M12 5V1.5L7 6l5 4.5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  fwd: 'M12 5V1.5L17 6l-5 4.5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  send: 'M3 20.5 21 12 3 3.5 3 10l12 2-12 2z',
  smile: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-3.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 14a5.5 5.5 0 0 0 10 0z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  gift: 'M3 8h18v4H3zm1 5h7v8H4zm9 0h7v8h-7zM12 8C10 4 6 4 7 7l5 1zm0 0c2-4 6-4 5-1l-5 1z',
  link: 'M9.2 13.4 13.4 9.2l1.4 1.4-4.2 4.2zM8.5 11l1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1a4 4 0 0 1-5.6-5.6zm7-7a4 4 0 0 1 5.6 5.6L19 11.7l-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8l-2.1 2.1-1.4-1.4z',
};
export function Icon({ n, size = 22 }: { n: keyof typeof paths | string; size?: number }) {
  return <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[n]} fill="currentColor" /></svg>;
}

/** Large-title page with optional back button and trailing items (navigation bar of a NavigationStack). */
export function Page({ title, back, trailing, children, large = true }: { title: string; back?: boolean; trailing?: ComponentChildren; children: ComponentChildren; large?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const f = () => setScrolled(scrollY > 40); addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f); }, []);
  return <div class="page">
    <header class={'navbar' + (scrolled || !large ? ' solid' : '')}>
      <div class="nav-leading">{back && <button class="nav-btn" onClick={pop} aria-label="Zurück"><Icon n="back" /></button>}</div>
      <div class="nav-title">{(scrolled || !large) && title}</div>
      <div class="nav-trailing">{trailing}</div>
    </header>
    {large && <h1 class="large-title">{title}</h1>}
    {children}
  </div>;
}

export function AccountButton() {
  const s = useStore();
  return <button class="nav-btn avatar-btn" onClick={() => push({ name: 'settings' })} aria-label="Einstellungen">
    {s.account?.avatar ? <img src={s.account.avatar} alt="" /> : <Icon n="gear" />}
  </button>;
}

export function Shelf({ title, onAll, children }: { title: string; onAll?: () => void; children: ComponentChildren }) {
  return <section class="shelf">
    <div class="shelf-head"><h2>{title}</h2>{onAll && <button class="link" onClick={onAll}>Alle</button>}</div>
    <div class="shelf-row">{children}</div>
  </section>;
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ComponentChildren }) {
  return <div class="empty"><h3>{title}</h3>{text && <p>{text}</p>}{children}</div>;
}
export const Spinner = ({ text }: { text?: string }) => <div class="spinner-wrap"><div class="spinner" />{text && <p>{text}</p>}</div>;

const thumb = (u: string, w = 440, h = 248) => u.replace('{width}', String(w)).replace('{height}', String(h));
const uptime = (iso?: string) => {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
};

export function StreamCard({ s, wide }: { s: Stream; wide?: boolean }) {
  return <button class={'card' + (wide ? ' wide' : '')} onClick={() => play({ kind: 'live', login: s.login })}
    onContextMenu={e => { e.preventDefault(); openChannel(s.login); }}>
    <div class="thumb"><img loading="lazy" src={thumb(s.thumb)} alt="" />
      <span class="badge live">LIVE</span><span class="badge br">{formatViewers(s.viewers)} Zuschauer</span>
      {s.startedAt && <span class="badge bl">{uptime(s.startedAt)}</span>}</div>
    <div class="card-info">
      {s.avatar && <img class="avatar sm" src={s.avatar} alt="" onClick={e => { e.stopPropagation(); openChannel(s.login); }} />}
      <div><div class="card-title">{s.name}</div><div class="card-sub">{s.title}</div>
        {s.game && <span class="pill">{s.game}</span>}</div>
    </div>
  </button>;
}
export function VodCard({ v, wide, onClick, status, statusError, disabled }: {
  v: Vod; wide?: boolean; onClick?: () => void; status?: string; statusError?: boolean; disabled?: boolean;
}) {
  const p = state.progress[v.id];
  return <button class={'card' + (wide ? ' wide' : '')} disabled={disabled} aria-busy={status === 'Suche …'}
    onClick={onClick ?? (() => play({ kind: 'vod', id: v.id }))}>
    <div class="thumb"><img loading="lazy" src={v.thumb.includes('404_processing') || !v.thumb ? '' : thumb(v.thumb, 320, 180)} alt="" />
      <span class="badge br">{formatDuration(v.length)}</span>
      {status && <span class={'badge bl' + (statusError ? ' problem' : '')}>{status}</span>}
      {p && v.length ? <div class="progress"><div style={{ width: `${Math.min(100, p / v.length * 100)}%` }} /></div> : null}</div>
    <div class="card-info"><div><div class="card-title">{v.title}</div>
      <div class="card-sub">{v.name ? v.name + ' · ' : ''}{relDate(v.publishedAt)}{v.views ? ` · ${formatViewers(v.views)} Aufrufe` : ''}</div></div></div>
  </button>;
}
export function ClipCard({ c, onClick }: { c: Clip; onClick: () => void }) {
  return <button class="card clip" onClick={onClick}>
    <div class="thumb tall"><img loading="lazy" src={c.thumb} alt="" /><span class="badge br">{c.duration} s</span></div>
    <div class="card-info"><div><div class="card-title">{c.title}</div><div class="card-sub">{c.name ?? ''} · {formatViewers(c.views)} Aufrufe</div></div></div>
  </button>;
}
export function CategoryTile({ c }: { c: Category }) {
  return <button class="cat" onClick={() => push({ name: 'category', id: c.id, title: c.name })}>
    <img loading="lazy" src={thumb(c.boxArt, 285, 380)} alt="" />
    <div class="card-title">{c.name}</div>
    {c.viewers != null && <div class="card-sub">{formatViewers(c.viewers)} Zuschauer</div>}
  </button>;
}
export function relDate(iso?: string): string {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 3600) return `vor ${Math.max(1, Math.floor(d / 60))} min`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `vor ${Math.floor(d / 86400)} ${Math.floor(d / 86400) === 1 ? 'Tag' : 'Tagen'}`;
  return new Date(iso).toLocaleDateString('de-DE');
}

/** Bottom sheet with a title bar (tSheetBar). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return <div class="sheet-backdrop" onClick={onClose}>
    <div class="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <div class="sheet-bar"><span /><h3>{title}</h3><button class="close-btn" onClick={onClose} aria-label="Schließen"><Icon n="close" size={16} /></button></div>
      <div class="sheet-body">{children}</div>
    </div>
  </div>;
}
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div class="segmented">{options.map(([v, l]) => <button class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Toggle({ label, value, onChange, sub }: { label: string; value: boolean; onChange: (v: boolean) => void; sub?: string }) {
  return <label class="row"><div><div>{label}</div>{sub && <div class="row-sub">{sub}</div>}</div>
    <input type="checkbox" class="switch" checked={value} onChange={e => onChange((e.target as HTMLInputElement).checked)} /></label>;
}
export function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <label class="row"><span>{label}</span>
    <select value={String(value)} onChange={e => { const raw = (e.target as HTMLSelectElement).value; onChange((typeof value === 'number' ? Number(raw) : raw) as T); }}>
      {options.map(([v, l]) => <option value={String(v)}>{l}</option>)}</select></label>;
}
