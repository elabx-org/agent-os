import type { ReactNode } from "react";

export type SetupArtKind =
  | "link"
  | "caps"
  | "setup"
  | "share"
  | "safety"
  | "done";

const LABELS: Record<SetupArtKind, string> = {
  link: "The two machines join with a line and a signal travels across",
  caps: "Each machine shows what it can do",
  setup: "Skill cards travel from the server to the machine",
  share:
    "A project on the server gets a copy on the machine, and changes flow both ways",
  safety:
    "The server goes dark, the live session hops to the machine, then hops back when the server returns",
  done: "Both machines are in sync",
};

const MUTED = "hsl(var(--muted-foreground))";
const LINE = "hsl(var(--muted-foreground) / 0.45)";
const BOX = "hsl(var(--muted))";
const ACCENT = "hsl(var(--primary))";
const OK = "#22c55e";

const short = (name: string) =>
  name.length > 16 ? `${name.slice(0, 15)}…` : name;

function Server({ name, className }: { name: string; className?: string }) {
  return (
    <g className={className}>
      <rect
        x="32"
        y="38"
        width="56"
        height="60"
        rx="9"
        fill={BOX}
        stroke={LINE}
        strokeWidth="1.5"
      />
      <rect x="42" y="50" width="36" height="6" rx="3" fill={LINE} />
      <rect x="42" y="62" width="36" height="6" rx="3" fill={LINE} />
      <text
        x="60"
        y="116"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={MUTED}
      >
        {short(name)}
      </text>
    </g>
  );
}

function Mac({ name }: { name: string }) {
  return (
    <g>
      <rect
        x="228"
        y="40"
        width="68"
        height="46"
        rx="8"
        fill={BOX}
        stroke={LINE}
        strokeWidth="1.5"
      />
      <path
        d="M252 98h20M262 86v12"
        stroke={LINE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text
        x="262"
        y="116"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={MUTED}
      >
        {short(name)}
      </text>
    </g>
  );
}

const Wire = ({ moving = true }: { moving?: boolean }) => (
  <path
    className={moving ? "a-dash" : undefined}
    d="M92 68H224"
    stroke={LINE}
    strokeWidth="2"
    strokeDasharray="5 6"
    fill="none"
  />
);

function Chip({
  x,
  y,
  w,
  text,
  delay,
}: {
  x: number;
  y: number;
  w: number;
  text: string;
  delay: string;
}) {
  return (
    <g className={`a-pop ${delay}`}>
      <rect
        x={x}
        y={y}
        width={w}
        height="18"
        rx="9"
        fill={BOX}
        stroke={OK}
        strokeWidth="1.2"
      />
      <text
        x={x + w / 2}
        y={y + 12.5}
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="600"
        fill="hsl(var(--foreground))"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * The small animated picture at the top of each step of the set-up walk:
 * the server on the left, the machine on the right, and what the step
 * does between them. Still when the person asked for less motion
 * (app/globals.css, .setup-art)
 */
export function SetupArt({
  kind,
  server,
  machine,
  serverChips = [],
  machineChips = [],
}: {
  kind: SetupArtKind;
  server: string;
  machine: string;
  /** For "caps": up to two things each side can do */
  serverChips?: string[];
  machineChips?: string[];
}) {
  let between: ReactNode = null;
  if (kind === "link") {
    between = (
      <>
        <Wire />
        <circle className="a-go" cx="88" cy="68" r="5" fill={OK} />
      </>
    );
  } else if (kind === "caps") {
    between = (
      <>
        {serverChips.slice(0, 2).map((text, i) => (
          <Chip
            key={text}
            x={98}
            y={40 + i * 24}
            w={56}
            text={text}
            delay={`d${i + 1}`}
          />
        ))}
        {machineChips.slice(0, 2).map((text, i) => (
          <Chip
            key={text}
            x={162}
            y={40 + i * 24}
            w={56}
            text={text}
            delay={`d${i + 3}`}
          />
        ))}
      </>
    );
  } else if (kind === "setup") {
    between = (
      <>
        <Wire />
        {[1, 2, 3].map((n) => (
          <rect
            key={n}
            className={`a-go d${n}`}
            x="84"
            y="59"
            width="16"
            height="18"
            rx="4"
            fill={ACCENT}
            opacity="0"
          />
        ))}
      </>
    );
  } else if (kind === "share") {
    between = (
      <>
        <Wire />
        <rect x="46" y="18" width="28" height="14" rx="4" fill={ACCENT} />
        <rect
          className="a-appear"
          x="248"
          y="18"
          width="28"
          height="14"
          rx="4"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <circle className="a-go" cx="88" cy="68" r="4" fill={OK} />
        <circle className="a-back" cx="88" cy="68" r="4" fill={OK} />
      </>
    );
  } else if (kind === "safety") {
    between = (
      <>
        <Wire moving={false} />
        <g className="a-hop">
          <circle className="a-pulse" cx="60" cy="24" r="5" fill={ACCENT} />
        </g>
      </>
    );
  } else {
    between = (
      <>
        <Wire />
        <circle className="a-go" cx="88" cy="68" r="4" fill={OK} />
        <circle className="a-back" cx="88" cy="68" r="4" fill={OK} />
        <path
          d="M148 30l8 8 16-18"
          fill="none"
          stroke={OK}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <svg
      className="setup-art bg-card w-full flex-none rounded-[20px]"
      viewBox="0 0 320 130"
      role="img"
      aria-label={LABELS[kind]}
    >
      <Server
        name={server}
        className={kind === "safety" ? "a-dim" : undefined}
      />
      <Mac name={machine} />
      {between}
    </svg>
  );
}
