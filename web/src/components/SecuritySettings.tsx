// Native sign-in & security management on the profile page, replacing the
// link-out to Logto's hosted Account Center. Talks to the Account API
// directly (lib/accountApi.ts): password set/change, primary-email change,
// and Discord/Google linking - each gated by an identity proof (password or
// email code) per Logto's verification model. Passkeys and 2FA stay on the
// hosted security page for now.

import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { Spinner } from '~/components/Skeletons'
import { toast } from '~/components/Toaster'
import { useAuth } from '~/lib/useAuth'
import { getPublicConfig } from '~/lib/config'
import { btnChip } from '~/lib/ui'
import {
  accountApi,
  type AccountApiError,
  type AccountInfo,
  type SocialConnector,
} from '~/lib/accountApi'
import {
  randomState,
  saveSocialLinkStash,
} from '~/lib/socialLink'

const sectionLabel = 'text-xs uppercase tracking-widest text-grey1 mb-1'
const inputClass =
  'h-10 w-full bg-hextech-black/60 px-3 text-sm text-gold1 outline outline-icon/40 -outline-offset-1 placeholder:text-grey1/60 focus:outline-gold2/60'

// Identity-proof records live ~10 minutes server-side; reuse one across
// operations but refresh comfortably before the edge.
const PROOF_TTL_MS = 9 * 60 * 1000

type Proof = { id: string; expiresAt: number }

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export default function SecuritySettings() {
  const { getAccountToken } = useAuth()
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  )
  const [connectors, setConnectors] = useState<SocialConnector[]>([])
  // Which row's flow is expanded; one at a time keeps the card calm.
  const [open, setOpen] = useState<string | null>(null)
  const proofRef = useRef<Proof | null>(null)

  const reload = useCallback(async () => {
    const token = await getAccountToken()
    if (!token) {
      setStatus('unavailable')
      return
    }
    try {
      setAccount(await accountApi.me(token))
      setStatus('ready')
    } catch {
      // Most likely the Account Center isn't enabled on the Logto instance
      // (DEPLOY.md) - fall back to the hosted-page link below.
      setStatus('unavailable')
    }
  }, [getAccountToken])

  useEffect(() => {
    void reload()
    void fetch('/account-connectors')
      .then((res) => (res.ok ? res.json() : { connectors: [] }))
      .then((data: { connectors: SocialConnector[] }) =>
        setConnectors(data.connectors),
      )
      .catch(() => setConnectors([]))
  }, [reload])

  const cachedProof = (): string | null => {
    const p = proofRef.current
    return p && p.expiresAt > Date.now() ? p.id : null
  }
  const storeProof = (id: string) => {
    proofRef.current = { id, expiresAt: Date.now() + PROOF_TTL_MS }
  }

  if (status === 'loading') {
    return (
      <div className="mb-8">
        <div className={sectionLabel}>Sign-in & security</div>
        <div className="flex items-center gap-3 py-2 text-sm text-grey1">
          <Spinner className="h-4 w-4" />
          Loading…
        </div>
      </div>
    )
  }

  if (status === 'unavailable' || !account) {
    return <HostedFallback />
  }

  // A grant from before UserScope.Identities was added can't read or manage
  // connected accounts - the API simply omits the field. Only a fresh
  // sign-in upgrades the grant.
  const staleGrant = account.identities === undefined

  return (
    <div className="mb-8">
      <div className={sectionLabel}>Sign-in & security</div>

      {'primaryEmail' in account && (
        <EmailRow
          account={account}
          open={open === 'email'}
          setOpen={(v) => setOpen(v ? 'email' : null)}
          getToken={getAccountToken}
          cachedProof={cachedProof}
          storeProof={storeProof}
          onDone={reload}
        />
      )}

      {account.hasPassword !== undefined && (
        <PasswordRow
          account={account}
          open={open === 'password'}
          setOpen={(v) => setOpen(v ? 'password' : null)}
          getToken={getAccountToken}
          cachedProof={cachedProof}
          storeProof={storeProof}
          onDone={reload}
        />
      )}

      <div className="mt-4">
        <div className="mb-2 text-sm text-grey1">Connected accounts</div>
        {staleGrant ? (
          <p className="text-sm text-grey1">
            Sign out and back in to manage connected accounts.
          </p>
        ) : connectors.length === 0 ? (
          <p className="text-sm text-grey1">No social connectors available.</p>
        ) : (
          connectors.map((c) => (
            <SocialRow
              key={c.id}
              connector={c}
              account={account}
              open={open === `social:${c.target}`}
              setOpen={(v) => setOpen(v ? `social:${c.target}` : null)}
              getToken={getAccountToken}
              cachedProof={cachedProof}
              storeProof={storeProof}
              onDone={reload}
            />
          ))
        )}
      </div>

      <HostedSecurityLink />
    </div>
  )
}

// ─── verify identity (shared) ───────────────────────────────────────────────

// Produces the verification record id that privileged operations send in
// the logto-verification-id header. Password check when one exists, email
// code to the current address otherwise.
function VerifyIdentityPanel({
  account,
  getToken,
  onVerified,
  onCancel,
}: {
  account: AccountInfo
  getToken: () => Promise<string | null>
  onVerified: (proofId: string) => void
  onCancel: () => void
}) {
  const hasPassword = account.hasPassword === true
  const email = account.primaryEmail ?? null
  const [mode, setMode] = useState<'password' | 'code'>(
    hasPassword ? 'password' : 'code',
  )
  const [password, setPassword] = useState('')
  const [codeSent, setCodeSent] = useState<string | null>(null) // record id
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!hasPassword && !email) {
    // Nothing to verify against. Setting a password is allowed without
    // proof in exactly this state, so point there.
    return (
      <p className="mt-2 text-sm text-grey1">
        Set a password first - with no password or email on the account,
        there's nothing to verify you with yet.
      </p>
    )
  }

  const submitPassword = async () => {
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      const rec = await accountApi.verifyPassword(token, password)
      onVerified(rec.verificationRecordId)
    } catch (err) {
      setError(
        (err as AccountApiError).status === 422 ||
          (err as AccountApiError).status === 401
          ? 'Incorrect password.'
          : errMessage(err, "Couldn't verify your password."),
      )
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    if (!email || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      const rec = await accountApi.requestEmailCode(token, email)
      setCodeSent(rec.verificationRecordId)
    } catch (err) {
      setError(errMessage(err, "Couldn't send the code."))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (!email || !codeSent || !code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      const rec = await accountApi.verifyEmailCode(
        token,
        email,
        codeSent,
        code.trim(),
      )
      onVerified(rec.verificationRecordId)
    } catch (err) {
      setError(errMessage(err, "That code didn't work."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-1">
      <p className="mb-3 text-sm text-grey1">
        First, let's verify it's you.
      </p>

      {mode === 'password' ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
              autoFocus
              disabled={busy}
              placeholder="Current password"
              aria-label="Current password"
              className={inputClass}
            />
            <button
              onClick={submitPassword}
              disabled={!password || busy}
              className={btnChip}
            >
              {busy ? <Spinner className="h-4 w-4" /> : 'Verify'}
            </button>
            <button onClick={onCancel} disabled={busy} className={btnChip}>
              Cancel
            </button>
          </div>
          {email && (
            <button
              onClick={() => {
                setMode('code')
                setError('')
              }}
              className="mt-2 cursor-pointer text-xs text-grey1 underline-offset-2 hover:text-gold1 hover:underline"
            >
              Email me a code instead
            </button>
          )}
        </div>
      ) : (
        <div>
          {!codeSent ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={sendCode} disabled={busy} className={btnChip}>
                {busy ? <Spinner className="h-4 w-4" /> : `Send code to ${email}`}
              </button>
              <button onClick={onCancel} disabled={busy} className={btnChip}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitCode()}
                autoFocus
                disabled={busy}
                inputMode="numeric"
                placeholder="6-digit code"
                aria-label="Verification code"
                className={inputClass}
              />
              <button
                onClick={submitCode}
                disabled={!code.trim() || busy}
                className={btnChip}
              >
                {busy ? <Spinner className="h-4 w-4" /> : 'Verify'}
              </button>
              <button onClick={onCancel} disabled={busy} className={btnChip}>
                Cancel
              </button>
            </div>
          )}
          {hasPassword && (
            <button
              onClick={() => {
                setMode('password')
                setError('')
              }}
              className="mt-2 cursor-pointer text-xs text-grey1 underline-offset-2 hover:text-gold1 hover:underline"
            >
              Use my password instead
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  )
}

// Wraps a row's privileged action: runs it straight away when a fresh proof
// is cached, otherwise shows VerifyIdentityPanel first.
function ProofGate({
  account,
  getToken,
  cachedProof,
  storeProof,
  children,
}: {
  account: AccountInfo
  getToken: () => Promise<string | null>
  cachedProof: () => string | null
  storeProof: (id: string) => void
  children: (proofId: string) => React.ReactNode
}) {
  const [proofId, setProofId] = useState<string | null>(cachedProof)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) return null
  if (proofId) return <>{children(proofId)}</>
  return (
    <VerifyIdentityPanel
      account={account}
      getToken={getToken}
      onVerified={(id) => {
        storeProof(id)
        setProofId(id)
      }}
      onCancel={() => setCancelled(true)}
    />
  )
}

// ─── email ──────────────────────────────────────────────────────────────────

function EmailRow({
  account,
  open,
  setOpen,
  getToken,
  cachedProof,
  storeProof,
  onDone,
}: RowProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-grey1">Email</div>
          <div className="break-all font-serif text-lg text-gold1">
            {account.primaryEmail ?? 'Not set'}
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className={btnChip}>
          {open ? 'Close' : account.primaryEmail ? 'Change' : 'Add'}
        </button>
      </div>
      {open && (
        <ProofGate
          account={account}
          getToken={getToken}
          cachedProof={cachedProof}
          storeProof={storeProof}
        >
          {(proofId) => (
            <EmailEditor
              getToken={getToken}
              proofId={proofId}
              onDone={() => {
                setOpen(false)
                onDone()
              }}
            />
          )}
        </ProofGate>
      )}
    </div>
  )
}

function EmailEditor({
  getToken,
  proofId,
  onDone,
}: {
  getToken: () => Promise<string | null>
  proofId: string
  onDone: () => void
}) {
  const [email, setEmail] = useState('')
  const [sentRecord, setSentRecord] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trimmed = email.trim()
  const plausible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)

  const sendCode = async () => {
    if (!plausible || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      const rec = await accountApi.requestEmailCode(token, trimmed)
      setSentRecord(rec.verificationRecordId)
    } catch (err) {
      setError(errMessage(err, "Couldn't send the code."))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!sentRecord || !code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      const verified = await accountApi.verifyEmailCode(
        token,
        trimmed,
        sentRecord,
        code.trim(),
      )
      await accountApi.setPrimaryEmail(
        token,
        trimmed,
        proofId,
        verified.verificationRecordId,
      )
      toast('Email updated', 'success')
      onDone()
    } catch (err) {
      setError(errMessage(err, "Couldn't update your email."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-1">
      {!sentRecord ? (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCode()}
            autoFocus
            disabled={busy}
            placeholder="New email address"
            aria-label="New email address"
            className={inputClass}
          />
          <button
            onClick={sendCode}
            disabled={!plausible || busy}
            className={btnChip}
          >
            {busy ? <Spinner className="h-4 w-4" /> : 'Send code'}
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-grey1">
            We sent a code to <span className="text-gold1">{trimmed}</span>.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
              disabled={busy}
              inputMode="numeric"
              placeholder="6-digit code"
              aria-label="Verification code"
              className={inputClass}
            />
            <button
              onClick={submit}
              disabled={!code.trim() || busy}
              className={btnChip}
            >
              {busy ? <Spinner className="h-4 w-4" /> : 'Confirm'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  )
}

// ─── password ───────────────────────────────────────────────────────────────

function PasswordRow({
  account,
  open,
  setOpen,
  getToken,
  cachedProof,
  storeProof,
  onDone,
}: RowProps) {
  const hasPassword = account.hasPassword === true
  // The only state Logto lets you set a password WITHOUT proving identity
  // first: nothing on the account to prove it with.
  const proofFree = !hasPassword && !account.primaryEmail

  const editor = (proofId: string | undefined) => (
    <PasswordEditor
      getToken={getToken}
      proofId={proofId}
      onDone={() => {
        setOpen(false)
        onDone()
      }}
    />
  )

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-grey1">Password</div>
          <div className="font-serif text-lg text-gold1">
            {hasPassword ? '••••••••' : 'Not set'}
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className={btnChip}>
          {open ? 'Close' : hasPassword ? 'Change' : 'Set'}
        </button>
      </div>
      {open &&
        (proofFree ? (
          editor(undefined)
        ) : (
          <ProofGate
            account={account}
            getToken={getToken}
            cachedProof={cachedProof}
            storeProof={storeProof}
          >
            {(proofId) => editor(proofId)}
          </ProofGate>
        ))}
    </div>
  )
}

function PasswordEditor({
  getToken,
  proofId,
  onDone,
}: {
  getToken: () => Promise<string | null>
  proofId: string | undefined
  onDone: () => void
}) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mismatch = confirm !== '' && pw !== confirm
  const ready = pw.length >= 8 && pw === confirm

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      await accountApi.setPassword(token, pw, proofId)
      toast('Password updated', 'success')
      onDone()
    } catch (err) {
      // 422 carries Logto's password-policy explanation - show it.
      setError(errMessage(err, "Couldn't update your password."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-1">
      <div className="flex flex-col gap-2">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          disabled={busy}
          placeholder="New password (8+ characters)"
          aria-label="New password"
          className={inputClass}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={busy}
          placeholder="Repeat new password"
          aria-label="Repeat new password"
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <button onClick={submit} disabled={!ready || busy} className={btnChip}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Save password'}
          </button>
          {mismatch && (
            <span className="text-sm text-red-300">Passwords don't match.</span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  )
}

// ─── social connectors ──────────────────────────────────────────────────────

function SocialRow({
  connector,
  account,
  open,
  setOpen,
  getToken,
  cachedProof,
  storeProof,
  onDone,
}: RowProps & { connector: SocialConnector }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const linked = !!account.identities?.[connector.target]

  const start = async (proofId: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Please sign in again.')
      if (linked) {
        if (
          !window.confirm(
            `Disconnect ${connector.name}? You'll no longer be able to sign in with it.`,
          )
        ) {
          setOpen(false)
          return
        }
        await accountApi.unlinkIdentity(token, connector.target, proofId)
        toast(`${connector.name} disconnected`, 'success')
        setOpen(false)
        onDone()
      } else {
        const state = randomState()
        const redirectUri = `${window.location.origin}/social-callback`
        const rec = await accountApi.startSocialVerification(
          token,
          connector.id,
          redirectUri,
          state,
        )
        saveSocialLinkStash({
          verificationRecordId: rec.verificationRecordId,
          state,
          proofId,
          redirectUri,
          target: connector.target,
          name: connector.name,
        })
        window.location.assign(rec.authorizationUri)
      }
    } catch (err) {
      setError(
        errMessage(
          err,
          linked
            ? `Couldn't disconnect ${connector.name}.`
            : `Couldn't connect ${connector.name}.`,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-3 bg-hextech-black/30 px-3 py-2 outline outline-icon/20 -outline-offset-1">
        <div className="flex min-w-0 items-center gap-3">
          {connector.logo && (
            <img src={connector.logo} alt="" className="h-5 w-5" />
          )}
          <span className="font-serif text-gold1">{connector.name}</span>
          {linked && (
            <span className="text-xs uppercase tracking-widest text-gold2">
              Connected
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(!open)}
          disabled={busy}
          className={btnChip}
        >
          {busy ? (
            <Spinner className="h-4 w-4" />
          ) : open ? (
            'Close'
          ) : linked ? (
            'Disconnect'
          ) : (
            'Connect'
          )}
        </button>
      </div>
      {open && (
        <ProofGate
          account={account}
          getToken={getToken}
          cachedProof={cachedProof}
          storeProof={storeProof}
        >
          {(proofId) => <StartOnProof run={() => start(proofId)} />}
        </ProofGate>
      )}
      {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
    </div>
  )
}

// Social link/unlink has no extra form of its own - once the proof exists
// the action fires immediately, exactly once.
function StartOnProof({ run }: { run: () => void }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    run()
  }, [run])
  return (
    <div className="mt-2 flex items-center gap-3 py-1 text-sm text-grey1">
      <Spinner className="h-4 w-4" />
      Working…
    </div>
  )
}

// ─── shared bits ────────────────────────────────────────────────────────────

interface RowProps {
  account: AccountInfo
  open: boolean
  setOpen: (open: boolean) => void
  getToken: () => Promise<string | null>
  cachedProof: () => string | null
  storeProof: (id: string) => void
  onDone: () => void
}

// Passkeys & 2FA still live on the hosted security page; social linking
// there is broken (unregistered OAuth redirect URI), but those two work.
function HostedSecurityLink() {
  const endpoint = getPublicConfig().logtoEndpoint
  if (!endpoint) return null
  return (
    <a
      href={`${endpoint.replace(/\/$/, '')}/account/security`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-flex items-center gap-2 text-sm text-grey1 underline-offset-2 hover:text-gold1 hover:underline"
    >
      Passkeys &amp; two-step verification
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3" />
    </a>
  )
}

// Shown when the Account API isn't reachable (e.g. the Account Center
// toggle is off on the Logto instance) - the old link-out, so nothing is
// lost.
function HostedFallback() {
  const endpoint = getPublicConfig().logtoEndpoint
  if (!endpoint) return null
  return (
    <div className="mb-8">
      <div className={sectionLabel}>Sign-in & security</div>
      <p className="mb-3 text-sm text-grey1">
        Password, passkeys, and two-step verification are managed on our
        sign-in service.
      </p>
      <a
        href={`${endpoint.replace(/\/$/, '')}/account/security`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${btnChip} inline-flex items-center gap-2`}
      >
        Manage sign-in &amp; security
        <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3" />
      </a>
    </div>
  )
}
