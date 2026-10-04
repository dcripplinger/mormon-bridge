import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'

interface HandViewProps {
  cards: Card[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  isActive: boolean
  /** Cards currently in the flight queue — held as empty slots until each lands. */
  inflightCardIds?: ReadonlySet<string>
  /** The flight currently animating — its empty slot is the DrawFlight landing target. */
  activeFlightCardId?: string
  /** Ref attached to the active flight placeholder so DrawFlight can measure the landing target. */
  endSlotRef?: React.RefObject<HTMLDivElement | null>
  /** Card that just landed — receives a brief scale-in animation. */
  landingCardId?: string
}

/** Fixed capacity — width only changes spacing, never row membership. */
export const CARDS_PER_ROW = 14
export const ROWS_PER_PAGE = 2
export const HAND_PAGE_SIZE = CARDS_PER_ROW * ROWS_PER_PAGE

const EMPTY_ID_SET: ReadonlySet<string> = new Set()

/** Front row covers 60% of the back row. */
const ROW_OVERLAP_PULL = 'calc(var(--card-h) * -0.6)'
/** Soft max gap between cards on a wide screen (px past card width = slight separation). */
const MAX_STEP_EXTRA = 6

function computeStep(availableWidth: number, cardW: number, count: number): number {
  if (count <= 1) return cardW
  const ideal = (availableWidth - cardW) / (count - 1)
  // Always fit the packing count; on wide screens stop at a small gap rather than stretching.
  return Math.min(cardW + MAX_STEP_EXTRA, Math.max(1, ideal))
}

function rowPixelWidth(cardW: number, step: number, count: number): number {
  if (count <= 0) return 0
  if (count === 1) return cardW
  return cardW + (count - 1) * step
}

interface HandRowProps {
  cards: Card[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  isActive: boolean
  inflightCardIds: ReadonlySet<string>
  activeFlightCardId?: string
  endSlotRef?: React.RefObject<HTMLDivElement | null>
  landingCardId?: string
  /** Base z-index for this row (front row should be higher). */
  zBase: number
  step: number
  cardW: number
}

function HandRow({
  cards,
  selectedIds,
  onToggle,
  isActive,
  inflightCardIds,
  activeFlightCardId,
  endSlotRef,
  landingCardId,
  zBase,
  step,
  cardW,
}: HandRowProps) {
  const pullIn = Math.max(0, cardW - step)

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        width: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {cards.map((card, index) => {
        const z = zBase + index + 1
        const marginLeft = index === 0 ? 0 : -pullIn

        // Still in flight (active or queued) — keep an empty slot of card size.
        if (inflightCardIds.has(card.id)) {
          return (
            <div
              key={card.id}
              ref={card.id === activeFlightCardId ? endSlotRef : undefined}
              data-hand-card
              style={{
                width: 'var(--card-w)',
                height: 'var(--card-h)',
                flexShrink: 0,
                marginLeft,
                zIndex: z,
                position: 'relative',
              }}
            />
          )
        }

        return (
          <div
            key={card.id}
            data-hand-card
            style={{
              flexShrink: 0,
              marginLeft,
              zIndex: z,
              position: 'relative',
              pointerEvents: 'auto',
              filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35))',
              animation: card.id === landingCardId ? 'card-land 0.28s ease forwards' : undefined,
            }}
          >
            <CardView
              card={card}
              selected={selectedIds.has(card.id)}
              onClick={isActive ? () => onToggle(card.id) : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function HandView({
  cards,
  selectedIds,
  onToggle,
  isActive,
  inflightCardIds,
  activeFlightCardId,
  endSlotRef,
  landingCardId,
}: HandViewProps) {
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [cardW, setCardW] = useState(64)
  const [availableW, setAvailableW] = useState(320)
  const [page, setPage] = useState(0)
  const pendingIds = inflightCardIds ?? EMPTY_ID_SET

  const pageCount = Math.max(1, Math.ceil(cards.length / HAND_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)

  // Keep page in range when the hand shrinks.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  // Jump to the page that contains the active flight / landing card so the slot stays measurable.
  useEffect(() => {
    const focusId = activeFlightCardId ?? landingCardId
    if (!focusId) return
    const idx = cards.findIndex((c) => c.id === focusId)
    if (idx < 0) return
    setPage(Math.floor(idx / HAND_PAGE_SIZE))
  }, [activeFlightCardId, landingCardId, cards])

  useEffect(() => {
    const el = measureRef.current
    if (!el) return

    const update = () => {
      // Prefer measuring a real card; fall back to CSS variable size.
      const cardEl = el.querySelector<HTMLElement>('[data-hand-card]')
      setCardW(cardEl?.offsetWidth || 64)
      setAvailableW(el.clientWidth)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cards.length, safePage])

  const pageStart = safePage * HAND_PAGE_SIZE
  const pageCards = cards.slice(pageStart, pageStart + HAND_PAGE_SIZE)
  const backRow = pageCards.slice(0, CARDS_PER_ROW)
  const frontRow = pageCards.slice(CARDS_PER_ROW, HAND_PAGE_SIZE)
  const hasFrontRow = frontRow.length > 0

  // < 14 total: relax spacing for the actual count.
  // >= 14 total: lock spacing to a full 14-card row and reuse it on every row.
  const packingCount =
    cards.length < CARDS_PER_ROW ? Math.max(cards.length, 1) : CARDS_PER_ROW
  const step = computeStep(availableW, cardW, packingCount)

  // Block is always the width of a full packing row so partial front rows
  // share the same left edge; the block itself stays centered in the panel.
  const handBlockWidth = rowPixelWidth(cardW, step, packingCount)

  const showPager = cards.length > HAND_PAGE_SIZE
  const rangeStart = cards.length === 0 ? 0 : pageStart + 1
  const rangeEnd = pageStart + pageCards.length

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: '8px 12px 10px',
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      {showPager && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '4px',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            aria-label="Previous hand page"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              width: '36px',
              height: '32px',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ‹
          </button>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', minWidth: '7.5rem', textAlign: 'center' }}>
            {rangeStart}–{rangeEnd} of {cards.length}
          </span>
          <button
            type="button"
            aria-label="Next hand page"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              width: '36px',
              height: '32px',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* Full-width rail used only to measure panel width; hand block is centered inside. */}
      <div ref={measureRef} style={{ width: '100%' }}>
        <div
          style={{
            width: handBlockWidth > 0 ? handBlockWidth : '100%',
            maxWidth: '100%',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            paddingTop: '14px',
            minHeight: hasFrontRow
              ? 'calc(var(--card-h) * 1.4 + 14px)'
              : 'calc(var(--card-h) + 14px)',
          }}
        >
          {/* Back row (cards 1–14 of the page) */}
          <HandRow
            cards={backRow}
            selectedIds={selectedIds}
            onToggle={onToggle}
            isActive={isActive}
            inflightCardIds={pendingIds}
            activeFlightCardId={activeFlightCardId}
            endSlotRef={endSlotRef}
            landingCardId={landingCardId}
            zBase={0}
            step={step}
            cardW={cardW}
          />

          {/* Front row overlaps the back row by half a card; higher z for hit-testing. */}
          {hasFrontRow && (
            <div style={{ marginTop: ROW_OVERLAP_PULL }}>
              <HandRow
                cards={frontRow}
                selectedIds={selectedIds}
                onToggle={onToggle}
                isActive={isActive}
                inflightCardIds={pendingIds}
                activeFlightCardId={activeFlightCardId}
                endSlotRef={endSlotRef}
                landingCardId={landingCardId}
                zBase={CARDS_PER_ROW}
                step={step}
                cardW={cardW}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
