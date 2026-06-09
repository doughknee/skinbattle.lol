import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightToBracket, faUserGear } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '~/lib/useAuth'

export default function AccountButton() {
  const navigate = useNavigate()
  const { isAuthenticated, login } = useAuth()

  const handleClick = () => {
    if (isAuthenticated) {
      navigate({ to: '/account' })
    } else {
      // The old /auth/login page is replaced by a direct Logto redirect.
      login()
    }
  }

  return (
    <button
      onClick={handleClick}
      type="button"
      className="relative w-[75px] h-[75px] focus:outline-none group cursor-pointer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={75}
        height={75}
        viewBox="0 0 200 200"
      >
        <circle
          cx={100}
          cy={100}
          r={80}
          fill="none"
          style={{ strokeWidth: 25 }}
          className="group-hover:stroke-gold3 transition duration-150 stroke-gold5"
        />
        <circle
          cx={100}
          cy={100.415}
          r={80}
          fill="none"
          style={{ stroke: '#0a323c', strokeWidth: 12 }}
        />
        <path
          fill="none"
          d="M-28.94 118.049c33.349-47.09 100.045-47.09 133.393 0"
          style={{
            stroke: '#0397ab',
            strokeWidth: 12,
            transformBox: 'fill-box',
            transformOrigin: '50% 50%',
            strokeLinecap: 'round',
          }}
          transform="rotate(-90 0 0)"
        />
        <path
          d="m108.299 67.219 20.76 25.623v51.246l-20.76 25.623-20.76-25.623V92.842Z"
          style={{
            stroke: '#c8983c',
            fill: '#010a13',
            transformBox: 'fill-box',
            transformOrigin: '50% 50%',
            strokeWidth: 5,
          }}
          transform="rotate(-89.997 24.069 32.781)"
        />
        <text
          x={97.926}
          y={182.353}
          style={{
            fontFamily: 'Arial',
            fontSize: 20,
            fontWeight: 700,
            textAnchor: 'middle',
            whiteSpace: 'pre',
          }}
          className="fill-grey1 font-serif"
          transform="matrix(1.60929 0 0 1.5932 -58.628 -104.41)"
        >
          802
        </text>
      </svg>
      {/* Icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {isAuthenticated ? (
          <FontAwesomeIcon
            icon={faUserGear}
            className="h-7 text-gold5 group-hover:text-gold3 transition duration-150"
          />
        ) : (
          <FontAwesomeIcon
            icon={faRightToBracket}
            className="h-7 text-gold5 group-hover:text-gold3 transition duration-150"
          />
        )}
      </div>
    </button>
  )
}
