import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUpRightFromSquare,
  faPen,
  faUser,
} from '@fortawesome/free-solid-svg-icons'
import LogoutButton from '~/components/LogoutButton'
import DeleteAccountButton from '~/components/DeleteAccountButton'
import { Spinner } from '~/components/Skeletons'
import { toast } from '~/components/Toaster'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { getPublicConfig } from '~/lib/config'
import { championIconUrl, useDDragonVersion } from '~/lib/ddragon'
import { announceProfileUpdate } from '~/lib/profileCache'
import { championDisplayName } from '~/lib/skinName'
import { btnChip } from '~/lib/ui'
import type { Me, UpdateMeRequest } from '~/lib/types'

// Mirrors the server's rule (handlers.go usernamePattern): letters, numbers,
// underscores; no leading number; 3-30 characters.
const USERNAME_RE = /^[A-Za-z_][A-Za-z0-9_]{2,29}$/
const USERNAME_HINT =
  '3-30 characters: letters, numbers, underscores. Cannot start with a number.'

const sectionLabel = 'text-xs uppercase tracking-widest text-grey1 mb-1'

// The whole Account card: avatar, username, email, sign-in & security link,
// logout, and the danger zone. `me` is null when /me failed - the card then
// just shows less, same as before.
export default function AccountSettings({
  me,
  onChange,
}: {
  me: Me | null
  onChange: (me: Me) => void
}) {
  const { withApiToken } = useAuth()

  // Shared PATCH /api/me helper: updates the tab's state and the header
  // button's cache, leaves error handling (toasts vs inline) to the caller.
  const saveProfile = async (body: UpdateMeRequest): Promise<Me> => {
    const updated = await withApiToken((token) => api.updateMe(body, token))
    onChange(updated)
    announceProfileUpdate({
      username: updated.username,
      avatarChampionId: updated.avatar_champion_id,
    })
    return updated
  }

  return (
    <div className="animate-fade-up w-full max-w-md bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8">
      {me && <AvatarSection me={me} save={saveProfile} />}
      {me?.username && <UsernameSection me={me} save={saveProfile} />}

      <div className="mb-8">
        <div className={sectionLabel}>Email</div>
        <div className="text-lg text-gold1 font-serif break-all">
          {me?.email}
        </div>
      </div>

      <SecuritySection />

      <LogoutButton />

      <div className="mt-8 border-t border-red-400/20 pt-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-red-300/80">
          Danger zone
        </p>
        <p className="mb-4 text-sm text-grey1">
          Deleting your account permanently removes your stars and bans.
        </p>
        <DeleteAccountButton />
      </div>
    </div>
  )
}

// ─── username ───────────────────────────────────────────────────────────────

function UsernameSection({
  me,
  save,
}: {
  me: Me
  save: (body: UpdateMeRequest) => Promise<Me>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const trimmed = draft.trim()
  const valid = USERNAME_RE.test(trimmed)
  const showHint = editing && trimmed !== '' && !valid

  const startEditing = () => {
    setDraft(me.username)
    setEditing(true)
  }

  const submit = async () => {
    if (!valid || saving) return
    if (trimmed === me.username) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await save({ username: trimmed })
      toast('Username updated', 'success')
      setEditing(false)
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Couldn't update your username",
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-5">
      <div className={sectionLabel}>Username</div>
      {editing ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              disabled={saving}
              maxLength={30}
              aria-label="New username"
              className="h-10 min-w-0 flex-1 bg-hextech-black/60 px-3 font-serif text-lg text-gold1 outline outline-icon/40 -outline-offset-1 focus:outline-gold2/60"
            />
            <button
              onClick={submit}
              disabled={!valid || saving}
              className={`${btnChip} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {saving ? <Spinner className="h-4 w-4" /> : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className={btnChip}
            >
              Cancel
            </button>
          </div>
          <p
            className={`mt-2 text-xs ${showHint ? 'text-red-300' : 'text-grey1'}`}
          >
            {USERNAME_HINT}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="text-lg text-gold1 font-serif">{me.username}</div>
          <button
            onClick={startEditing}
            aria-label="Change username"
            title="Change username"
            className="cursor-pointer text-grey1 transition duration-150 hover:text-gold1"
          >
            <FontAwesomeIcon icon={faPen} className="h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── avatar ─────────────────────────────────────────────────────────────────

interface PickerChampion {
  id: string
  name: string
}

function AvatarSection({
  me,
  save,
}: {
  me: Me
  save: (body: UpdateMeRequest) => Promise<Me>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [champions, setChampions] = useState<PickerChampion[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const ddVersion = useDDragonVersion()

  const openPicker = async () => {
    setPickerOpen(true)
    if (champions) return
    try {
      setLoadError(false)
      // The public champion list (same payload the catalog pages use); the
      // picker only needs id → display name.
      const champs = await api.champions()
      setChampions(
        champs
          .map((c) => ({ id: c.id, name: championDisplayName(c.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    } catch {
      setLoadError(true)
    }
  }

  const pick = async (championId: string | '') => {
    if (saving) return
    setSaving(true)
    try {
      await save({ avatarChampionId: championId })
      toast(championId === '' ? 'Avatar removed' : 'Avatar updated', 'success')
      setPickerOpen(false)
      setQuery('')
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Couldn't update your avatar",
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  const avatarUrl =
    me.avatar_champion_id && ddVersion
      ? championIconUrl(me.avatar_champion_id, ddVersion)
      : null
  const q = query.trim().toLowerCase()
  const filtered =
    champions?.filter((c) => !q || c.name.toLowerCase().includes(q)) ?? []

  return (
    <div className="mb-5">
      <div className={sectionLabel}>Avatar</div>
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${championDisplayName(me.avatar_champion_id!)} avatar`}
            className="h-16 w-16 outline outline-gold5/60 -outline-offset-1"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center bg-hextech-black/60 outline outline-icon/30 -outline-offset-1">
            <FontAwesomeIcon icon={faUser} className="h-6 text-grey1" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
            className={btnChip}
          >
            {pickerOpen ? 'Close' : 'Change'}
          </button>
          {me.avatar_champion_id && (
            <button
              onClick={() => pick('')}
              disabled={saving}
              className={btnChip}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="mt-4 bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search champions…"
            aria-label="Search champions"
            className="mb-3 h-10 w-full bg-hextech-black/60 px-3 text-sm text-gold1 outline outline-icon/40 -outline-offset-1 placeholder:text-grey1/60 focus:outline-gold2/60"
          />
          {loadError ? (
            <p className="py-4 text-sm text-red-300">
              Couldn't load the champion list. Try again in a moment.
            </p>
          ) : !champions || !ddVersion ? (
            <div className="flex items-center gap-3 py-4 text-sm text-grey1">
              <Spinner className="h-4 w-4" />
              Loading champions…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-sm text-grey1">No champions match.</p>
          ) : (
            <div className="grid max-h-64 grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-6">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c.id)}
                  disabled={saving}
                  title={c.name}
                  aria-label={`Use ${c.name} as avatar`}
                  className={`aspect-square cursor-pointer outline -outline-offset-1 transition duration-150 hover:outline-gold2 disabled:cursor-not-allowed ${
                    c.id === me.avatar_champion_id
                      ? 'outline-gold2'
                      : 'outline-icon/30'
                  }`}
                >
                  <img
                    src={championIconUrl(c.id, ddVersion)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── sign-in & security ─────────────────────────────────────────────────────

// Password, passkeys, and MFA live in Logto, not in app code - link out to
// its hosted Account Center security page ({endpoint}/account/security,
// Logto ≥1.39; see DEPLOY.md for the console toggles that enable each
// section). The bare /account base path deliberately renders Logto's
// not-found page, so the link must target the security page itself.
function SecuritySection() {
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
