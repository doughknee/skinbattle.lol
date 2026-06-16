// Renders schema.org JSON-LD into the SSR'd HTML so crawlers parse it on the
// first fetch. Body placement is fine - Google reads JSON-LD anywhere in the
// DOM. One <script> per block; arrays are flattened. Content is deterministic
// from loader data, so there's no hydration mismatch.
export default function JsonLd({ data }: { data: object | object[] }) {
  const blocks = Array.isArray(data) ? data : [data]
  return (
    <>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  )
}
