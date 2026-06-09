import { useState, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import type { Champion } from '~/lib/types'

export default function ChampionSearch() {
  const [query, setQuery] = useState('')
  const [champions, setChampions] = useState<Champion[]>([])
  const [filteredChampions, setFilteredChampions] = useState<Champion[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 1. Fetch champions
  useEffect(() => {
    async function fetchChampions() {
      try {
        const data = await api.champions()
        setChampions(data)
      } catch (error) {
        console.error('Error fetching champions:', error)
      }
    }
    fetchChampions()
  }, [])

  // 2. Filter champions by query
  useEffect(() => {
    if (!query.trim()) {
      setFilteredChampions(champions)
    } else {
      setFilteredChampions(
        champions.filter((champion) =>
          champion.id?.toLowerCase().includes(query.toLowerCase()),
        ),
      )
    }
  }, [query, champions])

  // 3. Navigate to champion page
  const handleSelect = (championId: string) => {
    navigate({ to: '/champions/$id', params: { id: championId.toLowerCase() } })
    setSearchOpen(false)
    setQuery('')
  }

  // 4. Auto-focus input when search opens
  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [searchOpen])

  // 5. Close search bar if user clicks outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setSearchOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} className="fixed bottom-4 left-4 flex items-center">
      {/* Button to toggle search */}
      <button
        onClick={() => setSearchOpen(true)}
        className={`cursor-pointer group bg-hextech-black/30 mr-2 border-2 outline-icon/30 outline -outline-offset-2 hover:border-icon transition duration-150 font-serif hover:text-gold1 text-lg font-bold px-8 py-4 shadow-lg ${searchOpen ? 'border-icon text-gold1' : 'border-transparent text-grey1'}`}
      >
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className={`h-7 group-hover:text-gold3 transition duration-150 ${searchOpen ? 'text-gold3' : 'text-gold5'}`}
        />
      </button>

      {/* Only animate the search bar width */}
      <div
        className={`relative overflow-hidden transition-all duration-300 ease-in-out ${searchOpen ? 'w-64' : 'w-0'}`}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search champion..."
          className={`border-2 border-icon p-2 bg-hextech-black/30 outline-icon/30 outline text-grey1 shadow-lg w-full transition-opacity duration-300 ease-in-out ${searchOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        />
      </div>
      {/* Dropdown */}
      {searchOpen && filteredChampions.length > 0 && (
        <ul
          className="absolute bottom-full left-0 mb-2 w-full bg-hextech-black/30 outline-icon/30 outline text-grey1 shadow-lg max-h-60 overflow-y-auto z-50"
          onMouseDown={(e) => {
            // Keep clicks in dropdown from closing the search
            e.preventDefault()
          }}
        >
          {filteredChampions.map((champion) => (
            <li
              key={champion.id}
              onClick={() => handleSelect(champion.id)}
              className="p-2 hover:bg-grey-cool hover:text-gold2 cursor-pointer"
            >
              {champion.id}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
