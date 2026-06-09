import { useState, useEffect, useRef } from 'react'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  options: DropdownOption[]
  onSelect: (value: string) => void
  label: string
  selectedValue?: string
  onClose?: (() => void) | null
}

export default function Dropdown({
  options,
  onSelect,
  label,
  selectedValue = '',
  onClose = null,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleSelect = (value: string) => {
    onSelect(value)
    setIsOpen(false)
  }

  // Close dropdown if clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        if (isOpen) {
          setIsOpen(false)
          if (onClose && !selectedValue) {
            onClose()
          }
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, selectedValue])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 text-left bg-hextech-black outline outline-gold2/30 border-2 border-transparent hover:border-icon text-gold1 shadow flex justify-between items-center transition-colors duration-150"
      >
        <span>{label}</span>
        <svg
          className={`w-4 h-4 text-gold1 ml-2 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06 0L10 10.92l3.71-3.71a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <div
        className={`absolute mt-2 w-full bg-hextech-black z-10 shadow-lg transition-[max-height] duration-300 ease-in-out ${isOpen ? 'max-h-48 overflow-y-auto outline outline-gold2/30' : 'max-h-0 overflow-hidden'}`}
        style={{ maxHeight: isOpen ? '12rem' : '0' }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={`block w-full text-left px-4 py-2 cursor-pointer ${
              option.value === selectedValue
                ? 'bg-gold2 text-blue5 font-semibold'
                : 'text-grey1 hover:bg-grey-cool hover:text-gold2'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
