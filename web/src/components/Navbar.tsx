import { Link, useRouterState } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faHouse,
  faUsers,
  faCrown,
  faDice,
  faCheckToSlot,
} from '@fortawesome/free-solid-svg-icons'
import AccountButton from './AccountButton'

export default function NavBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const itemBase =
    'h-full w-16 flex justify-center items-center transition duration-350 hover:bg-linear-to-b hover:from-40% hover:from-transparent hover:via-60% hover:via-gold2/10 hover:to-99% hover:to-gold2/40'
  const active =
    'bg-linear-to-b from-40% from-transparent via-60% via-gold2/10 to-99% to-gold2/20'

  return (
    <nav className="px-10 flex h-26 justify-between items-center border-b border-b-icon/30 border-t-2 border-t-gold5 bg-transparent backdrop-blur-2xl fixed top-0 left-0 w-full z-50">
      <Link
        to="/games"
        className="group lg:flex items-center justify-center border border-icon/30 rounded-l-full hidden"
      >
        <div className="h-[56px] w-[56px] bg-gold5 group-hover:bg-gold3 rounded-full flex justify-center items-center transition duration-150">
          <div className="h-[50px] w-[50px] border-2 border-hextech-black bg-radial from-blue5 from-10% to-blue4 group-hover:to-blue2 rounded-full flex justify-center items-center transition duration-150">
            <FontAwesomeIcon
              icon={faDice}
              className="h-7 text-gold5 group-hover:text-gold3 transition duration-150"
            />
          </div>
        </div>
        <div className="relative">
          <svg
            width="200"
            height="50"
            viewBox="0 0 185 50"
            className="-ml-6 cursor-pointer"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="0" y="0" width="185" height="50" className="opacity-0" />
            <rect x="150" y="0" width="39" height="50" className="fill-blue5" />
            <rect
              x="150"
              y="3"
              width="36"
              height="44"
              className="fill-hextech-black"
            />
            <path
              d="M10 0 H158 L190 25 L158 50 H10 Q30 25 10 0"
              className="fill-blue4 transition duration-150 group-hover:fill-blue2 group-hover:shadow-2xl shadow-blue2"
            />
            <path
              d="M15 3 H156 L185 25 L156 47 H15 Q32 25 15 3"
              className="fill-grey3 pointer-events-none"
            />
            <text
              x="95"
              y="32"
              fontSize="20"
              fontWeight="bold"
              className="fill-gold1 pointer-events-none"
              textAnchor="middle"
              fontFamily="serif"
            >
              PLAY
            </text>
          </svg>
        </div>
      </Link>
      <div className="flex h-26 pb-0.5 justify-center items-center absolute left-1/2 transform -translate-x-1/2">
        <Link
          to="/"
          className={`${pathname === '/' ? active : ''} ${itemBase}`}
        >
          <FontAwesomeIcon
            icon={faHouse}
            className={`${pathname === '/' ? 'text-gold1' : 'text-icon'} hover:text-gold1 h-7 mt-0.5`}
          />
        </Link>
        <div className="h-[70%] w-[2px] mt-0.5 bg-gradient-to-b from-transparent via-icon to-transparent" />
        <Link
          to="/champions"
          className={`${pathname === '/champions' ? active : ''} ${itemBase}`}
        >
          <FontAwesomeIcon
            icon={faUsers}
            className={`${pathname === '/champions' ? 'text-gold1' : 'text-icon'} hover:text-gold1 h-7 mt-0.5`}
          />
        </Link>
        <div className="h-[70%] w-[2px] mt-0.5 bg-gradient-to-b from-transparent via-icon to-transparent" />
        <Link
          to="/user/votes"
          className={`${pathname === '/user/votes' ? active : ''} ${itemBase}`}
        >
          <FontAwesomeIcon
            icon={faCheckToSlot}
            className={`${pathname === '/user/votes' ? 'text-gold1' : 'text-icon'} hover:text-gold1 h-7 mt-0.5`}
          />
        </Link>
        <div className="h-[70%] w-[2px] bg-gradient-to-b from-transparent via-icon to-transparent mt-0.5" />
        <Link
          to="/awards"
          className={`${pathname === '/awards' ? active : ''} ${itemBase}`}
        >
          <FontAwesomeIcon
            icon={faCrown}
            className={`${pathname === '/awards' ? 'text-gold1' : 'text-icon'} hover:text-gold1 h-7 mt-0.5`}
          />
        </Link>
        <div className="h-[70%] w-[2px] bg-gradient-to-b from-transparent via-icon to-transparent mt-0.5 block lg:hidden" />
        <Link
          to="/games"
          className={`${pathname === '/games' ? active : ''} ${itemBase} lg:hidden`}
        >
          <FontAwesomeIcon
            icon={faDice}
            className={`${pathname === '/games' ? 'text-gold1' : 'text-icon'} hover:text-gold1 h-7 mt-0.5`}
          />
        </Link>
      </div>
      <div className="hidden lg:flex">
        <AccountButton />
      </div>
    </nav>
  )
}
