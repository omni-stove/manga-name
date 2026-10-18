import { createFileRoute, notFound } from '@tanstack/react-router'
import { tour } from '../onboarding/tour'
import { tourEditorAreas, useTourStep } from '../onboarding/tour-guide'
import { PageEditor, PageNotFound } from '../page-editor'
import { findPage } from '../project-ops'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store || !findPage(store.get(), params.pageId)) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
  },
  component: Editor,
  notFoundComponent: PageNotFound,
})

/** ページの編集画面。オンボーディングで案内しているページなら、今の手順で使う領域だけを開ける */
function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const { library, generation, llmProvider } = Route.useRouteContext()
  const step = useTourStep(projectId, pageId)
  return (
    <PageEditor
      projectId={projectId}
      pageId={pageId}
      store={store}
      collab={collab}
      library={library}
      generation={generation}
      llmProvider={llmProvider}
      unlocked={tourEditorAreas(step)}
      onLayersChange={
        step &&
        ((layers) => {
          if (!layers.hints) tour.report('hints-hidden')
        })
      }
      onExport={step && (() => tour.report('exported'))}
    />
  )
}
