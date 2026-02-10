export interface PacketDocument {
  path: string
  title: string
  date: string | null
  type: string
  fileName: string
  pinned: boolean
  order: number
  hasWarning: boolean
  warningReason?: string
}

export interface PacketFrontMatter {
  claimantName: string
  claimNumber: string
  hearingNumber: string
  hearingDateTime: string
  appearance: string
  introductoryCounselLine: string
  serviceDate: string
  serviceMethod: string
  recipients: string[]
  firmBlockLines: string[]
}

export interface PacketPiiResult {
  path: string
  findings: Array<{ page: number; kind: 'dob' | 'ssn'; preview: string }>
  approved: boolean
}

export interface PacketState {
  documents: PacketDocument[]
  frontMatter: PacketFrontMatter
  piiResults: PacketPiiResult[]
  piiScanned: boolean
  generatedAt: string | null
  outputPath: string | null
  draftId: string | null
  draftName?: string
}
