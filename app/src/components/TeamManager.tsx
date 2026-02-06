import { useEffect, useState } from 'react'

type TeamRole = 'attorney' | 'case_manager_lead' | 'case_manager' | 'case_manager_assistant'

interface TeamMember {
  id: string
  email: string
  role: TeamRole
  status: 'pending' | 'active' | 'deactivated'
}

interface TeamInvite {
  id: string
  email: string
  role: TeamRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedAt: string
  expiresAt?: string
}

interface TeamPayload {
  configured: boolean
  team?: {
    members: TeamMember[]
    invites: TeamInvite[]
  }
}

interface TeamManagerProps {
  apiUrl: string
  firmRoot: string
  userEmail: string
  canManageTeam: boolean
  onClose: () => void
}

const roleOptions: Array<{ value: TeamRole; label: string }> = [
  { value: 'attorney', label: 'Attorney' },
  { value: 'case_manager_lead', label: 'Case Manager Lead' },
  { value: 'case_manager', label: 'Case Manager' },
  { value: 'case_manager_assistant', label: 'Case Manager Assistant' },
]

export default function TeamManager({
  apiUrl,
  firmRoot,
  userEmail,
  canManageTeam,
  onClose: _onClose,
}: TeamManagerProps) {
  void _onClose

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<TeamRole>('case_manager')
  const [isInviting, setIsInviting] = useState(false)

  const mapError = (raw: string): string => {
    const code = raw.toLowerCase()
    const map: Record<string, string> = {
      only_root_account_can_invite: 'Only the root user can invite staff for this firm.',
      root_auth_required: 'Root authentication is required before inviting staff.',
      license_limit_reached: 'License limit reached for this firm. Increase max licenses in admin.',
      domain_mismatch: 'Invite email must match the same domain as the root account.',
      remote_invite_unreachable: 'Could not contact remote auth server. Try again.',
      remote_invite_failed: 'Remote invite failed. Try again.',
    }
    return map[code] || raw
  }

  const loadTeam = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/team?root=${encodeURIComponent(firmRoot)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load team')
      }
      const data = await res.json() as TeamPayload
      setMembers(data.team?.members || [])
      setInvites((data.team?.invites || []).filter(i => i.status === 'pending'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadTeam()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmRoot])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return

    setIsInviting(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/team/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, inviteEmail: email, role: inviteRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(mapError(data.error || 'Could not send invite'))
      }
      setInviteEmail('')
      await loadTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invite')
    } finally {
      setIsInviting(false)
    }
  }

  const handleRevokeInvite = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/team/invite/${encodeURIComponent(id)}?root=${encodeURIComponent(firmRoot)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not revoke invite')
      }
      await loadTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke invite')
    }
  }

  const handleRoleChange = async (memberId: string, role: TeamRole) => {
    try {
      const res = await fetch(`${apiUrl}/api/team/member/${encodeURIComponent(memberId)}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not update role')
      }
      await loadTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role')
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-brand-500">Loading team...</div>
  }

  return (
    <div className="p-6 space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-brand-800">Current User</h3>
        <p className="text-sm text-brand-600 mt-1">{userEmail}</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-brand-800 mb-2">Team Members</h3>
        <div className="space-y-2">
          {members.length === 0 && (
            <p className="text-sm text-brand-500">No team members yet.</p>
          )}
          {members.map((member) => (
            <div key={member.id} className="rounded-lg border border-surface-200 bg-white px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-brand-800">{member.email}</p>
                <p className="text-xs text-brand-500 capitalize">{member.status}</p>
              </div>
              {canManageTeam ? (
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value as TeamRole)}
                  className="text-xs border border-surface-300 rounded-md px-2 py-1 bg-white"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-brand-600">
                  {roleOptions.find((opt) => opt.value === member.role)?.label || member.role}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManageTeam && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-brand-800 mb-2">Invite User</h3>
            <form onSubmit={handleInvite} className="flex flex-wrap gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@firm.com"
                className="flex-1 min-w-[220px] border border-surface-300 rounded-md px-3 py-2 text-sm"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                className="border border-surface-300 rounded-md px-2 py-2 text-sm bg-white"
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isInviting}
                className="px-3 py-2 text-sm bg-brand-900 text-white rounded-md hover:bg-brand-800 disabled:opacity-60"
              >
                {isInviting ? 'Inviting...' : 'Invite'}
              </button>
            </form>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-brand-800 mb-2">Pending Invites</h3>
            <div className="space-y-2">
              {invites.length === 0 && (
                <p className="text-sm text-brand-500">No pending invites.</p>
              )}
              {invites.map((invite) => (
                <div key={invite.id} className="rounded-lg border border-surface-200 bg-white px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-brand-800">{invite.email}</p>
                    <p className="text-xs text-brand-500">
                      {roleOptions.find((option) => option.value === invite.role)?.label || invite.role}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
