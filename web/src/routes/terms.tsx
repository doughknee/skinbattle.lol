import { createFileRoute, Link } from '@tanstack/react-router'
import PageHeader from '~/components/PageHeader'

// Plain-language terms for a free fan project: what the site is, the Riot
// disclaimers, and the few rules that keep the rankings honest.

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [
      { title: 'Terms · Skin Battle' },
      {
        name: 'description',
        content:
          'The terms of use for skinbattle.lol: a free League of Legends fan project.',
      },
    ],
  }),
  component: TermsPage,
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

function TermsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="The ground rules"
        title="Terms of Use"
        subtitle={`Effective ${EFFECTIVE}`}
        className="mb-12"
      />

      <div className="animate-fade-up">
        <Section title="What this is">
          <p>
            skinbattle.lol is a free, non-commercial fan project for ranking
            League of Legends skins. By using the site you accept these terms.
            If a term here doesn't work for you, the remedy is simple and
            free: don't use the site.
          </p>
        </Section>

        <Section title="Riot Games">
          <p>
            skinbattle.lol isn't endorsed by Riot Games and doesn't reflect
            the views or opinions of Riot Games or anyone officially involved
            in producing or managing Riot Games properties. Riot Games and all
            associated properties are trademarks or registered trademarks of
            Riot Games, Inc. Splash art and champion imagery are the property
            of Riot Games and are used under Riot's policies for fan projects.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            One account per person. Keep your credentials to yourself, and
            pick a username that wouldn't get you reported in champ select —
            abusive or impersonating usernames may be changed or removed.
          </p>
        </Section>

        <Section title="Keeping the rankings honest">
          <p>
            The whole site is one big shared dataset, so the only real rule is
            don't poison it: no bots, scripts, or automation; no coordinated
            vote manipulation; no exploiting bugs to inflate ratings. Votes
            that look manufactured may be discounted or removed, and accounts
            that attack the service or the data may be suspended or deleted.
          </p>
        </Section>

        <Section title="Your votes">
          <p>
            Votes you cast become part of the community dataset. The site may
            aggregate, display, and anonymize them — that's what makes the
            rankings exist. Usernames may appear on leaderboards. You can
            delete your account (and disconnect your votes from your identity)
            any time from{' '}
            <Link
              to="/profile"
              search={{ tab: 'account' }}
              className="text-gold2 underline-offset-2 hover:underline"
            >
              Profile → Account
            </Link>
            .
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            The site is provided as-is, free of charge, with no warranties of
            any kind. It may go down, lose data, change, or shut down at any
            time. To the maximum extent permitted by law, the project and its
            maintainer aren't liable for any damages arising from your use of
            the site.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            These terms may change as the site grows (the effective date above
            tracks the latest revision). Material changes will be noted on the{' '}
            <Link
              to="/releases"
              className="text-gold2 underline-offset-2 hover:underline"
            >
              Releases
            </Link>{' '}
            page. Questions:{' '}
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
