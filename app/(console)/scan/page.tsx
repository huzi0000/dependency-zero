import { ScanConsole } from "@/components/app/ScanConsole";
import { listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  return <ScanConsole initial={await listScans(100)} />;
}
