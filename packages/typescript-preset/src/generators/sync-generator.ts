import { Tree, createProjectGraphAsync, joinPathFragments } from '@nx/devkit'
import type { SyncGeneratorResult } from 'nx/src/utils/sync-generators'

export async function syncGenerator(tree: Tree): Promise<SyncGeneratorResult> {
  const projectGraph = await createProjectGraphAsync()
  const outOfSync: string[] = []

  for (const [name, project] of Object.entries(projectGraph.nodes)) {
    // Ensure tsconfig.json has correct extends
    const tsconfigPath = joinPathFragments(project.data.root, 'tsconfig.json')
    if (tree.exists(tsconfigPath)) {
      const content = tree.read(tsconfigPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (!parsed.extends) {
        parsed.extends = '@nx-devkit/typescript/tsconfig/base'
        tree.write(tsconfigPath, JSON.stringify(parsed, null, 2))
        outOfSync.push(`${name}: tsconfig.json missing extends`)
      }
    }
  }

  return {
    outOfSyncMessage:
      outOfSync.length > 0
        ? `Config drift detected: ${outOfSync.join('; ')}. Run 'nx sync' to fix.`
        : 'All configs in sync',
  }
}

export default syncGenerator
