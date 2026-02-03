import { useEffect, useRef } from 'react'

interface ContactInfo {
  phone?: string
  email?: string
  address?: {
    street?: string
    city?: string
    state?: string
    zip?: string
  }
}

interface PolicyLimitDetail {
  carrier?: string
  bodily_injury?: string
  medical_payments?: string
  um_uim?: string
  property_damage?: string
}

interface PolicyLimits {
  '1P'?: PolicyLimitDetail
  '3P'?: PolicyLimitDetail
  [key: string]: PolicyLimitDetail | string | undefined
}

interface HealthInsurance {
  carrier?: string
  group_no?: string
  member_no?: string
}

interface ClaimNumbers {
  '1P_AAA'?: string
  '3P_Progressive'?: string
  [key: string]: string | undefined
}

interface ContactCardProps {
  isOpen: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  clientName?: string
  dob?: string
  contact?: ContactInfo
  policyLimits?: PolicyLimits | string
  healthInsurance?: HealthInsurance
  claimNumbers?: ClaimNumbers
}

// Icons
const UserIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
)

const PhoneIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
  </svg>
)

const EmailIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
)

const MapPinIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
)

const ShieldIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
)

const HeartIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
  </svg>
)

export default function ContactCard({
  isOpen,
  onClose,
  anchorRef,
  clientName,
  dob,
  contact,
  policyLimits,
  healthInsurance,
  claimNumbers,
}: ContactCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        cardRef.current &&
        !cardRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, anchorRef])

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Parse policy limits - canonical schema: { "1P": { um_uim, bodily_injury }, "3P": { bodily_injury } }
  const parsePolicyLimits = () => {
    if (!policyLimits) return { thirdParty: null, firstParty: null }

    let limits = policyLimits
    // Handle JSON strings (legacy data)
    if (typeof limits === 'string') {
      if (limits.startsWith('{')) {
        try {
          limits = JSON.parse(limits)
        } catch {
          return { thirdParty: limits, firstParty: null }
        }
      } else {
        return { thirdParty: limits, firstParty: null }
      }
    }

    // Extract from canonical nested structure
    const p3 = (limits as any)['3P'] || (limits as any)['3p']
    const p1 = (limits as any)['1P'] || (limits as any)['1p']

    const thirdParty = p3?.bodily_injury || p3?.bi || null
    // For 1P, prefer UIM (what matters in PI claims) over BI
    const firstParty = p1?.um_uim || p1?.bodily_injury || p1?.bi || null

    return { thirdParty, firstParty }
  }

  const { thirdParty, firstParty } = parsePolicyLimits()

  // Get claim numbers
  const getClaimNumber = (prefix: string) => {
    if (!claimNumbers) return null
    // Find a claim number that starts with the prefix (case-insensitive)
    for (const [key, value] of Object.entries(claimNumbers)) {
      if (key.toLowerCase().startsWith(prefix.toLowerCase()) && value) {
        return value
      }
    }
    return null
  }

  const claim3P = getClaimNumber('3P')
  const claim1P = getClaimNumber('1P')

  // Format address
  const formatAddress = () => {
    if (!contact?.address) return null
    const { street, city, state, zip } = contact.address
    if (!street && !city && !state && !zip) return null

    const line1 = street || ''
    const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '')

    return { line1, line2 }
  }

  const address = formatAddress()

  return (
    <div
      ref={cardRef}
      className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-elevated border border-surface-200 z-50 overflow-hidden"
    >
      {/* Header with client name */}
      <div className="bg-brand-50 px-4 py-3 border-b border-surface-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
            <UserIcon />
          </div>
          <div>
            <h3 className="font-medium text-brand-900">{clientName || 'Unknown Client'}</h3>
            {dob && (
              <p className="text-sm text-brand-500">DOB: {dob}</p>
            )}
          </div>
        </div>
      </div>

      {/* Contact Section */}
      {(contact?.phone || contact?.email || address) && (
        <div className="px-4 py-3 border-b border-surface-200">
          <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">Contact</h4>
          <div className="space-y-2">
            {contact?.phone && (
              <a
                href={`tel:${contact.phone.replace(/\D/g, '')}`}
                className="flex items-center gap-2 text-sm text-brand-700 hover:text-accent-600 transition-colors"
              >
                <PhoneIcon />
                <span>{contact.phone}</span>
              </a>
            )}
            {contact?.email && (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-2 text-sm text-brand-700 hover:text-accent-600 transition-colors"
              >
                <EmailIcon />
                <span>{contact.email}</span>
              </a>
            )}
            {address && (
              <div className="flex items-start gap-2 text-sm text-brand-700">
                <MapPinIcon />
                <div>
                  {address.line1 && <div>{address.line1}</div>}
                  {address.line2 && <div>{address.line2}</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Insurance Section */}
      {(thirdParty || firstParty) && (
        <div className="px-4 py-3 border-b border-surface-200">
          <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ShieldIcon />
            Insurance
          </h4>
          <div className="space-y-2">
            {thirdParty && (
              <div className="bg-surface-50 rounded-lg p-2.5">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-brand-500">3rd Party</span>
                  {claim3P && <span className="text-xs text-brand-400">#{claim3P}</span>}
                </div>
                <p className="text-sm font-medium text-brand-800 mt-0.5">{thirdParty}</p>
              </div>
            )}
            {firstParty && (
              <div className="bg-surface-50 rounded-lg p-2.5">
                <div className="flex justify-between items-start">
                  <span className="text-xs text-brand-500">1st Party UIM</span>
                  {claim1P && <span className="text-xs text-brand-400">#{claim1P}</span>}
                </div>
                <p className="text-sm font-medium text-brand-800 mt-0.5">{firstParty}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Health Insurance Section */}
      {healthInsurance?.carrier && (
        <div className="px-4 py-3">
          <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <HeartIcon />
            Health Insurance
          </h4>
          <div className="bg-surface-50 rounded-lg p-2.5">
            <p className="text-sm font-medium text-brand-800">{healthInsurance.carrier}</p>
            {(healthInsurance.group_no || healthInsurance.member_no) && (
              <div className="mt-1 text-xs text-brand-500 space-y-0.5">
                {healthInsurance.group_no && <div>Group: {healthInsurance.group_no}</div>}
                {healthInsurance.member_no && <div>Member: {healthInsurance.member_no}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state if no data */}
      {!contact?.phone && !contact?.email && !address && !thirdParty && !firstParty && !healthInsurance?.carrier && (
        <div className="px-4 py-6 text-center text-sm text-brand-400">
          No contact or insurance information available.
          <br />
          <span className="text-xs">Re-index the case to extract this data.</span>
        </div>
      )}
    </div>
  )
}
