import { useMemo, useState } from 'react'

interface CaseAssignment {
  userId: string
  assignedAt: string
  assignedBy: string
}

interface TeamMember {
  id: string
  email: string
  name?: string
}

interface CaseAssignmentDropdownProps {
  casePath: string
  assignments: CaseAssignment[]
  teamMembers: TeamMember[]
  userEmail: string
  canAssign: boolean
  onAssignmentChange: (newAssignments: CaseAssignment[]) => Promise<void> | void
  compact?: boolean
}

export default function CaseAssignmentDropdown({
  casePath: _casePath,
  assignments,
  teamMembers,
  userEmail,
  canAssign,
  onAssignmentChange,
  compact,
}: CaseAssignmentDropdownProps) {
  void _casePath

  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const assignedSet = useMemo(() => new Set(assignments.map((a) => a.userId)), [assignments])

  const selectedCount = assignments.length

  const handleToggleMember = async (memberId: string) => {
    if (!canAssign || isSaving) return

    const now = new Date().toISOString()
    const nextAssignments = assignedSet.has(memberId)
      ? assignments.filter((assignment) => assignment.userId !== memberId)
      : [
          ...assignments,
          {
            userId: memberId,
            assignedAt: now,
            assignedBy: userEmail.toLowerCase(),
          },
        ]

    setIsSaving(true)
    try {
      await onAssignmentChange(nextAssignments)
    } finally {
      setIsSaving(false)
    }
  }

  if (compact && !canAssign) {
    return (
      <span className="text-xs text-brand-400">
        {selectedCount > 0 ? `${selectedCount} assigned` : '—'}
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        disabled={!canAssign || isSaving}
        className={`text-xs rounded-md border px-2 py-1 transition-colors ${
          canAssign
            ? 'border-surface-300 text-brand-700 bg-white hover:bg-surface-50'
            : 'border-surface-200 text-brand-400 bg-surface-50 cursor-not-allowed'
        }`}
      >
        {selectedCount > 0 ? `${selectedCount} assigned` : 'Assign'}
      </button>

      {open && canAssign && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-surface-200 bg-white shadow-lg p-2">
          <p className="px-2 py-1 text-xs font-medium text-brand-600">Assign Team Members</p>
          <div className="max-h-52 overflow-y-auto">
            {teamMembers.map((member) => (
              <label key={member.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-brand-700 hover:bg-surface-50 rounded">
                <input
                  type="checkbox"
                  checked={assignedSet.has(member.id)}
                  onChange={() => handleToggleMember(member.id)}
                  disabled={isSaving}
                />
                <span>{member.name || member.email}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-md bg-brand-900 text-white text-xs py-1.5 hover:bg-brand-800"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
