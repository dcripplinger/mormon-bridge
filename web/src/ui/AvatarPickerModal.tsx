import { avatarsForKind, type AvatarKind } from '../avatars/catalog'
import AvatarView from './AvatarView'

interface Props {
  name: string
  kind: AvatarKind
  avatarId: string
  takenIds?: Set<string>
  onAvatarChange: (avatarId: string) => void
  onClose: () => void
}

export default function AvatarPickerModal({
  name,
  kind,
  avatarId,
  takenIds = new Set(),
  onAvatarChange,
  onClose,
}: Props) {
  const options = avatarsForKind(kind)

  return (
    <>
      <button
        type="button"
        aria-label="Close avatar picker"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          border: 'none',
          padding: 0,
          zIndex: 40,
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose avatar for ${name}`}
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(340px, calc(100vw - 32px))',
          maxHeight: 'min(480px, calc(100vh - 32px))',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '16px',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AvatarView avatarId={avatarId} size={44} alt="" />
            <div>
              <div style={{ color: 'var(--text)', fontWeight: 700 }}>{name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                Choose an avatar
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-dim)',
              fontSize: '1.1rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
          }}
        >
          {options.map((avatar) => {
            const selected = avatarId === avatar.id
            const takenElsewhere = takenIds.has(avatar.id)
            return (
              <button
                key={avatar.id}
                type="button"
                disabled={takenElsewhere}
                title={
                  takenElsewhere
                    ? 'Already chosen by another player'
                    : avatar.label
                }
                aria-label={avatar.label}
                aria-pressed={selected}
                onClick={() => onAvatarChange(avatar.id)}
                style={{
                  padding: '4px',
                  borderRadius: '10px',
                  border: selected
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  background: selected ? 'var(--surface-2)' : 'transparent',
                  opacity: takenElsewhere ? 0.35 : 1,
                  lineHeight: 0,
                }}
              >
                <AvatarView avatarId={avatar.id} size={56} alt={avatar.label} />
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'var(--accent)',
            color: '#1a1a1a',
            padding: '10px',
            borderRadius: '8px',
            fontWeight: 700,
          }}
        >
          Done
        </button>
      </div>
    </>
  )
}
