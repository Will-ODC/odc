import { IntroPage } from "../components/IntroPage.js";

export type RelatedPollIds = Partial<
  Record<"data" | "funding" | "revote", string>
>;

export function FoundationQuestions({
  firstPollId,
  relatedPollIds = {},
  onChoose,
}: {
  firstPollId?: string;
  relatedPollIds?: RelatedPollIds;
  onChoose: (id: string) => void;
}) {
  const questions = [
    { label: "How should the voting page look?", id: firstPollId },
    { label: "How should optional data be used?", id: relatedPollIds.data },
    {
      label: "How should the website cover its costs?",
      id: relatedPollIds.funding,
    },
    {
      label: "When should we vote on these rules again?",
      id: relatedPollIds.revote,
    },
  ];
  return (
    <IntroPage title="What should we decide next?" compact>
      <p className="welcome__lede">
        Choose a question. You can open any of these, whatever your other
        answers.
      </p>
      <ul className="welcome__questions">
        {questions.map(({ label, id }) => {
          const target = id?.trim();
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!target}
                onClick={() => {
                  if (target) onChoose(target);
                }}
              >
                {label}
              </button>
              {!target ? <small>Coming soon</small> : null}
            </li>
          );
        })}
      </ul>
      <p className="welcome__note">
        {questions.some(({ id }) => !id?.trim())
          ? "Questions marked “Coming soon” are being prepared. "
          : ""}
        Opening a question does not submit an answer.
      </p>
    </IntroPage>
  );
}
