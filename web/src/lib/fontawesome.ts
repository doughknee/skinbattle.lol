// FontAwesome global config. We disable the auto-CSS injection because we ship
// the icon CSS rule manually in globals.css (`.svg-inline--fa { height: 1.5em }`),
// matching the original Next.js app. Importing the core CSS here ensures icons
// are sized correctly during SSR before hydration.
import { config } from '@fortawesome/fontawesome-svg-core'
import '@fortawesome/fontawesome-svg-core/styles.css'

config.autoAddCss = false
