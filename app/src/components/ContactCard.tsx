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

interface EmployerInfo {
  name?: string
  address?: { street?: string; city?: string; state?: string; zip?: string } | string
  phone?: string
  contact_name?: string
}

interface WCCarrierInfo {
  name?: string
  carrier?: string
  claim_number?: string
  adjuster_name?: string
  adjuster?: string
  adjuster_phone?: string
  adjuster_email?: string
  tpa_name?: string
  tpa?: string
}

interface DisabilityStatusInfo {
  type?: string
  amw?: number
  compensation_rate?: number
  mmi_date?: string
  ppd_rating?: number
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
  practiceArea?: string
  employer?: EmployerInfo
  wcCarrier?: WCCarrierInfo
  disabilityStatus?: DisabilityStatusInfo
  jobTitle?: string
  bodyParts?: string[]
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

const BriefcaseIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
)

const BuildingOfficeIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
  </svg>
)

const ClipboardDocumentCheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 011.65 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
  </svg>
)

// Format an address object into display lines
const formatAddressObj = (addr?: { street?: string; city?: string; state?: string; zip?: string } | string | null): { line1: string; line2: string } | null => {
  if (!addr) return null

  // Handle string addresses (legacy from merge-index)
  if (typeof addr === 'string') {
    return addr.trim() ? { line1: addr.trim(), line2: '' } : null
  }

  const { street, city, state, zip } = addr
  if (!street && !city && !state && !zip) return null

  const line1 = street || ''
  const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '')

  return { line1, line2 }
}

// Format a number as USD currency
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
}

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
  practiceArea,
  employer,
  wcCarrier,
  disabilityStatus,
  jobTitle,
  bodyParts,
}: ContactCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const isWC = practiceArea === "Workers' Compensation"

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

  const address = formatAddressObj(contact?.address)

  // WC field checks
  const wcCarrierName = wcCarrier?.name || wcCarrier?.carrier
  const wcAdjusterName = wcCarrier?.adjuster_name || wcCarrier?.adjuster
  const wcTpaName = wcCarrier?.tpa_name || wcCarrier?.tpa
  const hasEmployer = !!employer?.name
  const hasWCCarrier = !!(wcCarrierName || wcCarrier?.claim_number)
  const hasDisability = !!(disabilityStatus?.type || disabilityStatus?.amw || disabilityStatus?.compensation_rate)
  const hasJobOrInjury = !!(jobTitle || (bodyParts && bodyParts.length > 0))

  // Determine empty state
  const hasContactData = !!(contact?.phone || contact?.email || address)
  const hasPIData = !!(thirdParty || firstParty || healthInsurance?.carrier)
  const hasWCData = !!(hasEmployer || hasWCCarrier || hasDisability || hasJobOrInjury)
  const hasAnyData = hasContactData || (isWC ? hasWCData : hasPIData)

  const employerAddress = formatAddressObj(employer?.address)

  return (
    <div
      ref={cardRef}
      className={`absolute top-full right-0 mt-2 ${isWC ? 'w-96' : 'w-80'} bg-white rounded-xl shadow-elevated border border-surface-200 z-50 overflow-hidden`}
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
      {hasContactData && (
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

      {/* === PI Sections === */}
      {!isWC && (
        <>
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
        </>
      )}

      {/* === WC Sections === */}
      {isWC && (
        <>
          {/* Employer Section */}
          {hasEmployer && (
            <div className="px-4 py-3 border-b border-surface-200">
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <BriefcaseIcon />
                Employer
              </h4>
              <div className="bg-surface-50 rounded-lg p-2.5">
                <p className="text-sm font-medium text-brand-800">{employer!.name}</p>
                {employer!.phone && (
                  <a
                    href={`tel:${employer!.phone.replace(/\D/g, '')}`}
                    className="flex items-center gap-1.5 mt-1 text-xs text-brand-600 hover:text-accent-600 transition-colors"
                  >
                    <PhoneIcon />
                    <span>{employer!.phone}</span>
                  </a>
                )}
                {employer!.contact_name && (
                  <div className="mt-1 text-xs text-brand-500">Contact: {employer!.contact_name}</div>
                )}
                {employerAddress && (
                  <div className="mt-1 text-xs text-brand-500">
                    {employerAddress.line1 && <div>{employerAddress.line1}</div>}
                    {employerAddress.line2 && <div>{employerAddress.line2}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WC Carrier Section */}
          {hasWCCarrier && (
            <div className="px-4 py-3 border-b border-surface-200">
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <BuildingOfficeIcon />
                WC Carrier
              </h4>
              <div className="bg-surface-50 rounded-lg p-2.5">
                {wcCarrierName && (
                  <p className="text-sm font-medium text-brand-800">{wcCarrierName}</p>
                )}
                {wcCarrier?.claim_number && (
                  <div className="mt-1 text-xs text-brand-500">Claim #: {wcCarrier.claim_number}</div>
                )}
                {wcAdjusterName && (
                  <div className="mt-1 text-xs text-brand-500">Adjuster: {wcAdjusterName}</div>
                )}
                {wcCarrier?.adjuster_phone && (
                  <a
                    href={`tel:${wcCarrier.adjuster_phone.replace(/\D/g, '')}`}
                    className="block mt-0.5 text-xs text-brand-500 hover:text-accent-600 transition-colors ml-0"
                  >
                    {wcCarrier.adjuster_phone}
                  </a>
                )}
                {wcTpaName && (
                  <div className="mt-1 text-xs text-brand-500">TPA: {wcTpaName}</div>
                )}
              </div>
            </div>
          )}

          {/* Disability Status Section */}
          {hasDisability && (
            <div className="px-4 py-3 border-b border-surface-200">
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ClipboardDocumentCheckIcon />
                Disability Status
              </h4>
              <div className="bg-surface-50 rounded-lg p-2.5">
                {disabilityStatus!.type && (
                  <span className="inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-brand-100 text-brand-700">
                    {disabilityStatus!.type}
                  </span>
                )}
                <div className="mt-1.5 text-xs text-brand-500 space-y-0.5">
                  {disabilityStatus!.amw != null && disabilityStatus!.amw > 0 && (
                    <div>AMW: {formatCurrency(disabilityStatus!.amw)}</div>
                  )}
                  {disabilityStatus!.compensation_rate != null && disabilityStatus!.compensation_rate > 0 && (
                    <div>Comp Rate: {formatCurrency(disabilityStatus!.compensation_rate)}/wk</div>
                  )}
                  {disabilityStatus!.mmi_date && (
                    <div>MMI Date: {disabilityStatus!.mmi_date}</div>
                  )}
                  {disabilityStatus!.ppd_rating != null && disabilityStatus!.ppd_rating > 0 && (
                    <div>PPD Rating: {disabilityStatus!.ppd_rating}%</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Job & Injury Section */}
          {hasJobOrInjury && (
            <div className="px-4 py-3">
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">Job & Injury</h4>
              {jobTitle && (
                <p className="text-sm text-brand-700 mb-1.5">{jobTitle}</p>
              )}
              {bodyParts && bodyParts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {bodyParts.map((part) => (
                    <span
                      key={part}
                      className="inline-block px-2 py-0.5 text-xs rounded-full bg-surface-100 text-brand-600"
                    >
                      {part}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state if no data */}
      {!hasAnyData && (
        <div className="px-4 py-6 text-center text-sm text-brand-400">
          No contact or {isWC ? 'employer' : 'insurance'} information available.
          <br />
          <span className="text-xs">Re-index the case to extract this data.</span>
        </div>
      )}
    </div>
  )
}
