import type { CSSProperties } from 'react'
import { getAvatar } from '../avatars/catalog'

interface AvatarViewProps {
  avatarId: string
  size?: number
  alt?: string
  /** Gold border + shimmering halo for the player whose turn it is. */
  active?: boolean
  style?: CSSProperties
}

export default function AvatarView({
  avatarId,
  size = 40,
  alt = '',
  active = false,
  style,
}: AvatarViewProps) {
  const avatar = getAvatar(avatarId)
  const image = avatar ? (
    <img
      src={avatar.src}
      alt={alt || avatar.label}
      width={size}
      height={size}
      draggable={false}
      className={active ? 'avatar-face avatar-face--active' : 'avatar-face'}
      style={{
        width: size,
        height: size,
        ...style,
      }}
    />
  ) : (
    <div
      aria-hidden
      className={active ? 'avatar-face avatar-face--active' : 'avatar-face'}
      style={{
        width: size,
        height: size,
        background: 'var(--surface-2)',
        ...style,
      }}
    />
  )

  if (!active) return image

  return (
    <span
      className="avatar-halo"
      style={{ width: size, height: size }}
    >
      <span className="avatar-halo__ring" aria-hidden />
      {image}
    </span>
  )
}
