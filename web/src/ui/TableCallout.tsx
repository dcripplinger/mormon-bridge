interface TableCalloutProps {
  text: string | null
  tone: 'fanfare' | 'hint'
  top: string
}

/** Big momentary table text. No plate behind it. */
export default function TableCallout({ text, tone, top }: TableCalloutProps) {
  if (!text) return null
  return (
    <div
      className={`table-callout table-callout--${tone}`}
      style={{ top }}
      data-table-callout={tone}
    >
      {text}
    </div>
  )
}
