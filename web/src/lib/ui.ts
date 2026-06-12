// Shared className recipes - the single source of truth for button styles
// that repeat across pages. Edit here, not at each call site.

const btnBase =
  'inline-flex cursor-pointer items-center justify-center gap-3 font-serif font-bold outline -outline-offset-2 transition duration-150 disabled:cursor-not-allowed disabled:opacity-40'

const goldTone =
  'bg-gold5/20 text-gold1 outline-gold2/60 hover:bg-gold5/40 hover:outline-gold2'
const neutralTone =
  'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'

// Large gold call-to-action (hero sections, sign-in gates).
export const btnPrimary = `${btnBase} ${goldTone} px-8 py-4 text-lg shadow-lg`

// Medium gold CTA (empty states, error states).
export const btnPrimarySm = `${btnBase} ${goldTone} px-6 py-3`

// Large neutral action, sized to pair with btnPrimary.
export const btnSecondary = `${btnBase} ${neutralTone} px-8 py-4 text-lg`

// Medium neutral action, sized to pair with btnPrimarySm.
export const btnSecondarySm = `${btnBase} ${neutralTone} px-6 py-3`

// Compact toolbar-scale action (pagination, inline controls).
export const btnChip = `${btnBase} ${neutralTone} h-10 px-5 text-sm`

// Destructive action (delete account).
export const btnDanger = `${btnBase} bg-danger-surface/30 px-6 py-3 text-danger outline-danger-border/40 hover:bg-danger-surface/60 hover:outline-danger-border`
