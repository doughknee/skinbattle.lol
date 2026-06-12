import { createFileRoute, redirect } from '@tanstack/react-router'

// The slice hub ("every slice is a link") is gone - the full ranking IS the
// rankings page, with the slice bar handling discovery in-page. Kept as a
// redirect so old links and bookmarks land somewhere better.
export const Route = createFileRoute('/rankings/')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/$slice', params: { slice: 'all' } })
  },
})
