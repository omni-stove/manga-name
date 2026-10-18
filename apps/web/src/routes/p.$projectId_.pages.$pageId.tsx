import { createFileRoute, notFound } from '@tanstack/react-router'
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

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const { library, generation, llmProvider } = Route.useRouteContext()
  return (
    <PageEditor
      projectId={projectId}
      pageId={pageId}
      store={store}
      collab={collab}
      library={library}
      generation={generation}
      llmProvider={llmProvider}
    />
  )
}
