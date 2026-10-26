import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { QRCode } from 'antd';

import { AzurifyLogo } from '@/components/brand/AzurifyLogo';
import { BRAND_SITE_URL } from '@/components/brand/BrandBadge';
import './PortalPage.css';

interface PortalLink {
  protocol: string;
  name: string;
  url: string;
}

interface PortalApp {
  id: string;
  name: string;
  platform: string;
  url: string;
}

interface PortalMe {
  email: string;
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
  links: PortalLink[];
  apps: PortalApp[];
}

interface ApiReply<T> {
  success?: boolean;
  msg?: string;
  obj?: T;
}

type View = 'loading' | 'login' | 'account';

const REFRESH_MS = 30_000;
const TILT_DEGREES = 7;

// Relative URLs keep working when the portal is served from a sub-path or behind a proxy.
async function portalFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: ApiReply<T> }> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  let body: ApiReply<T> = {};
  try {
    body = (await response.json()) as ApiReply<T>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

// A signed-in account, null when the session is missing, undefined when the server is unreachable.
async function fetchMe(): Promise<PortalMe | null | undefined> {
  try {
    const { status, body } = await portalFetch<PortalMe>('api/me');
    return status === 200 && body.success && body.obj ? body.obj : null;
  } catch {
    return undefined;
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(2)} ${units[unit]}`;
}

function describeExpiry(expiryTime: number): { label: string; expired: boolean } {
  if (!expiryTime) return { label: 'No expiry', expired: false };
  if (expiryTime < 0) {
    const days = Math.round(expiryTime / -86_400_000);
    return { label: `Starts on first use, then ${days} days`, expired: false };
  }
  const left = expiryTime - Date.now();
  const date = new Date(expiryTime).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (left <= 0) return { label: `Expired on ${date}`, expired: true };
  const days = Math.ceil(left / 86_400_000);
  return { label: `${date} (${days} day${days === 1 ? '' : 's'} left)`, expired: false };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A glass panel that leans toward the pointer and follows it with a soft spotlight.
function Glass({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function onMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || prefersReducedMotion() || event.pointerType === 'touch') return;
    const box = el.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width - 0.5;
    const py = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty('--rx', `${(-py * TILT_DEGREES).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * TILT_DEGREES).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  return (
    <div
      ref={ref}
      className={`pt-glass ${className}`.trim()}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="pt-glass-body">{children}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="pt-footer">
      <a href={BRAND_SITE_URL} target="_blank" rel="noopener noreferrer">
        <b>AZURIFY</b> by DeZio · azurify.win ↗
      </a>
    </footer>
  );
}

function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { body } = await portalFetch('api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (body.success) {
        onSignedIn();
      } else {
        setError(body.msg || 'Could not sign in');
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Glass className="pt-login">
      <form onSubmit={submit}>
        <a className="pt-brand pt-brand-center" href={BRAND_SITE_URL} target="_blank" rel="noopener noreferrer">
          <AzurifyLogo size={64} />
          <span className="pt-brand-name">AZURIFY</span>
        </a>
        <h1 className="pt-title">Check your account</h1>
        <p className="pt-muted pt-center">Sign in with the username and password you were given.</p>
        <label className="pt-field">
          <span>Username</span>
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="pt-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div className="pt-error" role="alert">
            {error}
          </div>
        )}
        <button className="pt-btn pt-btn-primary pt-btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Glass>
  );
}

function Gauge({ percent, unlimited, bad }: { percent: number; unlimited: boolean; bad: boolean }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const filled = unlimited ? circumference * 0.18 : (circumference * percent) / 100;
  return (
    <div className={`pt-gauge${bad ? ' pt-gauge-bad' : ''}`}>
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <defs>
          <linearGradient id="pt-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00f0d0" />
            <stop offset="1" stopColor="#2b7bff" />
          </linearGradient>
        </defs>
        <circle className="pt-gauge-track" cx="70" cy="70" r={radius} />
        <circle
          className="pt-gauge-fill"
          cx="70"
          cy="70"
          r={radius}
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="pt-gauge-label">
        <strong>{unlimited ? '∞' : `${Math.round(percent)}%`}</strong>
        <span>{unlimited ? 'unlimited' : 'used'}</span>
      </div>
    </div>
  );
}

function UsageCard({ me }: { me: PortalMe }) {
  const used = me.up + me.down;
  const unlimited = me.total <= 0;
  const percent = unlimited ? 0 : Math.min(100, (used / me.total) * 100);
  const depleted = !unlimited && used >= me.total;
  const expiry = describeExpiry(me.expiryTime);
  const status = !me.enable ? 'Disabled' : expiry.expired ? 'Expired' : depleted ? 'Data used up' : 'Active';
  const good = status === 'Active';

  return (
    <Glass>
      <div className="pt-card-head">
        <h2>Usage</h2>
        <span className={`pt-badge ${good ? 'pt-badge-ok' : 'pt-badge-bad'}`}>{status}</span>
      </div>
      <div className="pt-usage">
        <Gauge percent={percent} unlimited={unlimited} bad={!good || percent >= 90} />
        <div className="pt-usage-main">
          <span className="pt-usage-used">{formatBytes(used)}</span>
          <span className="pt-muted">
            {unlimited ? 'used · unlimited data' : `of ${formatBytes(me.total)}`}
          </span>
        </div>
      </div>
      <dl className="pt-stats">
        <div>
          <dt>Download</dt>
          <dd>{formatBytes(me.down)}</dd>
        </div>
        <div>
          <dt>Upload</dt>
          <dd>{formatBytes(me.up)}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{unlimited ? 'Unlimited' : formatBytes(Math.max(0, me.total - used))}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{expiry.label}</dd>
        </div>
      </dl>
    </Glass>
  );
}

function LinkCard({ link, defaultOpen }: { link: PortalLink; defaultOpen: boolean }) {
  const [showQr, setShowQr] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyText(link.url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="pt-link">
      <div className="pt-link-head">
        <span className="pt-proto">{link.protocol || 'link'}</span>
        <span className="pt-link-name">{link.name}</span>
      </div>
      <div className="pt-link-actions">
        <button type="button" className="pt-btn pt-btn-primary" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <button type="button" className="pt-btn" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>
      {showQr && (
        <div className="pt-qr">
          <div className="pt-qr-frame">
            <QRCode value={link.url} type="svg" size={224} bordered={false} color="#050b16" bgColor="#ffffff" />
          </div>
          <p className="pt-muted pt-center">Scan this from the import screen of your VPN app.</p>
        </div>
      )}
    </div>
  );
}

function Account({ me, onSignOut }: { me: PortalMe; onSignOut: () => void }) {
  return (
    <div className="pt-account">
      <header className="pt-top">
        <a className="pt-brand" href={BRAND_SITE_URL} target="_blank" rel="noopener noreferrer">
          <AzurifyLogo size={36} />
          <span className="pt-brand-name">AZURIFY</span>
        </a>
        <div className="pt-top-right">
          <span className="pt-muted pt-email">{me.email}</span>
          <button type="button" className="pt-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <UsageCard me={me} />

      <Glass>
        <div className="pt-card-head">
          <h2>Your connection</h2>
        </div>
        {me.links.length === 0 ? (
          <p className="pt-muted">No connection has been set up for this account yet.</p>
        ) : (
          me.links.map((link, index) => (
            <LinkCard key={`${link.url}-${index}`} link={link} defaultOpen={index === 0} />
          ))
        )}
        <ol className="pt-steps">
          <li>Install one of the apps below.</li>
          <li>Open it and tap the add / import button.</li>
          <li>Choose “from clipboard” after copying the link, or scan the QR code.</li>
          <li>Select the new profile and connect.</li>
        </ol>
      </Glass>

      {me.apps.length > 0 && (
        <Glass>
          <div className="pt-card-head">
            <h2>Get the app</h2>
          </div>
          <div className="pt-apps">
            {me.apps.map((app) => (
              <a key={app.id} className="pt-app" href={app.url} target="_blank" rel="noopener noreferrer">
                <span className="pt-app-name">{app.name}</span>
                <span className="pt-muted">{app.platform}</span>
                <span className="pt-app-cta">Download ↗</span>
              </a>
            ))}
          </div>
        </Glass>
      )}

      <Footer />
    </div>
  );
}

export default function PortalPage() {
  const [view, setView] = useState<View>('loading');
  const [me, setMe] = useState<PortalMe | null>(null);

  const apply = useCallback((result: PortalMe | null | undefined) => {
    if (result) {
      setMe(result);
      setView('account');
    } else if (result === null) {
      setMe(null);
      setView('login');
    } else {
      setView((current) => (current === 'loading' ? 'login' : current));
    }
  }, []);

  const load = useCallback(() => fetchMe().then(apply), [apply]);

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    if (view !== 'account') return undefined;
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [view, load]);

  async function signOut() {
    try {
      await portalFetch('api/logout', { method: 'POST' });
    } finally {
      setMe(null);
      setView('login');
    }
  }

  return (
    <main className="pt-root">
      <div className="pt-bg" aria-hidden="true">
        <span className="pt-orb pt-orb-a" />
        <span className="pt-orb pt-orb-b" />
        <span className="pt-orb pt-orb-c" />
        <span className="pt-floor" />
      </div>
      <div className="pt-stage">
        {view === 'loading' && <div className="pt-spinner" aria-label="Loading" />}
        {view === 'login' && (
          <>
            <LoginForm onSignedIn={() => void load()} />
            <Footer />
          </>
        )}
        {view === 'account' && me && <Account me={me} onSignOut={() => void signOut()} />}
      </div>
    </main>
  );
}
