// Stub component for case assignments - not yet implemented

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
  onAssignmentChange: (newAssignments: CaseAssignment[]) => void
  compact?: boolean
}

export default function CaseAssignmentDropdown({
  casePath: _casePath,
  assignments,
  teamMembers: _teamMembers,
  userEmail: _userEmail,
  canAssign: _canAssign,
  onAssignmentChange: _onAssignmentChange,
  compact: _compact,
}: CaseAssignmentDropdownProps) {
  // Suppress unused variable warnings for stub
  void _casePath
  void _teamMembers
  void _userEmail
  void _canAssign
  void _onAssignmentChange
  void _compact

  // Show assigned count or dash if none
  const assignedCount = assignments.length

  return (
    <span className="text-xs text-brand-400">
      {assignedCount > 0 ? `${assignedCount} assigned` : '—'}
    </span>
  )
}
