export function printInventory(info: {
  emailNew: number; emailSkipped: number;
  tasks: number;
  keepNew: number; keepSkipped: number;
  github: number;
  mode: string;
}): void {
  const col = (s: string, w: number) => s.padEnd(w);
  console.log("\n=== Source Inventory ===");
  if (info.mode === "update") {
    console.log(`  ${col("Email", 10)} ${info.emailNew} new  (${info.emailSkipped} already indexed)`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks} (always re-fetched)`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew} new  (${info.keepSkipped} already indexed)`);
  } else {
    console.log(`  ${col("Email", 10)} ${info.emailNew}`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks}`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew}`);
  }
  console.log(`  ${col("GitHub", 10)} ${info.github} repos (always re-fetched)`);
  console.log("========================\n");
}
