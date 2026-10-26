import { AccountMenu } from "./AccountMenu.js";

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
    { href: "/about", label: "About" },
    { href: "/my-votes", label: "My votes" },
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
      {community && community !== "pulse-general" ? (
        <AccountMenu label="Your communities">
          <a
            href={`/browse?community=${encodeURIComponent(community)}`}
            aria-current={
              currentHref ===
              `/browse?community=${encodeURIComponent(community)}`
                ? "page"
                : undefined
            }
          >
            {community}
          </a>
        </AccountMenu>
      ) : null}
    </nav>
  );
}
