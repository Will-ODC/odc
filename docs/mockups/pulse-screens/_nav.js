/* global document, location */
// Shared cross-screen navigation for the split pulse story screens.
// Every original mockup control uses data-go="<pane>"; here that maps to the
// sibling file so the flow stays walkable across standalone pages.
const NAV = {
  claim: "01-claim.html",
  sent: "02-sent.html",
  s1: "03-bite-1.html",
  s2: "04-bite-2.html",
  vote: "05-vote.html",
  results: "06-results.html",
  action: "07-action.html",
};
document.querySelectorAll("[data-go]").forEach((el) =>
  el.addEventListener("click", () => {
    const target = NAV[el.dataset.go];
    if (target) location.href = target;
  }),
);
