import { createFileRoute, Link } from '@tanstack/react-router'
import PageHeader from '~/components/PageHeader'

// Plain-language privacy policy. The site collects very little, so the page
// says exactly what and why instead of hiding behind boilerplate. Keep this
// honest: if a future feature adds collection (analytics, comments), this
// page must change in the same PR.

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: 'Privacy · Skin Battle' },
      {
        name: 'description',
        content:
          'What skinbattle.lol collects (very little), why, and how to delete it.',
      },
    ],
  }),
  component: PrivacyPage,
})

const EFFECTIVE = 'June 12, 2026'

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-serif text-2xl font-bold text-gold1">
        {title}
      </h2>
      <div className="space-y-3 text-grey1 leading-relaxed">{children}</div>
    </section>
  )
}

function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="The fine print, in plain language"
        title="Privacy"
        subtitle={`Effective ${EFFECTIVE}`}
        className="mb-12"
      />

      <div className="animate-fade-up">
        <Section title="The short version">
          <p>
            skinbattle.lol is a free, community-built fan project. There are no
            ads, no third-party analytics, no tracking pixels, and your data is
            never sold or shared for marketing. The site keeps the minimum it
            needs to do one thing: let people rank League of Legends skins.
          </p>
        </Section>

        <Section title="What the site collects">
          <p>
            <b className="text-gold1">Account details.</b> If you sign in, the
            site's self-hosted sign-in service (Logto) stores your email
            address and username, plus your password or passkeys. Passwords
            and passkeys never touch the app itself.
          </p>
          <p>
            <b className="text-gold1">Your votes.</b> Stars, bans, and battle
            picks are stored against your account so your profile, your
            Mirror, and the community rankings work. That's the product.
          </p>
          <p>
            <b className="text-gold1">A guest token.</b> If you play without
            signing in, a random identifier is stored in a cookie and in your
            browser's local storage so your battles and streaks survive a
            refresh. It contains no personal information, and you can attach
            it to an account later by signing in.
          </p>
          <p>
            <b className="text-gold1">Preferences and caches.</b> Your chosen
            avatar, display username, and similar interface state live in your
            browser's local storage so pages paint instantly.
          </p>
          <p>
            <b className="text-gold1">Server logs.</b> Like nearly every
            website, the servers keep short-lived standard logs (IP address,
            user agent, requested URL) for debugging and abuse prevention.
          </p>
        </Section>

        <Section title="What the site doesn't do">
          <p>
            No third-party analytics or advertising scripts run on this site.
            There is no cross-site tracking, no fingerprinting, and no consent
            banner because there's nothing to consent to: every cookie and
            local-storage entry is strictly functional (signing you in,
            remembering your guest progress, caching your preferences).
          </p>
        </Section>

        <Section title="Third parties involved">
          <p>
            Splash art and champion icons load directly from Riot Games' Data
            Dragon CDN, so your browser makes standard image requests to Riot's
            servers. The site's own services (the app, the API, and the Logto
            sign-in service) are self-hosted on the project's infrastructure.
          </p>
        </Section>

        <Section title="What's public">
          <p>
            Rankings are aggregated from everyone's votes and are public by
            design; individual votes are not shown publicly. If you earn a
            spot on a leaderboard, your username appears there.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            You can delete your account any time from{' '}
            <Link
              to="/profile"
              search={{ tab: 'account' }}
              className="text-gold2 underline-offset-2 hover:underline"
            >
              Profile → Account
            </Link>
            . That permanently removes your account and your sign-in identity.
            Your individual votes are disconnected from you. They survive
            only inside anonymous aggregate tallies, with nothing linking them
            back to a person. Guest data lives in your browser: clearing
            cookies and site data for skinbattle.lol orphans it.
          </p>
        </Section>

        <Section title="Children">
          <p>This site is not directed at children under 13.</p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If this policy changes, the effective date above changes with it.
            Questions or requests:{' '}
            <a
              href="https://github.com/doughknee/skinbattle.lol/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold2 underline-offset-2 hover:underline"
            >
              open an issue on GitHub
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  )
}
