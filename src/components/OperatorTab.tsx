import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface OperatorSettings {
  companyName: string
  companyAddress: string
  companyId: string
  companyVatId: string
  logoUrl: string
  accentColor: string
  supportEmail: string
  websiteUrl: string
}

const EMPTY: OperatorSettings = {
  companyName: '',
  companyAddress: '',
  companyId: '',
  companyVatId: '',
  logoUrl: '',
  accentColor: '#2563eb',
  supportEmail: '',
  websiteUrl: '',
}

interface Props {
  notify: (type: 'success' | 'error', text: string) => void
}

export function OperatorTab({ notify }: Props) {
  const [form, setForm] = useState<OperatorSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('dpt_settings')
        .select('value')
        .eq('key', 'operator')
        .maybeSingle()

      if (error) throw error
      if (data?.value) {
        const v = data.value as Partial<OperatorSettings>
        setForm({ ...EMPTY, ...v })
      }
    } catch (err) {
      notify('error', `Nepodařilo se načíst údaje provozovatele: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('dpt_settings')
        .upsert(
          {
            key: 'operator',
            value: form,
            description: 'Údaje o provozovateli Depozitky (zobrazují se v patičce všech emailů)',
          },
          { onConflict: 'key' },
        )

      if (error) throw error
      notify('success', 'Údaje provozovatele uloženy ✅')
    } catch (err) {
      notify('error', `Uložení selhalo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      notify('error', 'Maximální velikost loga je 2 MB')
      return
    }

    setUploading(true)
    try {
      // Unique filename to bust caches
      const ext = file.name.split('.').pop() || 'png'
      const fileName = `logo-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('dpt-operator')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        })

      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('dpt-operator').getPublicUrl(fileName)
      if (!pub?.publicUrl) throw new Error('Nepodařilo se získat veřejnou URL')

      setForm((prev) => ({ ...prev, logoUrl: pub.publicUrl }))
      notify('success', 'Logo nahráno — nezapomeň uložit změny')
    } catch (err) {
      notify('error', `Upload loga selhal: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <h2>Provozovatel</h2>
        <p className="muted">Načítám…</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>Provozovatel Depozitky</h2>
      <p className="muted">
        Tyto údaje a logo se zobrazují v patičce všech emailů z Depozitky bez ohledu na to, ze kterého bazaru transakce pochází.
      </p>

      <div className="formGrid" style={{ marginTop: 16 }}>
        <label>
          Název firmy
          <input
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="Depozitka s.r.o."
          />
        </label>
        <label>
          IČO
          <input
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            placeholder="12345678"
          />
        </label>
        <label>
          DIČ
          <input
            value={form.companyVatId}
            onChange={(e) => setForm({ ...form, companyVatId: e.target.value })}
            placeholder="CZ12345678"
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          Adresa firmy
          <input
            value={form.companyAddress}
            onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
            placeholder="Ulice 123, 110 00 Praha"
          />
        </label>
        <label>
          Support email
          <input
            type="email"
            value={form.supportEmail}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
            placeholder="podpora@depozitka.eu"
          />
        </label>
        <label>
          Web
          <input
            value={form.websiteUrl}
            onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
            placeholder="https://depozitka.eu"
          />
        </label>
        <label>
          Accent barva
          <input
            type="color"
            value={form.accentColor || '#2563eb'}
            onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
            style={{ height: 38 }}
          />
        </label>
        <label>
          Logo (URL)
          <input
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://..."
          />
        </label>
      </div>

      <div style={{ marginTop: 20, padding: 16, border: '1px dashed #d1d5db', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 8px' }}>Nahrát logo</h4>
        <p className="muted" style={{ marginTop: 0 }}>
          PNG, JPG, SVG nebo WebP. Max 2 MB. Po uploadu nezapomeň uložit změny.
        </p>
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={handleLogoUpload}
          disabled={uploading}
        />
        {uploading && <span className="muted" style={{ marginLeft: 12 }}>Nahrávám…</span>}
        {form.logoUrl && (
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ marginBottom: 6 }}>Náhled:</p>
            <img
              src={form.logoUrl}
              alt="Logo provozovatele"
              style={{ maxWidth: 240, maxHeight: 80, background: '#fff', padding: 8, border: '1px solid #e5e7eb', borderRadius: 4 }}
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
        <button type="button" className="btn btnPrimary" onClick={save} disabled={saving}>
          {saving ? 'Ukládám…' : 'Uložit změny'}
        </button>
        <button type="button" className="btn" onClick={load} disabled={saving}>
          Načíst znovu
        </button>
      </div>
    </section>
  )
}
