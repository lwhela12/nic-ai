export interface PacketDocument {
  pageSelection: {
    allPages: boolean
    pageRanges: string
  }
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
  templateId?: string
  signerName?: string
  issueOnAppeal?: string
  extraSectionValues?: Record<string, string>
  captionValues?: Record<string, string>
}

export interface PacketPiiResult {
  path: string
  findings: Array<{ page: number; kind: 'dob' | 'ssn'; preview: string }>
  boxes?: PacketRedactionBox[]
  warnings?: string[]
  scanned?: boolean
  approved: boolean
}

export interface PacketRedactionBox {
  id: string
  page: number
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
  selected: boolean
  source: 'detected' | 'text' | 'draw'
  kind?: 'dob' | 'ssn'
  preview?: string
}

export interface PacketState {
  documents: PacketDocument[]
  frontMatter: PacketFrontMatter
  frontMatterPreviewBaseline: PacketFrontMatter | null
  frontMatterPreviewDocumentsSignature: string | null
  piiResults: PacketPiiResult[]
  piiScanned: boolean
  generatedAt: string | null
  outputPath: string | null
  frontMatterDocxPath: string | null
  frontMatterWorkingDocxPath: string | null
  frontMatterWorkingDocxMtime: number | null
  draftId: string | null
  draftName?: string
}
