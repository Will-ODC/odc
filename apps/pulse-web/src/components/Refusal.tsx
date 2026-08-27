/**
 * A vote that was not taken.
 *
 * Deliberately a line under the question rather than a panel over it: the
 * answer is still there to give, and covering it would turn "that did not go
 * through" into "you are finished here".
 */
export function Refusal({ message }: { message: string }) {
  return (
    <p className="refusal" role="alert">
      {message}
    </p>
  );
}
