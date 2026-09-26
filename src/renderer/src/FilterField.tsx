import { HStack } from '@astryxdesign/core/HStack'
import { Kbd } from '@astryxdesign/core/Kbd'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * A quiet list filter: filled instead of outlined, focused with "/" from anywhere on the page (unless the user is
 * already typing somewhere), and showing that shortcut while empty and unfocused.
 */
export function FilterField({
  label,
  placeholder,
  value,
  onChange,
  onEnter,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      wrapper.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <HStack
      ref={wrapper}
      className="filter-field"
      align="center"
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <TextInput
        label={label}
        isLabelHidden
        width="100%"
        startIcon={Search}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onEnter={onEnter}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
        hasClear
      />
      {!value && !isFocused && <Kbd keys="/" className="filter-field-hint" />}
    </HStack>
  )
}
