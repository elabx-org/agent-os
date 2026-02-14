import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { PROVIDER_MAP, isValidProviderId } from "@/lib/providers/registry";

/**
 * POST /api/cli-install
 *
 * Install an AI CLI tool by provider ID.
 * Uses the installCommand from the provider registry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId } = body as { providerId: string };

    if (!providerId || !isValidProviderId(providerId)) {
      return NextResponse.json(
        { error: `Invalid provider: ${providerId}` },
        { status: 400 }
      );
    }

    const provider = PROVIDER_MAP.get(providerId);
    if (!provider?.installCommand) {
      return NextResponse.json(
        {
          error: `No install command available for ${provider?.name || providerId}`,
        },
        { status: 400 }
      );
    }

    return new Promise<NextResponse>((resolve) => {
      exec(
        provider.installCommand!,
        {
          encoding: "utf-8",
          timeout: 120_000,
          shell: "/bin/bash",
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve(
              NextResponse.json(
                {
                  success: false,
                  error: error.message,
                  output: (stdout + "\n" + stderr).trim(),
                },
                { status: 500 }
              )
            );
          } else {
            resolve(
              NextResponse.json({
                success: true,
                output: (stdout + "\n" + stderr).trim(),
              })
            );
          }
        }
      );
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
