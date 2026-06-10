import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '~/lib/api'
import { RouteSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'

export const Route = createFileRoute('/champions/')({
  loader: async () => {
    const champions = await api.champions()
    return { champions }
  },
  pendingComponent: () => (
    <RouteSkeleton quip="Stealing baron..." variant="champions" />
  ),
  errorComponent: ({ error }) => (
    <p className="text-red-500">Error: {error.message}</p>
  ),
  component: ChampionsPage,
})

function ChampionsPage() {
  const { champions } = Route.useLoaderData()

  return (
    <div className="container mx-auto p-4 pt-28">
      <h1 className="text-5xl font-bold font-serif mb-2 text-gold2">
        Champions
      </h1>
      <h2 className="text-xl mb-8 text-grey1">
        Click on a champion to view and vote on their skins.
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {champions.map((champion) => {
          const defaultSkin =
            champion.skins.find((skin) => skin.num === 0) || champion.skins[0]
          const skinCount = champion.skins.length

          return (
            <li
              key={champion.id}
              className="group relative overflow-hidden bg-hextech-black/30 outline outline-icon/25 -outline-offset-2 hover:outline-icon transition duration-150"
            >
              <Link
                to="/champions/$id"
                params={{ id: champion.id.toLowerCase() }}
                className="block cursor-pointer"
              >
                <div className="relative w-full aspect-video overflow-hidden">
                  <img
                    src={defaultSkin.splash_url}
                    alt={`${championDisplayName(champion.id)} splash`}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {/* Bottom fade so the name is always legible over splash art */}
                  <div className="absolute inset-0 bg-gradient-to-t from-hextech-black via-hextech-black/30 to-transparent" />
                  {/* Skin count badge */}
                  <span className="absolute top-3 right-3 bg-hextech-black/70 outline outline-gold5/60 -outline-offset-1 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-gold2">
                    {skinCount} {skinCount === 1 ? 'skin' : 'skins'}
                  </span>
                  {/* Name + title over the art */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h2 className="font-serif text-2xl font-bold text-gold1 transition-colors duration-150 group-hover:text-gold2">
                      {championDisplayName(champion.id)}
                    </h2>
                    <p className="text-sm italic text-grey1">{champion.title}</p>
                  </div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
