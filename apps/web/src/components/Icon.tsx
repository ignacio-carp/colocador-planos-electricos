import React from 'react'

type IconProps = {
  name: string
  className?: string
  filled?: boolean
  'aria-hidden'?: boolean
}

export function Icon({ name, className = '', filled, 'aria-hidden': ariaHidden = true }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${filled ? 'filled' : ''} ${className}`.trim()}
      aria-hidden={ariaHidden}
    >
      {name}
    </span>
  )
}
