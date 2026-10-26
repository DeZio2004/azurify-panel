import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { QRCode } from 'antd';

import { AzurifyLogo } from '@/components/brand/AzurifyLogo';
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
    <form className="pt-card pt-login" onSubmit={submit}>
      <div className="pt-brand">
        <AzurifyLogo size={56} />
        <span className="pt-brand-name">AZURIFY</span>
      </div>
      <h1 className="pt-title">Check your account</h1>
      <p className="pt-muted">Sign in with the username and password you were given.</p>
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
      <button className="pt-btn pt-btn-primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
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
    <section className="pt-card">
      <div className="pt-card-head">
        <h2>Usage</h2>
        <span className={`pt-badge ${good ? 'pt-badge-ok' : 'pt-badge-bad'}`}>{status}</span>
      </div>
      <div className="pt-usage-main">
        <span className="pt-usage-used">{formatBytes(used)}</span>
        <span className="pt-muted">{unlimited ? 'used · unlimited data' : `of ${formatBytes(me.total)}`}</span>
      </div>
      {!unlimited && (
        <div className="pt-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`pt-bar-fill${percent >= 90 ? ' pt-bar-warn' : ''}`} style={{ width: `${percent}%` }} />
        </div>
      )}
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
    </section>
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
          <QRCode value={link.url} type="svg" size={236} bordered={false} color="#050b16" bgColor="#ffffff" />
          <p className="pt-muted">Scan this from the import screen of your VPN app.</p>
        </div>
      )}
    </div>
  );
}

function Account({ me, onSignOut }: { me: PortalMe; onSignOut: () => void }) {
  return (
    <div className="pt-account">
      <header className="pt-top">
        <div className="pt-brand">
          <AzurifyLogo size={34} />
          <span className="pt-brand-name">AZURIFY</span>
        </div>
        <div className="pt-top-right">
          <span className="pt-muted pt-email">{me.email}</span>
          <button type="button" className="pt-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <UsageCard me={me} />

      <section className="pt-card">
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
      </section>

      {me.apps.length > 0 && (
        <section className="pt-card">
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
        </section>
      )}
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
      {view === 'loading' && <div className="pt-spinner" aria-label="Loading" />}
      {view === 'login' && <LoginForm onSignedIn={() => void load()} />}
      {view === 'account' && me && <Account me={me} onSignOut={() => void signOut()} />}
    </main>
  );
}
