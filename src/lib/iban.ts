/**
 * Czech bank account → IBAN conversion (no BigInt).
 */

export function czechAccountToIban(accountNumber: string, bankCode: string): string | null {
  const cleanBank = bankCode.replace(/\s/g, "").replace(/^0+/, "") || "0"
  let prefix = "0"
  let number = accountNumber.replace(/\s/g, "")

  if (number.includes("-")) {
    const parts = number.split("-")
    if (parts.length !== 2) return null
    prefix = parts[0] || "0"
    number = parts[1]
  }

  if (!/^\d{1,4}$/.test(cleanBank)) return null
  if (!/^\d{0,6}$/.test(prefix)) return null
  if (!/^\d{1,10}$/.test(number)) return null

  const paddedBank = cleanBank.padStart(4, "0")
  const paddedPrefix = prefix.padStart(6, "0")
  const paddedNumber = number.padStart(10, "0")

  const bban = paddedBank + paddedPrefix + paddedNumber
  const numericString = bban + "123500"
  const checkDigits = 98 - mod97(numericString)
  const checkStr = checkDigits.toString().padStart(2, "0")

  return `CZ${checkStr}${bban}`
}

export function isValidCzechIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, "").toUpperCase()
  if (!/^CZ\d{22}$/.test(clean)) return false
  const rearranged = clean.substring(4) + clean.substring(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => (ch.charCodeAt(0) - 55).toString())
  return mod97(numeric) === 1
}

export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim()
}

function mod97(numStr: string): number {
  let remainder = 0
  for (let i = 0; i < numStr.length; i++) {
    remainder = (remainder * 10 + Number(numStr[i])) % 97
  }
  return remainder
}

// Czech banks
export const CZECH_BANKS: { code: string; name: string }[] = [
  { code: "0100", name: "Komerční banka" },
  { code: "0300", name: "ČSOB" },
  { code: "0600", name: "MONETA Money Bank" },
  { code: "0710", name: "Česká národní banka" },
  { code: "0800", name: "Česká spořitelna" },
  { code: "2010", name: "Fio banka" },
  { code: "2020", name: "CREDITAS" },
  { code: "2060", name: "Citfin" },
  { code: "2070", name: "Moravský Peněžní Ústav" },
  { code: "2100", name: "Hypoteční banka" },
  { code: "2200", name: "Citfin" },
  { code: "2220", name: "Artesa" },
  { code: "2240", name: "Poštovní spořitelna" },
  { code: "2250", name: "Banka CREDITAS" },
  { code: "2260", name: "NEY spořitelní družstvo" },
  { code: "2600", name: "Citibank" },
  { code: "2700", name: "UniCredit Bank" },
  { code: "3030", name: "Air Bank" },
  { code: "3050", name: "BNP Paribas" },
  { code: "3500", name: "ING Bank" },
  { code: "4000", name: "Max banka" },
  { code: "4300", name: "Národní rozvojová banka" },
  { code: "5500", name: "Raiffeisenbank" },
  { code: "5800", name: "J&T Banka" },
  { code: "6000", name: "PPF banka" },
  { code: "6100", name: "Equa bank" },
  { code: "6200", name: "COMMERZBANK" },
  { code: "6210", name: "mBank" },
  { code: "6700", name: "Všeobecná úverová banka" },
  { code: "7910", name: "Deutsche Bank" },
  { code: "7950", name: "Raiffeisen stavební spořitelna" },
  { code: "7960", name: "ČSOB stavební spořitelna" },
  { code: "7970", name: "Modrá pyramida" },
  { code: "7990", name: "Oberbank" },
  { code: "8030", name: "Volksbank Raiffeisenbank" },
  { code: "8040", name: "Oberbank" },
  { code: "8060", name: "Stavební spořitelna ČS" },
  { code: "8090", name: "Česká exportní banka" },
  { code: "8150", name: "HSBC" },
  { code: "8200", name: "PRIVAT BANK" },
  { code: "8215", name: "TRINITY BANK" },
  { code: "8230", name: "MUFG Bank" },
  { code: "8240", name: "Družstevní záložna Kredit" },
  { code: "8250", name: "Bank of China" },
]
