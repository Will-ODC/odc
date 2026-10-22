/** The same destinations on every screen; session data arrives as props. */
export function SiteNavigation({
  currentHref,
  community,
}: {
  currentHref?: string;
  community?: string;
}) {
  const links = [
    { href: "/", label: "Home" },
    { href: "/questions", label: "Starting questions" },
    { href: "/browse?community=pulse-general", label: "General" },
    ...(community && community !== "pulse-general"
      ? [
          {
            href: `/browse?community=${encodeURIComponent(community)}`,
            label: "Your community",
          },
        ]
      : []),
  ];
  return (
    <nav className="banner__nav" aria-label="Main navigation">
      {links.map(({ href, label }) => (
        <a
          key={href}
          href={href}
          aria-current={currentHref === href ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
