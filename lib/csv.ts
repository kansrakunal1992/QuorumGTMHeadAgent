// lib/csv.ts
// Minimal CSV parser — handles quoted fields with embedded commas, good
// enough for Apollo/Sales-Navigator style exports. Not a full RFC 4180
// implementation (no embedded newlines inside quoted fields).

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const splitLine = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    cells.push(current.trim())
    return cells
  }

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

// Tolerant mapping across common Apollo/Sales Navigator export column names.
function pick(row: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    if (row[k]) return row[k]
  }
  return null
}

export interface ImportedRow {
  name: string
  company: string | null
  role: string | null
  geography: string | null
  email: string | null
  linkedin_url: string | null
}

export function mapCsvRowToProspect(row: Record<string, string>): ImportedRow | null {
  const first = pick(row, 'first name', 'firstname')
  const last = pick(row, 'last name', 'lastname')
  const fullName = pick(row, 'name', 'full name') ?? [first, last].filter(Boolean).join(' ')
  if (!fullName) return null

  return {
    name: fullName,
    company: pick(row, 'company', 'company name', 'organization'),
    role: pick(row, 'title', 'job title', 'position'),
    geography:
      pick(row, 'location') ??
      ([row['city'], row['state'], row['country']]
        .filter(Boolean)
        .join(', ') || null),
    email: pick(row, 'email', 'email address', 'work email'),
    linkedin_url: pick(row, 'person linkedin url', 'linkedin url', 'linkedin'),
  }
}
