import { Injectable } from "@nestjs/common";

export function parseBuildRevision(value: string | undefined): string {
  if (value === undefined || value === "") return "unknown";
  if (!/^[0-9a-f]{40}$/i.test(value))
    throw new Error(
      "BUILD_REVISION must be a full 40-character hexadecimal commit SHA",
    );
  return value.toLowerCase();
}

@Injectable()
export class BuildMetadata {
  readonly revision = parseBuildRevision(process.env.BUILD_REVISION);
}
