import { run } from "@/cli/lib/process";

// Git tail of a release: stage every working-tree change (bumped version files, the regenerated
// website/, screenshots, demo replay and any support assets), commit, tag and push — matching
// tasks.py `_commit_release`.

export function commitRelease(version: string): void {
  run("git add -A");
  run(`git commit -m "Release ${version}"`);
  run(`git tag -a "${version}" -m "${version}"`);
  run("git push");
  run("git push --tags");
}
