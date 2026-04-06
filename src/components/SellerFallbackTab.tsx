import type { Transaction, SellerPayoutForm } from '../lib/types'
import { statusLabel } from '../lib/constants'

interface Props {
  transactions: Transaction[]
  form: SellerPayoutForm
  busy: boolean
  onFormChange: (form: SellerPayoutForm) => void
  onSave: () => void
}

export function SellerFallbackTab({ transactions, form, busy, onFormChange, onSave }: Props) {
  return (
    <section className="panel">
      <h2>Seller payout fallback</h2>
      <p className="muted">Použij, když marketplace neposlal payout účet při create transaction. Po stavu "paid" je účet zamčený.</p>

      <div className="formGrid">
        <label>
          Transakce
          <select value={form.transactionCode} onChange={(e) => {
            const code = e.target.value
            const tx = transactions.find((t) => t.transactionCode === code)
            onFormChange(tx ? { transactionCode: tx.transactionCode, iban: tx.sellerPayoutIban, accountName: tx.sellerPayoutAccountName, bic: tx.sellerPayoutBic } : { transactionCode: code, iban: '', accountName: '', bic: '' })
          }}>
            <option value="">Vyber transakci</option>
            {transactions.map((tx) => (
              <option key={tx.id} value={tx.transactionCode}>
                {tx.transactionCode} · {tx.sellerName} · {statusLabel[tx.status]} {tx.sellerPayoutLockedAt ? '🔒' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>IBAN<input value={form.iban} onChange={(e) => onFormChange({ ...form, iban: e.target.value })} /></label>
        <label>Account name<input value={form.accountName} onChange={(e) => onFormChange({ ...form, accountName: e.target.value })} /></label>
        <label>BIC<input value={form.bic} onChange={(e) => onFormChange({ ...form, bic: e.target.value })} /></label>
      </div>

      <div className="rowActions">
        <button className="btn btnPrimary" onClick={onSave} disabled={busy || !form.transactionCode || !form.iban}>
          {busy ? 'Ukládám...' : 'Uložit payout účet'}
        </button>
      </div>
    </section>
  )
}
