import type { Marketplace, MarketplaceForm, ApiKey, ApiKeyCreateForm } from '../lib/types'
import { formatDate } from '../lib/utils'
import { emptyMpForm } from '../lib/constants'

interface Props {
  marketplaces: Marketplace[]
  marketplaceCode: string
  marketplaceForm: MarketplaceForm
  marketplaceBusy: boolean
  apiKeys: ApiKey[]
  apiKeyForm: ApiKeyCreateForm
  apiKeyBusy: boolean
  generatedKey: string | null
  onMarketplacePick: (code: string) => void
  onMarketplaceFormChange: (form: MarketplaceForm) => void
  onMarketplaceCodeChange: (code: string) => void
  onSaveMarketplace: () => void
  onApiKeyFormChange: (form: ApiKeyCreateForm) => void
  onCreateApiKey: () => void
  onRevokeApiKey: (keyId: string, reason: string) => void
  onGeneratedKeyChange: (key: string | null) => void
  notify: (type: 'success' | 'error', text: string) => void
}

export function MarketplaceTab({
  marketplaces,
  marketplaceCode,
  marketplaceForm,
  marketplaceBusy,
  apiKeys,
  apiKeyForm,
  apiKeyBusy,
  generatedKey,
  onMarketplacePick,
  onMarketplaceFormChange,
  onMarketplaceCodeChange,
  onSaveMarketplace,
  onApiKeyFormChange,
  onCreateApiKey,
  onRevokeApiKey,
  onGeneratedKeyChange,
  notify,
}: Props) {
  return (
    <section className="panel">
      <h2>Evidence marketplace</h2>
      <p className="muted">Správa napojených bazarů, settlement účtů a revshare.</p>

      <div className="gridTwo">
        <div>
          <h3>Seznam</h3>
          <div className="marketplaceList">
            {marketplaces.map((m) => (
              <button key={m.id} className={marketplaceCode === m.code ? 'active' : ''} onClick={() => onMarketplacePick(m.code)}>
                <strong>{m.name}</strong>
                <span className="muted">{m.code} · {m.feeSharePercent}%</span>
              </button>
            ))}
            {marketplaces.length === 0 && <p className="hint">Žádné marketplace.</p>}
          </div>
        </div>

        <div>
          <h3>{marketplaceCode ? 'Editovat' : 'Nový marketplace'}</h3>
          <div className="formGrid">
            <label>Code<input value={marketplaceForm.code} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></label>
            <label>Name<input value={marketplaceForm.name} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, name: e.target.value })} /></label>
            <h4 style={{ marginBottom: '4px', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', gridColumn: '1 / -1' }}>⚙️ Provozní údaje</h4>
            <label>Fee share %<input type="number" min={0} max={100} step={0.1} value={marketplaceForm.feeSharePercent} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, feeSharePercent: e.target.value })} /></label>
            <label>Settlement account name<input value={marketplaceForm.settlementAccountName} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, settlementAccountName: e.target.value })} /></label>
            <label>Settlement IBAN<input value={marketplaceForm.settlementIban} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, settlementIban: e.target.value })} /></label>
            <label>Settlement BIC<input value={marketplaceForm.settlementBic} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, settlementBic: e.target.value })} /></label>
          </div>
          <h4 style={{ marginTop: '20px', marginBottom: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '16px', color: '#6b7280', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📧 E-mail branding</h4>
          <div className="formGrid">
            <label>Logo URL<input value={marketplaceForm.logoUrl} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, logoUrl: e.target.value })} placeholder="https://..." /></label>
            <label>Accent barva<input type="color" value={marketplaceForm.accentColor} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, accentColor: e.target.value })} style={{ height: '38px' }} /></label>
            <label>Název firmy<input value={marketplaceForm.companyName} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, companyName: e.target.value })} placeholder="Firma s.r.o." /></label>
            <label>Adresa firmy<input value={marketplaceForm.companyAddress} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, companyAddress: e.target.value })} placeholder="Ulice 123, 110 00 Praha" /></label>
            <label>IČO / DIČ<input value={marketplaceForm.companyId} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, companyId: e.target.value })} placeholder="12345678" /></label>
            <label>Kontaktní email<input type="email" value={marketplaceForm.supportEmail} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, supportEmail: e.target.value })} placeholder="info@example.cz" /></label>
            <label>Web<input type="url" value={marketplaceForm.websiteUrl} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, websiteUrl: e.target.value })} placeholder="https://example.cz" /></label>
          </div>
          <label>Notes<textarea value={marketplaceForm.notes} onChange={(e) => onMarketplaceFormChange({ ...marketplaceForm, notes: e.target.value })} rows={3} /></label>
          <div className="rowActions">
            <button className="btn btnPrimary" onClick={onSaveMarketplace} disabled={marketplaceBusy}>
              {marketplaceBusy ? 'Ukládám...' : 'Uložit marketplace'}
            </button>
            <button className="btn btnSecondary" onClick={() => { onMarketplaceCodeChange(''); onMarketplaceFormChange({ ...emptyMpForm }) }}>
              Nový záznam
            </button>
          </div>
        </div>
      </div>

      <hr className="sectionDivider" />

      <h2>API klíče {marketplaceCode ? `- ${marketplaceCode}` : ''}</h2>
      {!marketplaceCode && <p className="hint">Vyber marketplace vlevo pro správu klíčů.</p>}

      {marketplaceCode && (
        <>
          <div className="apiKeysTable">
            <table>
              <thead>
                <tr>
                  <th>Prefix</th><th>Label</th><th>Scopes</th><th>Stav</th><th>Poslední použití</th><th>Expirace</th><th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys
                  .filter((k) => {
                    const mp = marketplaces.find((m) => m.code === marketplaceCode)
                    return mp && k.marketplaceId === mp.id
                  })
                  .map((k) => (
                    <tr key={k.id} className={k.revokedAt ? 'revoked' : ''}>
                      <td><code>{k.keyPrefix}***</code></td>
                      <td>{k.label || '-'}</td>
                      <td className="scopesList">{k.scopes.join(', ')}</td>
                      <td>{k.revokedAt ? '🔴 Zrušen' : k.active ? '🟢 Aktivní' : '⚪ Neaktivní'}</td>
                      <td>{k.lastUsedAt ? formatDate(k.lastUsedAt) : 'Nikdy'}</td>
                      <td>{k.expiresAt ? formatDate(k.expiresAt) : 'Bez expirace'}</td>
                      <td>
                        {!k.revokedAt && (
                          <button className="btn btnDanger btnSm" onClick={() => { const reason = prompt('Důvod zrušení klíče:'); if (reason !== null) onRevokeApiKey(k.id, reason) }}>
                            Revoke
                          </button>
                        )}
                        {k.revokedAt && <span className="muted">{k.revokedReason || '-'}</span>}
                      </td>
                    </tr>
                  ))}
                {apiKeys.filter((k) => {
                  const mp = marketplaces.find((m) => m.code === marketplaceCode)
                  return mp && k.marketplaceId === mp.id
                }).length === 0 && (
                  <tr><td colSpan={7} className="hint">Žádné API klíče pro tento marketplace.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h3>Vygenerovat nový klíč</h3>
          <div className="formGrid">
            <label>Label<input value={apiKeyForm.label} onChange={(e) => onApiKeyFormChange({ ...apiKeyForm, label: e.target.value })} placeholder="Production key" /></label>
            <label>Scopes (čárkou)<input value={apiKeyForm.scopes} onChange={(e) => onApiKeyFormChange({ ...apiKeyForm, scopes: e.target.value })} /></label>
            <label>Expirace (dny, prázdné = bez)<input type="number" min={1} value={apiKeyForm.expiresInDays} onChange={(e) => onApiKeyFormChange({ ...apiKeyForm, expiresInDays: e.target.value })} /></label>
          </div>
          <div className="rowActions">
            <button className="btn btnPrimary" onClick={onCreateApiKey} disabled={apiKeyBusy}>
              {apiKeyBusy ? 'Generuji...' : '🔑 Vygenerovat API klíč'}
            </button>
          </div>

          {generatedKey && (
            <div className="generatedKeyBox">
              <p><strong>⚠️ Nový klíč - zkopíruj ho teď, nebude znovu zobrazen!</strong></p>
              <code className="generatedKeyValue">{generatedKey}</code>
              <button className="btn btnSecondary btnSm" onClick={() => { void navigator.clipboard.writeText(generatedKey); notify('success', 'Zkopírováno!') }}>📋 Kopírovat</button>
              <button className="btn btnGhost btnSm" onClick={() => onGeneratedKeyChange(null)}>Zavřít</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
