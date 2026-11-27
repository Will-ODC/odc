import { useState } from "react";
import type { PublicImage, PostingCommunity } from "../api/types.js";
import "./ItemPicture.css";

const tileColors = [
  "var(--green-wash)",
  "var(--chip)",
  "var(--hover)",
] as const;

function CommunityTile({ id, label }: PostingCommunity) {
  const colorIndex = Array.from(id).reduce(
    (hash, character) =>
      (hash * 31 + (character.codePointAt(0) ?? 0)) % tileColors.length,
    0,
  );
  return (
    <span
      className="question-picture question-picture--tile"
      role="img"
      aria-label={label}
      style={{ backgroundColor: tileColors[colorIndex] }}
    >
      {Array.from(label)[0]?.toUpperCase()}
    </span>
  );
}

function DisplayImage({
  image,
}: {
  image: Exclude<PublicImage, { kind: "tile" }>;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const size = image.kind === "upload" ? "upload" : "tile";
  return (
    <img
      className={`question-picture question-picture--${size}`}
      src={image.displayUrl}
      alt={image.alt}
      width={image.width}
      height={image.height}
      onError={() => setFailed(true)}
    />
  );
}

export function ItemPicture({
  image,
  community,
}: {
  image: PublicImage | undefined;
  community: PostingCommunity | undefined;
}) {
  if (!image) return null;
  if (image.kind === "tile") {
    return (
      <CommunityTile
        {...(community ?? { id: "pulse-general", label: "General" })}
      />
    );
  }
  return <DisplayImage key={image.displayUrl} image={image} />;
}
