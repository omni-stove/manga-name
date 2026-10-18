import { m } from '@manga/i18n'
import { currentArt } from '@manga/schema'
import { Button } from '@manga/ui'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { generatingPanels } from '../generate-panel'
import { exportOnboarding, openOnboarding } from '../onboarding/onboarding'
import { type EditorArea, type GuideTarget, PageEditor } from '../page-editor'
import { errorMessage } from '../route-error'
import { saveFile } from '../save-file'
import { toasts } from '../toasts'
import { useProject } from '../use-project'

export const Route = createFileRoute('/onboarding')({
  loader: ({ context }) => openOnboarding(context.imageProvider),
  component: Onboarding,
})

/** オンボーディングの手順。手順ごとに吹き出しを向ける操作とその案内、編集画面のうち使える領域を決める */
interface Step {
  target: GuideTarget
  message: () => string
  unlocked: ReadonlySet<EditorArea>
}

const GENERATE: Step = {
  target: 'generate',
  message: m.web_onboarding_description,
  unlocked: new Set(['generate']),
}

const COMPARE: Step = {
  target: 'layers',
  message: m.web_onboarding_generated,
  unlocked: new Set(['generate', 'layers']),
}

/**
 * 用意したコマ割り、セリフ、焦点と誘導線の 1 ページを、ページの編集画面で開く。
 * 絵が無いうちは「このページを全部生成」、絵が入ったらレイヤーの切り替えだけをぼかさずに見せて吹き出しで指す。
 * 生成した絵は開いている間だけメモリに持ち、「ZIP で書き出し」で固定のコンテンツにする zip を保存する
 */
function Onboarding() {
  const { library, store, generation, projectId, pageId } = Route.useLoaderData()
  const { llmProvider } = Route.useRouteContext()
  const project = useProject(store)
  const running = useStore(generation.generating, (s) => generatingPanels(s, projectId).size > 0)
  const page = project.episodes[0]?.pages.find((p) => p.id === pageId)
  const generated = page?.panels.some((panel) => currentArt(panel)) ?? false
  const step = generated ? COMPARE : GENERATE
  const exportZip = () =>
    exportOnboarding(store.get(), library.loadAsset)
      .then((blob) => saveFile(blob, 'onboarding.zip', [{ name: 'ZIP', extensions: ['zip'] }]))
      .catch((e: unknown) =>
        toasts.push(m.web_onboarding_export_failed({ reason: errorMessage(e) })),
      )
  return (
    <PageEditor
      projectId={projectId}
      pageId={pageId}
      store={store}
      collab={library.collaboration(projectId)}
      library={library}
      generation={generation}
      llmProvider={llmProvider}
      unlocked={step.unlocked}
      guide={{ target: step.target, message: step.message() }}
      actions={
        <Button size="small" disabled={!generated || running} onClick={() => void exportZip()}>
          {m.web_onboarding_export()}
        </Button>
      }
    />
  )
}
