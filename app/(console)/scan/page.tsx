import { ScanConsole } from "@/components/app/ScanConsole";
import { listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const scans = await listScans(100);

  // Seed the example pills from coordinates this deployment has actually
  // scanned, so they are always real packages rather than invented names.
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const scan of scans) {
    const coordinate = `${scan.packageName}@${scan.version}`;
    if (seen.has(coordinate)) continue;
    seen.add(coordinate);
    examples.push(coordinate);
    if (examples.length === 4) break;
  }

  return <ScanConsole initial={scans} examples={examples} />;
}
