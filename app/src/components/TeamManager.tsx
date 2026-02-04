// Stub component for team management - not yet implemented

interface TeamManagerProps {
  firmRoot: string
  userEmail: string
  canManageTeam: boolean
  onClose: () => void
}

export default function TeamManager({
  firmRoot: _firmRoot,
  userEmail: _userEmail,
  canManageTeam: _canManageTeam,
  onClose: _onClose,
}: TeamManagerProps) {
  // Suppress unused variable warnings for stub
  void _firmRoot
  void _userEmail
  void _canManageTeam
  void _onClose

  return (
    <div className="p-6">
      <p className="text-brand-500 text-sm">
        Team management coming soon.
      </p>
    </div>
  )
}
