---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Calculate settlement disbursement breakdown
---

# Settlement Calculator

Calculate the complete settlement disbursement showing all deductions and client recovery.

## Required Information

1. **Recovery Amounts**
   - Med-Pay recovery (1P) - check 1P folder for checks/confirmations
   - Settlement amount (3P) - check Settlement folder or correspondence

2. **Attorney Fee**
   - Check retainer agreement for percentage
   - Standard: 25% pre-litigation, 33-35% litigation
   - Note if fee is waived on Med-Pay (common)

3. **Case Expenses**
   - Filing fees, medical records costs, postage, etc.
   - Usually minimal ($15-100)

4. **Medical Liens**
   - Original bill amounts from Records & Bills
   - Reduction amounts from Reductions folder
   - Calculate amount due after reduction

## Settlement Memo Format

```markdown
# Settlement Memorandum

**Case:** [Case Number]    [Client Name]
**DOI:** [Date of Injury]
**Case Type:** MVA

---

## RECOVERY

| Source | Note | Amount |
|--------|------|--------|
| MEDPAY | [1P Insurer] | $X,XXX.XX |
| SETTLE | [3P Insurer] | $XX,XXX.XX |
| **Total Recovery** | | **$XX,XXX.XX** |

---

## DEDUCT AND RETAIN TO PAY MUSLUSKY LAW

### Attorney Fees

| Item | Note | Fee | Reduced | Due |
|------|------|-----|---------|-----|
| Muslusky Law | XX% | $X,XXX.XX | $0.00 | $X,XXX.XX |
| **Total Attorney Fees** | | | | **$X,XXX.XX** |

### Case Expenses

| Item | Date | Due |
|------|------|-----|
| Faxes, Copies, Scanning, mailings | [Date] | $XX.XX |
| **Total Case Expenses** | | **$XX.XX** |

---

## DEDUCT AND RETAIN TO PAY OTHERS

### Medical Liens

| Provider | Date | Total | Paid | Balance | Reduction | Due |
|----------|------|-------|------|---------|-----------|-----|
| [Provider 1] | [Date] | $X,XXX.XX | $0.00 | $X,XXX.XX | $XXX.XX | $X,XXX.XX |
| [Provider 2] | [Date] | $X,XXX.XX | $0.00 | $X,XXX.XX | $XXX.XX | $X,XXX.XX |
| **Total Liens Due** | | | | | | **$X,XXX.XX** |

---

## SUMMARY

| | Amount |
|---|--------|
| Total Recovery | $XX,XXX.XX |
| Less: Attorney Fees | ($X,XXX.XX) |
| Less: Case Expenses | ($XX.XX) |
| Less: Medical Liens | ($X,XXX.XX) |
| **Total Deductions** | **($XX,XXX.XX)** |
| **TOTAL AMOUNT DUE TO CLIENT** | **$XX,XXX.XX** |

---

I acknowledge that any known medical providers that have been written off,
partially or fully paid by my health insurance, my health insurance will be
reimbursed if noted above. I understand that any copay or medical bill(s) I
paid have contributed to the net settlement. I hereby approve the above
settlement and distribution of proceeds. I understand that any outstanding
medical expenses related to this case unknown or not listed in this settlement
memo will be my sole responsibility. Muslusky Law is only accountable for the
charges listed above.

Thank you for retaining MUSLUSKY LAW. It was our desire to deliver the best
possible results for you!

_________________________    _________________________
Date                         [Client Name]
```

## Output Location

Save to: `Settlement/Settlement Memo - DRAFT.md`

## Calculation Rules

1. **Attorney Fee Calculation**
   - Apply percentage to total recovery (Med-Pay + Settlement)
   - OR apply to settlement only if fee waived on Med-Pay
   - Check retainer for specific terms

2. **Lien Reduction Calculation**
   - Look for reduction letters in Reductions/ folder
   - If no reduction letter, use estimates: 30-50% depending on provider
   - Flag if reductions not yet negotiated

3. **Verification**
   - Sum of all deductions + client recovery MUST equal total recovery
   - If math doesn't balance, flag the error
