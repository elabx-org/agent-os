import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CREDENTIALS_PATH = path.join(
  process.env.HOME || "/config",
  ".claude",
  "minimax-settings.json"
);

const USAGE_URL = "https://www.minimax.io/v1/api/openplatform/coding_plan/remains";
const CACHE_TTL = 30_000; // 30 seconds

interface CodingPlanResponse {
  code: number;
  msg: string;
  data?: {
    remains: number;
    used: number;
    total: number;
  };
}

// Module-level cache
let cache: { data: CodingPlanResponse; timestamp: number } | null = null;

function readCredentials(): string | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    const apiKey = data?.env?.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) return null;
    return apiKey;
  } catch {
    return null;
  }
}

async function fetchUsage(apiKey: string): Promise<CodingPlanResponse> {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    return {
      code: res.status,
      msg: `HTTP ${res.status}`,
    };
  }

  return res.json();
}

export async function GET() {
  // Return cached data if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const apiKey = readCredentials();
  if (!apiKey) {
    return NextResponse.json(
      { code: 404, msg: "No Minimax Coding Plan credentials found" },
      { status: 404 }
    );
  }

  const data = await fetchUsage(apiKey);

  if (data.code === 0 || data.code === 200) {
    cache = { data, timestamp: Date.now() };
  }

  return NextResponse.json(data);
}
